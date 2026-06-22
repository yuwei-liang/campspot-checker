// Find consecutive Available nights that all fall on one of `weekdays`, up to
// `maxNights` long. Returns the LONGEST stay per disjoint run; runs longer than
// `maxNights` are split into back-to-back stays so the operator still sees
// every cartable opportunity.
//
// site.availabilities is the rec.gov payload shape, keyed by ISO UTC midnight:
//   { '2026-07-09T00:00:00Z': 'Available', '2026-07-10T00:00:00Z': 'Reserved', ... }
//
// rangeStartDate / rangeEndDate are 'YYYY-MM-DD' inclusive. Dates outside the
// payload (or not in target weekdays, or not 'Available') break the run.
//
// Returned stay shape:
//   { campsiteId, startDate, endDate (checkout), nights, nightDates: ['YYYY-MM-DD',...] }
// endDate is checkout day (startDate + nights), matching rec.gov's `enddate`
// URL param convention.

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function isoUtcMidnight(yyyymmdd) {
    return `${yyyymmdd}T00:00:00Z`
}

export function weekdayOf(yyyymmdd) {
    const d = new Date(`${yyyymmdd}T00:00:00Z`)
    return WEEKDAY_NAMES[d.getUTCDay()]
}

export function addDays(yyyymmdd, n) {
    const ms = Date.parse(`${yyyymmdd}T00:00:00Z`) + n * 86400000
    return new Date(ms).toISOString().slice(0, 10)
}

export function eachDate(startDate, endDate) {
    const out = []
    let d = startDate
    while (d <= endDate) {
        out.push(d)
        d = addDays(d, 1)
    }
    return out
}

// Status values considered "Available" — anything else (Reserved, Closed,
// Not Reservable Management, NYR, missing) breaks the run.
const AVAILABLE = new Set(['Available'])

// Greedy left-to-right walk. When the current run reaches maxNights, we emit
// it and reset *without consuming the current night*, so the next day can
// start a fresh run (which only happens when the next day is also a target
// weekday + available — i.e. very long Thu-Sun stretches across weeks).
// Actually that's a non-issue: in practice Thu-Sun runs cap at 4 nights, and
// the next valid weekday (Thu) is 3 days later. The emit-then-reset path is
// for safety; the common case is run terminated by Monday.
export function findStaysForSite({
    campsiteId,
    availabilities,
    rangeStartDate,
    rangeEndDate,
    targetWeekdays,
    maxNights,
    minNights = 1,
}) {
    const weekdaySet = new Set(targetWeekdays)
    const stays = []
    let runStart = null
    let runDates = []

    const flush = () => {
        if (runStart && runDates.length >= minNights) {
            const last = runDates[runDates.length - 1]
            stays.push({
                campsiteId,
                startDate: runStart,
                endDate: addDays(last, 1),
                nights: runDates.length,
                nightDates: [...runDates],
            })
        }
        runStart = null
        runDates = []
    }

    for (const date of eachDate(rangeStartDate, rangeEndDate)) {
        const status = availabilities[isoUtcMidnight(date)]
        const qualifies = AVAILABLE.has(status) && weekdaySet.has(weekdayOf(date))
        if (!qualifies) {
            flush()
            continue
        }
        if (runStart == null) runStart = date
        runDates.push(date)
        if (runDates.length >= maxNights) {
            flush() // emit cap-length run; the very next day continues a new run if it qualifies
        }
    }
    flush()
    return stays
}

// Scan every campsite in the payload and return all qualifying stays.
// Caller decides ranking (e.g. longest first).
//
// minPeople: skip sites whose max_num_people is below the threshold. If a site
// is missing max_num_people we KEEP it (null > threshold is treated as
// unknown-capacity — better to alert and let the human filter than to silently
// drop). Set minPeople = 0 to disable the filter.
export function findAllStays({
    campsitesPayload,
    rangeStartDate,
    rangeEndDate,
    targetWeekdays,
    maxNights,
    minNights = 1,
    minPeople = 0,
}) {
    const all = []
    for (const [campsiteId, site] of Object.entries(campsitesPayload || {})) {
        if (minPeople > 0 && Number.isFinite(site.max_num_people) && site.max_num_people < minPeople) {
            continue
        }
        const stays = findStaysForSite({
            campsiteId,
            availabilities: site.availabilities || {},
            rangeStartDate,
            rangeEndDate,
            targetWeekdays,
            maxNights,
            minNights,
        })
        for (const s of stays) {
            all.push({
                ...s,
                siteNo: site.site || null,
                loop: site.loop || null,
                campsiteType: site.campsite_type || null,
                maxPeople: site.max_num_people ?? null,
            })
        }
    }
    return all
}

// Score: longer stays preferred; ties broken by earliest start date, then
// lowest site number for stable ordering. Higher score = better.
export function rankStays(stays) {
    return [...stays].sort((a, b) => {
        if (b.nights !== a.nights) return b.nights - a.nights
        if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1
        const an = parseInt(a.siteNo || a.campsiteId, 10) || 0
        const bn = parseInt(b.siteNo || b.campsiteId, 10) || 0
        return an - bn
    })
}
