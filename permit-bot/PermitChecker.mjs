import axios from 'axios'
import { httpsAgent } from './dnsBypass.mjs'

// Bumped 06-22 from Chrome/120 → Chrome/131. The probe page banner reads
// "outdated browser not supported" for Chrome/120, which costs reCAPTCHA v3
// fingerprint score and is suspected to have contributed to the 06-16
// captcha-storm where 9 of 10 trace snapshots were reCAPTCHA challenges.
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const MAX_BACKOFF_MS = 5 * 60 * 1000

// rec.gov's permitinyo endpoint refuses anything other than month-boundary
// start/end. So we always request whole calendar months that cover targetDates.
function monthRanges(targetDates) {
    const months = new Set()
    for (const d of targetDates) {
        months.add(d.slice(0, 7)) // YYYY-MM
    }
    return [...months].sort().map(ym => {
        const [y, m] = ym.split('-').map(Number)
        const start = new Date(Date.UTC(y, m - 1, 1)).toISOString()
        // rec.gov accepts last-day-of-month at 00:00 as end (verified empirically;
        // any later time returns "can only be start/end of the month").
        const end = new Date(Date.UTC(y, m, 0)).toISOString()
        return { start, end }
    })
}

export default class PermitChecker {
    constructor({ permitId, targets, targetDates, log }) {
        this.permitId = permitId
        this.targets = targets // [{divisionId, name}]
        this.targetDates = targetDates // ["YYYY-MM-DD", ...]
        this.log = log || console
        this.backoffMs = 0
        this.lastErrorReason = null
        this.lastSnapshot = null  // { fetchedAt, byDateByDivision }
        this.lastSeenRemaining = new Map() // key: `${date}|${divisionId}` -> last remaining
    }

    async pollOnce() {
        const ranges = monthRanges(this.targetDates)
        const merged = {}
        for (const { start, end } of ranges) {
            const url = `https://www.recreation.gov/api/permitinyo/${this.permitId}/availability` +
                `?start_date=${encodeURIComponent(start)}` +
                `&end_date=${encodeURIComponent(end)}` +
                `&commercial_acct=false`
            const res = await axios.get(url, {
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
                timeout: 15000,
                httpsAgent,
            })
            Object.assign(merged, res.data?.payload || {})
        }
        return merged
    }

    // Returns { snapshot, openings } where openings is the list of
    // (date, division) pairs that just transitioned from 0 (or missing) to >0.
    diff(currentPayload) {
        const openings = []
        const rows = []
        for (const date of this.targetDates) {
            const dayData = currentPayload[date] || {}
            for (const target of this.targets) {
                const cell = dayData[target.divisionId]
                const remaining = cell?.remaining ?? null
                const total = cell?.total ?? null
                const key = `${date}|${target.divisionId}`
                const prev = this.lastSeenRemaining.get(key)
                rows.push({ date, target, remaining, total, prev })
                if (remaining != null && remaining > 0 && (prev == null || prev === 0)) {
                    openings.push({ date, divisionId: target.divisionId, name: target.name, remaining, total })
                }
                if (remaining != null) {
                    this.lastSeenRemaining.set(key, remaining)
                }
            }
        }
        this.lastSnapshot = { fetchedAt: new Date().toISOString(), rows }
        return { snapshot: this.lastSnapshot, openings }
    }

    handleError(err) {
        const status = err.response?.status
        const retryAfter = err.response?.headers?.['retry-after']
        if (retryAfter) {
            const sec = Number.parseInt(retryAfter, 10)
            this.backoffMs = Number.isFinite(sec)
                ? sec * 1000
                : Math.min((this.backoffMs || 2000) * 2, MAX_BACKOFF_MS)
            this.lastErrorReason = `Retry-After:${retryAfter}`
        } else if (status === 429 || (status >= 500 && status < 600)) {
            this.backoffMs = Math.min((this.backoffMs || 2000) * 2, MAX_BACKOFF_MS)
            this.lastErrorReason = `HTTP ${status}`
        } else if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(err.code)) {
            this.backoffMs = Math.min((this.backoffMs || 2000) * 2, MAX_BACKOFF_MS)
            this.lastErrorReason = `Network ${err.code}`
        } else {
            this.lastErrorReason = err.message
            // keep backoff as-is for non-retryable errors
        }
        this.log.error(`PermitChecker error: ${this.lastErrorReason} (backoff ${this.backoffMs}ms)`)
    }

    resetBackoff() {
        if (this.backoffMs > 0) {
            this.log.info(`PermitChecker recovered (backoff was ${this.backoffMs}ms)`)
        }
        this.backoffMs = 0
        this.lastErrorReason = null
    }
}
