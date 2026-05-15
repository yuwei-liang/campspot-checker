const REQUIRED = ['WEBHOOK_URL', 'MONTH_START']

const WEEKDAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Parse "Thu,Fri,Sat" -> [4, 5, 6]. Throws on unknown tokens.
 */
export const parseWeekdays = (str) => {
    if (!str) return []
    return str.split(',').map((s) => {
        const lower = s.trim().toLowerCase().slice(0, 3)
        if (!(lower in WEEKDAY_MAP)) {
            throw new Error(`Unknown weekday: "${s}". Use Sun/Mon/Tue/Wed/Thu/Fri/Sat (comma-separated).`)
        }
        return WEEKDAY_MAP[lower]
    })
}

const formatApiDate = (d) => {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}T00:00:00Z`
}

/**
 * Given a MONTH_START ISO string and a list of weekday indices [0-6],
 * return all ISO dates within that calendar month (UTC) that fall on
 * those weekdays. Returns dates in chronological order.
 */
export const expandWeekdaysInMonth = (monthStart, weekdays) => {
    const start = new Date(monthStart)
    if (Number.isNaN(start.getTime())) {
        throw new Error(`Invalid MONTH_START: ${monthStart}`)
    }
    const year = start.getUTCFullYear()
    const month = start.getUTCMonth()
    const result = []
    for (let day = 1; day <= 31; day++) {
        const d = new Date(Date.UTC(year, month, day))
        if (d.getUTCMonth() !== month) break
        if (weekdays.includes(d.getUTCDay())) {
            result.push(formatApiDate(d))
        }
    }
    return result
}

export const weekdayLabel = (isoDate) => {
    const d = new Date(isoDate)
    return WEEKDAY_LABELS[d.getUTCDay()]
}

export const loadConfig = (env = process.env) => {
    const missing = REQUIRED.filter((key) => !env[key])
    if (missing.length > 0) {
        throw new Error(
            `Missing required env vars: ${missing.join(', ')}. ` +
            `Copy .env.example to .env and fill them in.`
        )
    }

    // Date selection: prefer TARGET_WEEKDAYS (multi-date) over TARGET_DATE (single).
    // Must have at least one.
    let targetDates
    if (env.TARGET_WEEKDAYS) {
        const weekdays = parseWeekdays(env.TARGET_WEEKDAYS)
        targetDates = expandWeekdaysInMonth(env.MONTH_START, weekdays)
        if (targetDates.length === 0) {
            throw new Error(
                `TARGET_WEEKDAYS=${env.TARGET_WEEKDAYS} produced 0 dates in MONTH_START=${env.MONTH_START}. ` +
                `Check that the month spans the weekdays you want.`
            )
        }
    } else if (env.TARGET_DATE) {
        targetDates = [env.TARGET_DATE]
    } else {
        throw new Error(
            `Set TARGET_WEEKDAYS (e.g. "Thu,Fri,Sat") or TARGET_DATE in .env.`
        )
    }

    const pollIntervalMs = Number.parseInt(env.POLL_INTERVAL_MS || '90000', 10)
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
        throw new Error(
            `POLL_INTERVAL_MS must be a positive integer >= 1000 (got ${env.POLL_INTERVAL_MS}). ` +
            `Default 90000 (90s) is recommended to stay under recreation.gov rate limits.`
        )
    }

    return {
        webhookUrl: env.WEBHOOK_URL,
        monthStart: env.MONTH_START,
        targetDates,
        pollIntervalMs,
    }
}
