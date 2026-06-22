import CampspotChecker, { monthStartsFor } from '../CampspotChecker.mjs'

describe('monthStartsFor', () => {
    test('inclusive across multi-month range', () => {
        expect(monthStartsFor('2026-06-22', '2026-09-30')).toEqual([
            new Date(Date.UTC(2026, 5, 1)).toISOString(),
            new Date(Date.UTC(2026, 6, 1)).toISOString(),
            new Date(Date.UTC(2026, 7, 1)).toISOString(),
            new Date(Date.UTC(2026, 8, 1)).toISOString(),
        ])
    })

    test('single-month range yields one start', () => {
        expect(monthStartsFor('2026-07-15', '2026-07-20')).toEqual([
            new Date(Date.UTC(2026, 6, 1)).toISOString(),
        ])
    })

    test('crosses a year boundary', () => {
        expect(monthStartsFor('2026-12-15', '2027-01-05')).toEqual([
            new Date(Date.UTC(2026, 11, 1)).toISOString(),
            new Date(Date.UTC(2027, 0, 1)).toISOString(),
        ])
    })
})

describe('CampspotChecker.diff', () => {
    const baseConfig = {
        campgroundId: '232447',
        rangeStartDate: '2026-07-01',
        rangeEndDate: '2026-07-31',
        targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
        maxNights: 4,
        minNights: 1,
        log: { info: () => {}, warn: () => {}, error: () => {} },
    }

    const A = 'Available'

    test('returns only NEW stays on second poll if state unchanged', () => {
        const checker = new CampspotChecker(baseConfig)
        const payload = {
            '100': {
                site: '044',
                availabilities: {
                    '2026-07-09T00:00:00Z': A,
                    '2026-07-10T00:00:00Z': A,
                },
            },
        }
        const first = checker.diff(payload)
        expect(first.snapshot.stays).toHaveLength(1)
        expect(first.newStays).toHaveLength(1)
        const second = checker.diff(payload)
        expect(second.snapshot.stays).toHaveLength(1)
        expect(second.newStays).toHaveLength(0)
    })

    test('re-fires when a stay disappears and reappears', () => {
        const checker = new CampspotChecker(baseConfig)
        const payloadOpen = {
            '100': {
                site: '044',
                availabilities: { '2026-07-09T00:00:00Z': A, '2026-07-10T00:00:00Z': A },
            },
        }
        const payloadClosed = {
            '100': {
                site: '044',
                availabilities: { '2026-07-09T00:00:00Z': 'Reserved', '2026-07-10T00:00:00Z': 'Reserved' },
            },
        }
        expect(checker.diff(payloadOpen).newStays).toHaveLength(1)
        expect(checker.diff(payloadClosed).newStays).toHaveLength(0)
        // After disappearing it should re-emit as new on next reappearance.
        expect(checker.diff(payloadOpen).newStays).toHaveLength(1)
    })
})
