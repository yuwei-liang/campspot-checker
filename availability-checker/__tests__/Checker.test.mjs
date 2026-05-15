import Checker from '../Checker.mjs'

// Checker references global.logger; provide a silent stub for tests.
global.logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
}

const TARGET_DATE = '2026-06-27T00:00:00Z'
const MONTH_START = '2026-06-01T00:00:00.000Z'
const WEBHOOK = 'https://discord.com/api/webhooks/123/abc'

const fixture = () => ({
    campsites: {
        '100': {
            site: '100',
            campsite_id: 'cs-100',
            availabilities: {
                [TARGET_DATE]: 'Available',
                '2026-06-28T00:00:00Z': 'Reserved',
            },
        },
        '101': {
            site: '101',
            campsite_id: 'cs-101',
            availabilities: {
                [TARGET_DATE]: 'Reserved',
            },
        },
        '102': {
            site: '102',
            campsite_id: 'cs-102',
            availabilities: {
                // targetDate missing entirely → undefined → counted as unavailable
            },
        },
        '103': {
            site: '103',
            campsite_id: 'cs-103',
            availabilities: {
                [TARGET_DATE]: 'NYR',
            },
        },
        '104': {
            site: '104',
            campsite_id: 'cs-104',
            availabilities: {
                [TARGET_DATE]: 'Closed',
            },
        },
    },
})

describe('Checker', () => {
    test('constructor requires monthStart', () => {
        expect(() => new Checker([], TARGET_DATE, WEBHOOK)).toThrow(/monthStart/)
    })

    test('constructor requires targetDate', () => {
        expect(() => new Checker([], undefined, WEBHOOK, MONTH_START)).toThrow(/targetDate/)
    })

    test('__getSiteAvailabilities classifies sites by UNAVAILABLE_STATUSES at targetDate', () => {
        const checker = new Checker([], TARGET_DATE, WEBHOOK, MONTH_START)
        const result = checker.__getSiteAvailabilities(fixture())

        const byNo = Object.fromEntries(result.map(r => [r.siteNO, r]))
        expect(byNo['100'].isAvailable).toBe(true)
        expect(byNo['101'].isAvailable).toBe(false)
        expect(byNo['102'].isAvailable).toBe(false)
        expect(byNo['103'].isAvailable).toBe(false)
        expect(byNo['104'].isAvailable).toBe(false)
    })

    test('backoff starts at 0', () => {
        const checker = new Checker([], TARGET_DATE, WEBHOOK, MONTH_START)
        expect(checker.getBackoffMs()).toBe(0)
    })

    test('__handleError grows backoff exponentially on 429', () => {
        const checker = new Checker([], TARGET_DATE, WEBHOOK, MONTH_START)
        const fakeCampground = { toString: () => '[fake]' }
        const err = { response: { status: 429, headers: {} } }

        checker.__handleError(err, fakeCampground)
        const first = checker.getBackoffMs()
        checker.__handleError(err, fakeCampground)
        const second = checker.getBackoffMs()
        checker.__handleError(err, fakeCampground)
        const third = checker.getBackoffMs()

        expect(first).toBeGreaterThan(0)
        expect(second).toBe(first * 2)
        expect(third).toBe(second * 2)
    })

    test('__handleError honors Retry-After header (in seconds)', () => {
        const checker = new Checker([], TARGET_DATE, WEBHOOK, MONTH_START)
        const err = {
            response: {
                status: 429,
                headers: { 'retry-after': '30' },
            },
        }
        checker.__handleError(err, { toString: () => '[fake]' })
        expect(checker.getBackoffMs()).toBe(30 * 1000)
    })

    test('formatAvailabilityMessage includes campground booking link and per-site URLs', () => {
        const checker = new Checker([], TARGET_DATE, WEBHOOK, MONTH_START)
        const campground = {
            toString: () => '[Yosemite][Upper Pines Campground][id:232447]',
            getBookingUrl: () => 'https://www.recreation.gov/camping/campgrounds/232447',
        }
        const sites = [
            { siteNO: '044', campsiteId: '100' },
            { siteNO: '045', campsiteId: '101' },
        ]

        const msg = checker.formatAvailabilityMessage(campground, sites, TARGET_DATE)

        expect(msg).toContain('[Yosemite][Upper Pines Campground][id:232447]')
        expect(msg).toContain('2 site(s) available on 2026-06-27')
        expect(msg).toContain('https://www.recreation.gov/camping/campgrounds/232447')
        expect(msg).toContain('Site 044: https://www.recreation.gov/camping/campsites/100')
        expect(msg).toContain('Site 045: https://www.recreation.gov/camping/campsites/101')
    })

    test('__resetBackoff zeroes out state', () => {
        const checker = new Checker([], TARGET_DATE, WEBHOOK, MONTH_START)
        checker.backoffMs = 5000
        checker.lastErrorReason = 'HTTP 429'
        checker.__resetBackoff()
        expect(checker.getBackoffMs()).toBe(0)
        expect(checker.lastErrorReason).toBeNull()
    })
})
