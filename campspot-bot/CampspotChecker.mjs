import axios from 'axios'
import { httpsAgent } from '../permit-bot/dnsBypass.mjs'
import { findAllStays, rankStays, addDays } from './findStays.mjs'

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const MAX_BACKOFF_MS = 5 * 60 * 1000

// Build the list of month-start ISO strings that cover [startDate..endDate].
function monthStartsFor(startDate, endDate) {
    const [sy, sm] = startDate.slice(0, 7).split('-').map(Number)
    const [ey, em] = endDate.slice(0, 7).split('-').map(Number)
    const out = []
    let y = sy, m = sm
    while (y < ey || (y === ey && m <= em)) {
        const iso = new Date(Date.UTC(y, m - 1, 1)).toISOString()
        out.push(iso)
        m += 1
        if (m > 12) { m = 1; y += 1 }
    }
    return out
}

// Merge per-month campsite payloads. rec.gov returns the same campsite keys
// across months with date-keyed availabilities; we union the availabilities.
function mergeMonths(target, src) {
    for (const [id, site] of Object.entries(src || {})) {
        if (!target[id]) {
            target[id] = { ...site, availabilities: { ...(site.availabilities || {}) } }
        } else {
            target[id].availabilities = {
                ...target[id].availabilities,
                ...(site.availabilities || {}),
            }
        }
    }
}

// Today's date in PT (America/Los_Angeles), formatted YYYY-MM-DD. The lead-
// time window is anchored to PT because the user lives in PT, rec.gov dates
// are presented in PT, and check-in is end-of-day local. Using local Date
// would drift by a day for users in different timezones; Intl.DateTimeFormat
// pins it.
const PT_YMD = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
})
function todayPT() {
    return PT_YMD.format(new Date())
}
function addDaysPT(yyyymmdd, n) {
    const ms = Date.parse(`${yyyymmdd}T00:00:00Z`) + n * 86400000
    return new Date(ms).toISOString().slice(0, 10)
}

export default class CampspotChecker {
    constructor({
        campgroundId,
        rangeStartDate, // YYYY-MM-DD inclusive (absolute floor)
        rangeEndDate,   // YYYY-MM-DD inclusive
        targetWeekdays = ['Thu', 'Fri', 'Sat', 'Sun'],
        maxNights = 4,
        minNights = 1,
        minPeople = 0,
        // leadDays: when set, the effective range start is max(rangeStartDate,
        // today + leadDays) — recomputed on every diff() so the window slides
        // forward as days pass. Use this when the user needs decision-time
        // lead time before a trip (e.g. "always 15 days out so the friend
        // group can plan"). Set 0 / undefined for absolute-only mode.
        leadDays = 0,
        log,
    }) {
        if (!campgroundId) throw new Error('CampspotChecker: campgroundId required')
        if (!rangeStartDate || !rangeEndDate) throw new Error('CampspotChecker: rangeStartDate + rangeEndDate required')
        this.campgroundId = campgroundId
        this.rangeStartDate = rangeStartDate
        this.rangeEndDate = rangeEndDate
        this.targetWeekdays = targetWeekdays
        this.maxNights = maxNights
        this.minNights = minNights
        this.minPeople = minPeople
        this.leadDays = Number.isFinite(leadDays) ? leadDays : 0
        this.log = log || console
        this.backoffMs = 0
        this.lastErrorReason = null
        // dedup: { 'campsiteId|startDate|endDate' -> last seen ts }
        this.lastSeenStays = new Map()
    }

    // Recompute the effective start date — slides forward each PT day when
    // leadDays > 0. Returns whichever floor is later: the static
    // rangeStartDate or today + leadDays.
    effectiveStartDate() {
        if (this.leadDays > 0) {
            const dynamicFloor = addDaysPT(todayPT(), this.leadDays)
            return dynamicFloor > this.rangeStartDate ? dynamicFloor : this.rangeStartDate
        }
        return this.rangeStartDate
    }

    monthStarts() {
        return monthStartsFor(this.effectiveStartDate(), this.rangeEndDate)
    }

    async pollOnce() {
        const merged = {}
        for (const ms of this.monthStarts()) {
            const url = `https://www.recreation.gov/api/camps/availability/campground/${this.campgroundId}/month?start_date=${encodeURIComponent(ms)}`
            const res = await axios.get(url, {
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
                timeout: 15000,
                httpsAgent,
            })
            mergeMonths(merged, res.data?.campsites)
        }
        return merged
    }

