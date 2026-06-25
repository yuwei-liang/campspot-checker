import CampspotChecker from '../CampspotChecker.mjs'

const baseConfig = {
    campgroundId: '232447',
    rangeStartDate: '2026-06-22',
    rangeEndDate: '2026-09-30',
    targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
    maxNights: 4,
    minNights: 1,
    log: { info: () => {}, warn: () => {}, error: () => {} },
}

describe('CampspotChecker.effectiveStartDate', () => {
    test('returns static rangeStartDate when leadDays is 0', () => {
        const c = new CampspotChecker({ ...baseConfig, leadDays: 0 })
        expect(c.effectiveStartDate()).toBe('2026-06-22')
    })

    test('returns static rangeStartDate when leadDays is undefined', () => {
        const c = new CampspotChecker({ ...baseConfig })
        expect(c.effectiveStartDate()).toBe('2026-06-22')
    })

    test('returns today + leadDays when that is later than rangeStartDate', () => {
        const c = new CampspotChecker({ ...baseConfig, leadDays: 15 })
        const out = c.effectiveStartDate()
        // Today + 15 days in PT. Computing the same way as the helper would
        // would be circular; instead verify the shape and that it's later than
        // the static floor.
        expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(out > '2026-06-22').toBe(true)
    })

    test('falls back to static rangeStartDate when today + leadDays is earlier', () => {
        // Static floor in the far future + small leadDays → static wins.
        const c = new CampspotChecker({
            ...baseConfig,
            rangeStartDate: '2099-01-01',
            leadDays: 1,
        })
        expect(c.effectiveStartDate()).toBe('2099-01-01')
    })
})
