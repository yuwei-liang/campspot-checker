import { todayInPT, getActiveTargetDates, describeActiveDates } from '../dateRoll.mjs'

// Pin "now" to known UTC instants so PT crossings are deterministic.
// 2026-06-12 14:00 UTC = 07:00 PT (release moment for night 06-19).
const PT_0700_2026_06_12 = new Date('2026-06-12T14:00:00Z')
// 2026-06-13 06:30 UTC = 23:30 PT on 06-12 (still "yesterday" in PT).
const PT_2330_2026_06_12 = new Date('2026-06-13T06:30:00Z')
// 2026-06-13 07:30 UTC = 00:30 PT on 06-13 (just past midnight PT).
const PT_0030_2026_06_13 = new Date('2026-06-13T07:30:00Z')

describe('todayInPT()', () => {
    test('returns the PT calendar day, not the UTC day', () => {
        // At 06:30 UTC on 06-13, PT clock reads 23:30 on 06-12 — still 06-12.
        expect(todayInPT(PT_2330_2026_06_12)).toBe('2026-06-12')
    })

    test('rolls over at midnight PT', () => {
        expect(todayInPT(PT_0030_2026_06_13)).toBe('2026-06-13')
    })

    test('handles 7am PT release moment', () => {
        expect(todayInPT(PT_0700_2026_06_12)).toBe('2026-06-12')
    })
})

describe('getActiveTargetDates() — auto-roll (offsets) mode', () => {
    test('[7, 8] on 2026-06-12 PT → next two release nights', () => {
        const cfg = { targetDateOffsetsDays: [7, 8] }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([
            '2026-06-19',
            '2026-06-20',
        ])
    })

    test('same offsets one day later rolls forward', () => {
        const cfg = { targetDateOffsetsDays: [7, 8] }
        expect(getActiveTargetDates(cfg, PT_0030_2026_06_13)).toEqual([
            '2026-06-20',
            '2026-06-21',
        ])
    })

    test('offsets win when both fields are present', () => {
        const cfg = {
            targetDateOffsetsDays: [7],
            targetDates: ['2099-01-01'],
        }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual(['2026-06-19'])
    })

    test('dedupes overlapping offsets', () => {
        const cfg = { targetDateOffsetsDays: [7, 7, 8] }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([
            '2026-06-19',
            '2026-06-20',
        ])
    })

    test('single offset works', () => {
        const cfg = { targetDateOffsetsDays: [7] }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual(['2026-06-19'])
    })

    test('offsets crossing a month boundary compute correctly', () => {
        // 2026-06-25 + 7 = 2026-07-02
        const onJune25 = new Date('2026-06-25T18:00:00Z') // 11am PT
        expect(getActiveTargetDates({ targetDateOffsetsDays: [7] }, onJune25)).toEqual([
            '2026-07-02',
        ])
    })

    test('non-numeric offsets are silently dropped', () => {
        const cfg = { targetDateOffsetsDays: [7, 'oops', null, 8] }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([
            '2026-06-19',
            '2026-06-20',
        ])
    })

    test('empty offsets array falls through to static list', () => {
        const cfg = {
            targetDateOffsetsDays: [],
            targetDates: ['2026-06-19'],
        }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual(['2026-06-19'])
    })
})

describe('getActiveTargetDates() — static list mode', () => {
    test('keeps today + future, drops past', () => {
        const cfg = {
            targetDates: ['2026-06-10', '2026-06-12', '2026-06-19', '2026-06-20'],
        }
        // today=2026-06-12 → keep 06-12 (same day), 06-19, 06-20; drop 06-10.
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([
            '2026-06-12',
            '2026-06-19',
            '2026-06-20',
        ])
    })

    test('all-past list returns empty', () => {
        const cfg = { targetDates: ['2026-06-01', '2026-06-05'] }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([])
    })

    test('dedupes and sorts', () => {
        const cfg = {
            targetDates: ['2026-06-20', '2026-06-19', '2026-06-20'],
        }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([
            '2026-06-19',
            '2026-06-20',
        ])
    })

    test('ignores malformed entries', () => {
        const cfg = {
            targetDates: ['2026-06-19', 'tomorrow', '2026/06/20', null, '2026-06-21'],
        }
        expect(getActiveTargetDates(cfg, PT_0700_2026_06_12)).toEqual([
            '2026-06-19',
            '2026-06-21',
        ])
    })

    test('missing config returns empty', () => {
        expect(getActiveTargetDates({}, PT_0700_2026_06_12)).toEqual([])
    })

    test('static list survives crossing into a date (boundary at midnight PT)', () => {
        const cfg = { targetDates: ['2026-06-13'] }
        // Just before midnight PT on 06-12 → today=06-12 → keep 06-13
        expect(getActiveTargetDates(cfg, PT_2330_2026_06_12)).toEqual(['2026-06-13'])
        // Just after midnight PT on 06-13 → today=06-13 → still keep 06-13 (same day)
        expect(getActiveTargetDates(cfg, PT_0030_2026_06_13)).toEqual(['2026-06-13'])
    })
})

describe('describeActiveDates()', () => {
    test('auto-roll mode notes offsets', () => {
        const s = describeActiveDates({ targetDateOffsetsDays: [7, 8] }, PT_0700_2026_06_12)
        expect(s).toMatch(/auto-roll/)
        expect(s).toMatch(/2026-06-19/)
        expect(s).toMatch(/2026-06-20/)
    })

    test('static mode flags dropped past dates', () => {
        const s = describeActiveDates(
            { targetDates: ['2026-06-10', '2026-06-19'] },
            PT_0700_2026_06_12,
        )
        expect(s).toMatch(/static/)
        expect(s).toMatch(/dropped past.*2026-06-10/)
    })
})
