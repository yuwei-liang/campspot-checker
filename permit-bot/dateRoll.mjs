// Date selection for the LYV race window.
//
// Yosemite Wilderness Permits release at 7am Pacific Time, 7 days in advance.
// On any given calendar day in PT, exactly one night becomes raceable that
// morning (today+7). Bots that run for multiple days need their target-date
// set to *roll forward* as the calendar advances — otherwise they either
// (a) waste polling on stale past dates, or (b) require manual config edits
// after each race.
//
// Two config modes:
//
//   1. AUTO-ROLL (preferred for long-running monitors):
//        { "targetDateOffsetsDays": [7, 8] }
//      Each cycle we compute today+offsetN dates. Past midnight PT, the set
//      naturally advances by one day. Default `[7, 8]` covers "the night that
//      released this morning at 7am PT" plus "the night that releases tomorrow
//      at 7am" — giving cross-midnight runs a hand-off without manual restart.
//
//   2. STATIC LIST (preferred when you have specific trip dates):
//        { "targetDates": ["2026-06-19", "2026-06-20"] }
//      We drop any date strictly earlier than today (PT). Future dates poll
//      as before. Once all dates pass, the active set goes empty and the
//      watcher exits.
//
// If both fields are present, AUTO-ROLL wins. The static list is treated as
// "lock to these specific dates" so it stays the explicit-opt-in escape hatch.

const PT_TZ = 'America/Los_Angeles'

// "Today" as the rec.gov release timezone sees it. Independent of process
// timezone — a Mac running in UTC, a NAS in EST, and the rec.gov clock all
// agree on which night just released.
export function todayInPT(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: PT_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now)
    const yyyy = parts.find(p => p.type === 'year').value
    const mm = parts.find(p => p.type === 'month').value
    const dd = parts.find(p => p.type === 'day').value
    return `${yyyy}-${mm}-${dd}`
}

function addDaysISO(yyyyMmDd, n) {
    const [y, m, d] = yyyyMmDd.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + n)
    const yy = dt.getUTCFullYear()
    const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
    const da = String(dt.getUTCDate()).padStart(2, '0')
    return `${yy}-${mo}-${da}`
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Deterministic, deduped, sorted ascending. Caller passes `now` in tests to
// pin behavior across midnight boundaries.
export function getActiveTargetDates(config, now = new Date()) {
    const today = todayInPT(now)
    const offsets = config.targetDateOffsetsDays
    if (Array.isArray(offsets) && offsets.length > 0) {
        const out = new Set()
        for (const off of offsets) {
            // Reject null/undefined/'' explicitly — Number(null) is 0, which
            // would silently add today as a target.
            if (off === null || off === undefined || off === '') continue
            const n = Number(off)
            if (!Number.isFinite(n)) continue
            out.add(addDaysISO(today, Math.trunc(n)))
        }
        return [...out].sort()
    }
    const list = Array.isArray(config.targetDates) ? config.targetDates : []
    return [...new Set(list.filter(d => typeof d === 'string' && ISO_DATE_RE.test(d) && d >= today))].sort()
}

// Human summary for logs/heartbeats: explains *why* the active set is what it
// is, so a glance at startup confirms the right config mode is live.
export function describeActiveDates(config, now = new Date()) {
    const today = todayInPT(now)
    const active = getActiveTargetDates(config, now)
    if (Array.isArray(config.targetDateOffsetsDays) && config.targetDateOffsetsDays.length) {
        return `auto-roll today=${today} offsets=${JSON.stringify(config.targetDateOffsetsDays)} → ${active.join(', ') || '(empty)'}`
    }
    const raw = Array.isArray(config.targetDates) ? config.targetDates : []
    const dropped = raw.filter(d => d < today)
    const droppedNote = dropped.length ? ` (dropped past: ${dropped.join(', ')})` : ''
    return `static today=${today} dates=${active.join(', ') || '(empty)'}${droppedNote}`
}
