import {
    loadConfig,
    parseWeekdays,
    generateMonthStarts,
    expandWeekdaysAcrossMonths,
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

describe('generateMonthStarts', () => {
    test('returns N consecutive months starting from given date', () => {
        const months = generateMonthStarts('2026-06-01T00:00:00.000Z', 4)
        expect(months).toEqual([
            '2026-06-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z',
            '2026-08-01T00:00:00.000Z',
            '2026-09-01T00:00:00.000Z',
        ])
    })

    test('rolls over year boundary correctly', () => {
        const months = generateMonthStarts('2026-11-01T00:00:00.000Z', 3)
        expect(months).toEqual([
            '2026-11-01T00:00:00.000Z',
            '2026-12-01T00:00:00.000Z',
            '2027-01-01T00:00:00.000Z',
        ])
    })

    test('count of 1 returns just the input month', () => {
        const months = generateMonthStarts('2026-06-01T00:00:00.000Z', 1)
        expect(months).toEqual(['2026-06-01T00:00:00.000Z'])
    })

    test('rejects count outside 1..12', () => {
        expect(() => generateMonthStarts('2026-06-01T00:00:00.000Z', 0)).toThrow(/MONTHS_TO_SCAN/)
        expect(() => generateMonthStarts('2026-06-01T00:00:00.000Z', 13)).toThrow(/MONTHS_TO_SCAN/)
    })
})

describe('expandWeekdaysAcrossMonths', () => {
    test('expands Thu/Fri/Sat across June+July 2026', () => {
        const months = generateMonthStarts('2026-06-01T00:00:00.000Z', 2)
        const dates = expandWeekdaysAcrossMonths(months, [4, 5, 6])
        // June: 12 dates, July: 13 dates (Thu 7/2, 7/9, 7/16, 7/23, 7/30; Fri 7/3, 7/10, 7/17, 7/24, 7/31; Sat 7/4, 7/11, 7/18, 7/25)
        expect(dates.length).toBeGreaterThan(20)
        expect(dates[0]).toBe('2026-06-04T00:00:00Z')
        expect(dates.includes('2026-07-04T00:00:00Z')).toBe(true)
        expect(dates[dates.length - 1].startsWith('2026-07-')).toBe(true)
    })

    test('handles a single month identically to expandWeekdaysInMonth', () => {
        const dates = expandWeekdaysAcrossMonths(['2026-06-01T00:00:00.000Z'], [4, 5, 6])
        expect(dates).toHaveLength(12)
        expect(dates[0]).toBe('2026-06-04T00:00:00Z')
    })
})

describe('weekdayLabel', () => {
    test('returns 3-letter UTC weekday', () => {
        expect(weekdayLabel('2026-06-26T00:00:00Z')).toBe('Fri')
        expect(weekdayLabel('2026-06-27T00:00:00Z')).toBe('Sat')
    })
})

describe('loadConfig', () => {
    test('defaults MONTHS_TO_SCAN to 1', () => {
        const cfg = loadConfig({ ...baseEnv(), TARGET_DATE: '2026-06-27T00:00:00Z' })
        expect(cfg.monthStarts).toEqual(['2026-06-01T00:00:00.000Z'])
    })

    test('expands MONTHS_TO_SCAN=4 to four consecutive months', () => {
        const cfg = loadConfig({
            ...baseEnv(),
            MONTHS_TO_SCAN: '4',
            TARGET_WEEKDAYS: 'Fri,Sat',
        })
        expect(cfg.monthStarts).toEqual([
            '2026-06-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z',
            '2026-08-01T00:00:00.000Z',
            '2026-09-01T00:00:00.000Z',
        ])
    })

    test('expands TARGET_WEEKDAYS across all months in scan', () => {
        const cfg = loadConfig({
            ...baseEnv(),
            MONTHS_TO_SCAN: '4',
            TARGET_WEEKDAYS: 'Sat',
        })
        // Saturdays in Jun(4) + Jul(4) + Aug(5) + Sep(4) 2026 = 17
        expect(cfg.targetDates.length).toBe(17)
    })

    test('falls back to TARGET_DATE when TARGET_WEEKDAYS not set', () => {
        const cfg = loadConfig({ ...baseEnv(), TARGET_DATE: '2026-06-27T00:00:00Z' })
        expect(cfg.targetDates).toEqual(['2026-06-27T00:00:00Z'])
    })

    test('throws when neither TARGET_WEEKDAYS nor TARGET_DATE is set', () => {
        expect(() => loadConfig(baseEnv())).toThrow(/TARGET_WEEKDAYS.*TARGET_DATE/)
    })

    test('throws on invalid MONTHS_TO_SCAN', () => {
        expect(() => loadConfig({
            ...baseEnv(),
            MONTHS_TO_SCAN: 'forever',
            TARGET_WEEKDAYS: 'Sat',
        })).toThrow(/MONTHS_TO_SCAN/)
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
