import {
    findStaysForSite,
    findAllStays,
    rankStays,
    weekdayOf,
    addDays,
    isoUtcMidnight,
} from '../findStays.mjs'

const A = 'Available'
const R = 'Reserved'
const C = 'Closed'

// 2026-07-09 = Thu, 2026-07-10 = Fri, 2026-07-11 = Sat, 2026-07-12 = Sun, 2026-07-13 = Mon.
function withAvail(dates) {
    const out = {}
    for (const [date, status] of Object.entries(dates)) {
        out[isoUtcMidnight(date)] = status
    }
    return out
}

describe('weekday math', () => {
    test('weekdayOf knows 2026-07-09 is a Thursday', () => {
        expect(weekdayOf('2026-07-09')).toBe('Thu')
        expect(weekdayOf('2026-07-10')).toBe('Fri')
        expect(weekdayOf('2026-07-11')).toBe('Sat')
        expect(weekdayOf('2026-07-12')).toBe('Sun')
        expect(weekdayOf('2026-07-13')).toBe('Mon')
    })

    test('addDays crosses month boundary', () => {
        expect(addDays('2026-07-31', 1)).toBe('2026-08-01')
        expect(addDays('2026-08-01', -1)).toBe('2026-07-31')
    })
})

describe('findStaysForSite', () => {
    const targetWeekdays = ['Thu', 'Fri', 'Sat', 'Sun']

    test('full Thu-Sun stay (4 nights) when everything available', () => {
        const availabilities = withAvail({
            '2026-07-09': A, // Thu
            '2026-07-10': A, // Fri
            '2026-07-11': A, // Sat
            '2026-07-12': A, // Sun
            '2026-07-13': R, // Mon
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays,
            maxNights: 4,
        })
        expect(stays).toHaveLength(1)
        expect(stays[0]).toMatchObject({
            campsiteId: '100',
            startDate: '2026-07-09',
            endDate: '2026-07-13',
            nights: 4,
        })
    })

    test('cap at maxNights — Thu only when maxNights=1', () => {
        const availabilities = withAvail({
            '2026-07-09': A, // Thu
            '2026-07-10': A, // Fri
            '2026-07-11': A, // Sat
            '2026-07-12': A, // Sun
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays,
            maxNights: 1,
        })
        // Each consecutive cap-length run is emitted, then the next day starts
        // a new run. With maxNights=1 we get 4 stays back-to-back.
        expect(stays).toHaveLength(4)
        expect(stays.map(s => s.startDate)).toEqual([
            '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12',
        ])
        expect(stays.every(s => s.nights === 1)).toBe(true)
    })

    test('breaks the run on a Reserved night', () => {
        const availabilities = withAvail({
            '2026-07-09': A, // Thu
            '2026-07-10': R, // Fri
            '2026-07-11': A, // Sat
            '2026-07-12': A, // Sun
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays,
            maxNights: 4,
        })
        expect(stays).toHaveLength(2)
        expect(stays[0]).toMatchObject({ startDate: '2026-07-09', nights: 1 })
        expect(stays[1]).toMatchObject({ startDate: '2026-07-11', nights: 2, endDate: '2026-07-13' })
    })

    test('skips Monday-Wednesday because they are not in target weekdays', () => {
        const availabilities = withAvail({
            '2026-07-12': A, // Sun
            '2026-07-13': A, // Mon (target NOT set)
            '2026-07-14': A, // Tue
            '2026-07-15': A, // Wed
            '2026-07-16': A, // Thu
            '2026-07-17': A, // Fri
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays,
            maxNights: 4,
        })
        // Sun (1 night) then Thu-Fri (2 nights). Mon/Tue/Wed break the run.
        expect(stays).toHaveLength(2)
        expect(stays[0]).toMatchObject({ startDate: '2026-07-12', nights: 1 })
        expect(stays[1]).toMatchObject({ startDate: '2026-07-16', nights: 2 })
    })

    test('missing availability entries break the run (treated as not Available)', () => {
        const availabilities = withAvail({
            '2026-07-09': A, // Thu
            // 2026-07-10 missing
            '2026-07-11': A, // Sat
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays,
            maxNights: 4,
        })
        expect(stays.map(s => `${s.startDate}/${s.nights}`)).toEqual([
            '2026-07-09/1', '2026-07-11/1',
        ])
    })

    test('Closed status does not qualify', () => {
        const availabilities = withAvail({
            '2026-07-09': A,
            '2026-07-10': C,
            '2026-07-11': A,
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
        })
        expect(stays).toHaveLength(2)
    })

    test('minNights filter drops 1-nighters', () => {
        const availabilities = withAvail({
            '2026-07-09': A, // Thu — 1 night
            '2026-07-10': R, // Fri reserved
            '2026-07-11': A, // Sat
            '2026-07-12': A, // Sun — 2 nights
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
            minNights: 2,
        })
        expect(stays).toHaveLength(1)
        expect(stays[0]).toMatchObject({ startDate: '2026-07-11', nights: 2 })
    })

    test('respects range bounds (does not pick up Aug from a Jul-only window)', () => {
        const availabilities = withAvail({
            '2026-07-30': A, // Thu
            '2026-07-31': A, // Fri
            '2026-08-01': A, // Sat — outside range
        })
        const stays = findStaysForSite({
            campsiteId: '100',
            availabilities,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
        })
        expect(stays).toHaveLength(1)
        expect(stays[0]).toMatchObject({ startDate: '2026-07-30', nights: 2, endDate: '2026-08-01' })
    })
})