    // Returns { snapshot, newStays }. snapshot.stays is the full ranked list of
    // every qualifying (campsiteId, dateRange) opportunity. newStays is the
    // subset never seen before (dedup keyed by campsiteId|start|end), so
    // callers can notify exactly once per new opening.
    diff(campsitesPayload) {
        const effStart = this.effectiveStartDate()
        const stays = findAllStays({
            campsitesPayload,
            rangeStartDate: effStart,
            rangeEndDate: this.rangeEndDate,
            targetWeekdays: this.targetWeekdays,
            maxNights: this.maxNights,
            minNights: this.minNights,
            minPeople: this.minPeople,
        })
        const ranked = rankStays(stays)
        const newStays = []
        const currentKeys = new Set()
        for (const s of ranked) {
            const key = `${s.campsiteId}|${s.startDate}|${s.endDate}`
            currentKeys.add(key)
            if (!this.lastSeenStays.has(key)) {
                newStays.push(s)
            }
            this.lastSeenStays.set(key, Date.now())
        }
        // Evict keys that aren't present anymore so they re-fire if they reopen.
        for (const k of [...this.lastSeenStays.keys()]) {
            if (!currentKeys.has(k)) this.lastSeenStays.delete(k)
        }
        return {
            snapshot: {
                fetchedAt: new Date().toISOString(),
                rangeStartDate: effStart,
                rangeEndDate: this.rangeEndDate,
                stays: ranked,
                campsiteCount: Object.keys(campsitesPayload || {}).length,
            },
            newStays,
        }
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
        }
        this.log.error(`CampspotChecker error: ${this.lastErrorReason} (backoff ${this.backoffMs}ms)`)
    }

    resetBackoff() {
        if (this.backoffMs > 0) {
            this.log.info(`CampspotChecker recovered (backoff was ${this.backoffMs}ms)`)
        }
        this.backoffMs = 0
        this.lastErrorReason = null
    }

    // Pre-fire re-check: given a candidate stay, hit the API for just the
    // month(s) the stay touches and confirm every night is still Available.
    // If only a prefix is still Available (very common: someone snipes the
    // tail), return the longest still-valid prefix instead of giving up.
    //
    // Returns { ok, originalStay, adjustedStay, reason }. When ok=true,
    // adjustedStay is what should actually be cart-fired (may equal
    // originalStay if everything still holds).
    async recheckStay(stay) {
        const months = monthRangesForRange(stay.startDate, stay.endDate)
        let payload = {}
        for (const ms of months) {
            const url = `https://www.recreation.gov/api/camps/availability/campground/${this.campgroundId}/month?start_date=${encodeURIComponent(ms)}`
            const res = await axios.get(url, {
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
                timeout: 8000,
                httpsAgent,
            })
            const merged = res.data?.campsites?.[stay.campsiteId]
            if (merged) {
                payload = { ...payload, ...merged.availabilities }
            }
        }
        // Walk nightDates left-to-right. Stop at the first night that flipped.
        const stillValid = []
        for (const d of stay.nightDates) {
            const status = payload[`${d}T00:00:00Z`]
            if (status === 'Available') stillValid.push(d)
            else break
        }
        if (stillValid.length === stay.nightDates.length) {
            return { ok: true, originalStay: stay, adjustedStay: stay, reason: 'unchanged' }
        }
        if (stillValid.length === 0) {
            return { ok: false, originalStay: stay, adjustedStay: null, reason: 'all_gone' }
        }
        const lastNight = stillValid[stillValid.length - 1]
        const sMs = Date.parse(`${lastNight}T00:00:00Z`)
        const checkoutIso = new Date(sMs + 86400000).toISOString().slice(0, 10)
        const adjusted = {
            ...stay,
            nightDates: stillValid,
            nights: stillValid.length,
            endDate: checkoutIso,
        }
        return { ok: true, originalStay: stay, adjustedStay: adjusted, reason: 'shortened' }
    }
}

// Helper for recheckStay: month-starts covering a [startDate..endDate-1] range.
// Kept module-local since it's only used by the recheck path.
function monthRangesForRange(startDate, endDate) {
    const [sy, sm] = startDate.slice(0, 7).split('-').map(Number)
    const lastNightIso = new Date(Date.parse(`${endDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    const [ey, em] = lastNightIso.slice(0, 7).split('-').map(Number)
    const out = []
    let y = sy, m = sm
    while (y < ey || (y === ey && m <= em)) {
        out.push(new Date(Date.UTC(y, m - 1, 1)).toISOString())
        m += 1
        if (m > 12) { m = 1; y += 1 }
    }
    return out
}

export { monthStartsFor, addDays }
