import { windowDisplay } from '../windowDisplay.mjs'

describe('windowDisplay', () => {
    test('returns plain range when leadDays is 0', () => {
        const out = windowDisplay('2026-06-22', '2026-09-30', 0, '2026-06-22')
        expect(out).toBe('2026-06-22 → 2026-09-30')
    })

    test('returns plain range when leadDays is undefined', () => {
        const out = windowDisplay('2026-06-22', '2026-09-30', undefined, '2026-06-22')
        expect(out).toBe('2026-06-22 → 2026-09-30')
    })

    test('returns plain range when effective start equals static start', () => {
        // Happens when static rangeStartDate is already later than today+leadDays.
        const out = windowDisplay('2099-01-01', '2099-12-31', 15, '2099-01-01')
        expect(out).toBe('2099-01-01 → 2099-12-31')
    })

    test('annotates with effective floor + leadDays when lead pushes start forward', () => {
        const out = windowDisplay('2026-06-22', '2026-09-30', 15, '2026-07-11')
        expect(out).toBe('2026-06-22 → 2026-09-30 (effective from 2026-07-11, leadDays=15)')
    })
})