describe('findAllStays + rankStays', () => {
    test('aggregates across campsites and surfaces metadata', () => {
        const payload = {
            '100': {
                site: '044',
                loop: 'Upper Pines',
                campsite_type: 'STANDARD NONELECTRIC',
                max_num_people: 6,
                availabilities: withAvail({
                    '2026-07-09': A,
                    '2026-07-10': A,
                }),
            },
            '101': {
                site: '045',
                loop: 'Upper Pines',
                campsite_type: 'STANDARD NONELECTRIC',
                max_num_people: 6,
                availabilities: withAvail({
                    '2026-07-09': A,
                    '2026-07-10': A,
                    '2026-07-11': A,
                    '2026-07-12': A,
                }),
            },
        }
        const stays = findAllStays({
            campsitesPayload: payload,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
        })
        expect(stays).toHaveLength(2)
        const ranked = rankStays(stays)
        // 4-nighter ranks first, then 2-nighter.
        expect(ranked[0]).toMatchObject({ campsiteId: '101', nights: 4 })
        expect(ranked[1]).toMatchObject({ campsiteId: '100', nights: 2 })
        // Metadata propagated:
        expect(ranked[0].siteNo).toBe('045')
        expect(ranked[0].maxPeople).toBe(6)
    })

    test('minPeople drops sites whose max_num_people is below threshold', () => {
        const payload = {
            '100': { // capacity 4 — fails minPeople=6
                site: '044',
                max_num_people: 4,
                availabilities: withAvail({
                    '2026-07-09': A, '2026-07-10': A, '2026-07-11': A, '2026-07-12': A,
                }),
            },
            '101': { // capacity 6 — passes
                site: '045',
                max_num_people: 6,
                availabilities: withAvail({
                    '2026-07-09': A, '2026-07-10': A,
                }),
            },
            '102': { // capacity unknown — kept (better to alert than silently drop)
                site: '046',
                availabilities: withAvail({ '2026-07-11': A, '2026-07-12': A }),
            },
        }
        const stays = findAllStays({
            campsitesPayload: payload,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
            minPeople: 6,
        })
        const sites = stays.map(s => s.siteNo).sort()
        expect(sites).toEqual(['045', '046'])
    })

    test('minPeople=0 keeps every site (filter off)', () => {
        const payload = {
            '100': {
                site: '044',
                max_num_people: 2,
                availabilities: withAvail({ '2026-07-09': A, '2026-07-10': A }),
            },
        }
        const stays = findAllStays({
            campsitesPayload: payload,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
            minPeople: 0,
        })
        expect(stays).toHaveLength(1)
    })

    test('rank ties break by earliest startDate then lowest site number', () => {
        const payload = {
            '100': {
                site: '044',
                availabilities: withAvail({ '2026-07-16': A, '2026-07-17': A }),
            },
            '101': {
                site: '045',
                availabilities: withAvail({ '2026-07-09': A, '2026-07-10': A }),
            },
            '102': {
                site: '003',
                availabilities: withAvail({ '2026-07-09': A, '2026-07-10': A }),
            },
        }
        const stays = findAllStays({
            campsitesPayload: payload,
            rangeStartDate: '2026-07-01',
            rangeEndDate: '2026-07-31',
            targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
            maxNights: 4,
        })
        const ranked = rankStays(stays)
        // All same length (2 nights). Earlier date wins. Within same date,
        // lower siteNo wins.
        expect(ranked.map(s => s.siteNo)).toEqual(['003', '045', '044'])
    })
})
