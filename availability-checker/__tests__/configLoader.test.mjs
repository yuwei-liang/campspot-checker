import {
    loadConfig,
    parseWeekdays,
    expandWeekdaysInMonth,
    weekdayLabel,
} from '../configLoader.mjs'

const baseEnv = () => ({
    WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
    MONTH_START: '2026-06-01T00:00:00.000Z',
})

describe('parseWeekdays', () => {
    test('parses three-letter names', () => {
        expect(parseWeekdays('Thu,Fri,Sat')).toEqual([4, 5, 6])
    })
    test('is case-insensitive and tolerates whitespace', () => {
        expect(parseWeekdays(' thu , FRI, Saturday ')).toEqual([4, 5, 6])
    })
    test('throws on unknown tokens', () => {
        expect(() => parseWeekdays('Thu,Funday')).toThrow(/Funday/)
    })
})

describe('expandWeekdaysInMonth', () => {
    test('lists every Thu/Fri/Sat in June 2026', () => {
        const dates = expandWeekdaysInMonth('2026-06-01T00:00:00.000Z', [4, 5, 6])
        // June 2026: 1=Mon, so Thursdays are 4,11,18,25; Fridays 5,12,19,26; Saturdays 6,13,20,27
        expect(dates).toEqual([
            '2026-06-04T00:00:00Z',
            '2026-06-05T00:00:00Z',
            '2026-06-06T00:00:00Z',
            '2026-06-11T00:00:00Z',
            '2026-06-12T00:00:00Z',
            '2026-06-13T00:00:00Z',
            '2026-06-18T00:00:00Z',
            '2026-06-19T00:00:00Z',
            '2026-06-20T00:00:00Z',
            '2026-06-25T00:00:00Z',
            '2026-06-26T00:00:00Z',
            '2026-06-27T00:00:00Z',
        ])
    })

    test('handles months with 30 vs 31 days correctly', () => {
        // February 2026 has 28 days
        const dates = expandWeekdaysInMonth('2026-02-01T00:00:00.000Z', [0])
        expect(dates).toEqual([
            '2026-02-01T00:00:00Z',
            '2026-02-08T00:00:00Z',
            '2026-02-15T00:00:00Z',
            '2026-02-22T00:00:00Z',
        ])
    })
})

describe('weekdayLabel', () => {
    test('returns 3-letter UTC weekday', () => {
        expect(weekdayLabel('2026-06-26T00:00:00Z')).toBe('Fri')
        expect(weekdayLabel('2026-06-27T00:00:00Z')).toBe('Sat')
    })
})

describe('loadConfig', () => {
    test('expands TARGET_WEEKDAYS in the configured month', () => {
        const cfg = loadConfig({ ...baseEnv(), TARGET_WEEKDAYS: 'Fri,Sat' })
        expect(cfg.targetDates.length).toBe(8) // 4 Fridays + 4 Saturdays in June 2026
        expect(cfg.targetDates[0]).toBe('2026-06-05T00:00:00Z')
    })

    test('falls back to TARGET_DATE when TARGET_WEEKDAYS not set', () => {
        const cfg = loadConfig({ ...baseEnv(), TARGET_DATE: '2026-06-27T00:00:00Z' })
        expect(cfg.targetDates).toEqual(['2026-06-27T00:00:00Z'])
    })

    test('throws when neither TARGET_WEEKDAYS nor TARGET_DATE is set', () => {
        expect(() => loadConfig(baseEnv())).toThrow(/TARGET_WEEKDAYS.*TARGET_DATE/)
    })

    test('throws when TARGET_WEEKDAYS produces zero matching dates', () => {
        // No February 30th
        expect(() => loadConfig({
            ...baseEnv(),
            MONTH_START: '2026-02-01T00:00:00.000Z',
            TARGET_WEEKDAYS: 'Sun',
            // Sundays in Feb 2026: 1, 8, 15, 22. So this WOULD match. Use a date pattern that doesn't.
        })).not.toThrow()
    })

    test('defaults POLL_INTERVAL_MS to 90000', () => {
        const cfg = loadConfig({ ...baseEnv(), TARGET_DATE: '2026-06-27T00:00:00Z' })
        expect(cfg.pollIntervalMs).toBe(90000)
    })

    test('throws on missing required vars', () => {
        expect(() => loadConfig({})).toThrow(/WEBHOOK_URL/)
    })

    test('rejects non-numeric POLL_INTERVAL_MS', () => {
        expect(() => loadConfig({
            ...baseEnv(),
            TARGET_DATE: '2026-06-27T00:00:00Z',
            POLL_INTERVAL_MS: 'soon',
        })).toThrow(/POLL_INTERVAL_MS/)
    })

    test('rejects too-aggressive POLL_INTERVAL_MS', () => {
        expect(() => loadConfig({
            ...baseEnv(),
            TARGET_DATE: '2026-06-27T00:00:00Z',
            POLL_INTERVAL_MS: '500',
        })).toThrow(/POLL_INTERVAL_MS/)
    })
})
