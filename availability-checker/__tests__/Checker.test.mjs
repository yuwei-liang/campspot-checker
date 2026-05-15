import Checker from '../Checker.mjs'

// Checker references global.logger; provide a silent stub for tests.
global.logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
}

const TARGET_DATE = '2026-06-27T00:00:00Z'
const TARGET_DATES = [TARGET_DATE]
const MONTH_START = '2026-06-01T00:00:00.000Z'
const WEBHOOK = 'https://discord.com/api/webhooks/123/abc'

const fixture = () => ({
    campsites: {
        '100': {
            site: '100',
            campsite_id: 'cs-100',
            loop: 'Loop A',
            campsite_type: 'STANDARD ELECTRIC',
            max_num_people: 6,
            availabilities: {
                [TARGET_DATE]: 'Available',
                '2026-06-28T00:00:00Z': 'Reserved',
            },
        },
        '101': {
            site: '101',
            campsite_id: 'cs-101',
            loop: 'Loop A',
            campsite_type: 'TENT ONLY NONELECTRIC',
            max_num_people: 4,
            availabilities: {
                [TARGET_DATE]: 'Reserved',
            },
        },
        '102': {
            site: '102',
            campsite_id: 'cs-102',
            availabilities: {},
        },
        '103': {
            site: '103',
            campsite_id: 'cs-103',
            availabilities: { [TARGET_DATE]: 'NYR' },
        },
        '104': {
            site: '104',
            campsite_id: 'cs-104',
            availabilities: { [TARGET_DATE]: 'Closed' },
        },
    },
})

describe('Checker', () => {
    test('constructor requires monthStarts non-empty array', () => {
        expect(() => new Checker([], TARGET_DATES, WEBHOOK)).toThrow(/monthStarts/)
        expect(() => new Checker([], TARGET_DATES, WEBHOOK, [])).toThrow(/monthStarts/)
    })

    test('constructor requires targetDates non-empty array', () => {
        expect(() => new Checker([], [], WEBHOOK, [MONTH_START])).toThrow(/targetDates/)
        expect(() => new Checker([], undefined, WEBHOOK, [MONTH_START])).toThrow(/targetDates/)
    })

    test('__getSiteAvailabilities classifies sites by UNAVAILABLE_STATUSES per date', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        const result = checker.__getSiteAvailabilities(fixture())

        const byNo = Object.fromEntries(result.map(r => [r.siteNO, r]))
        expect(byNo['100'].availableDates).toEqual([TARGET_DATE])
        expect(byNo['101'].availableDates).toEqual([])
        expect(byNo['102'].availableDates).toEqual([])
        expect(byNo['103'].availableDates).toEqual([])
        expect(byNo['104'].availableDates).toEqual([])
    })

    test('__getSiteAvailabilities captures loop / campsite_type / max_num_people', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        const result = checker.__getSiteAvailabilities(fixture())
        const site100 = result.find(s => s.siteNO === '100')
        expect(site100.loop).toBe('Loop A')
        expect(site100.campsiteType).toBe('STANDARD ELECTRIC')
        expect(site100.maxPeople).toBe(6)
    })

    test('__getSiteAvailabilities returns null for missing detail fields', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        const result = checker.__getSiteAvailabilities(fixture())
        const site102 = result.find(s => s.siteNO === '102')
        expect(site102.loop).toBeNull()
        expect(site102.campsiteType).toBeNull()
        expect(site102.maxPeople).toBeNull()
    })

    test('__mergeCampsites unions availabilities across months for the same campsite_id', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, ['2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'])
        const combined = {}
        checker.__mergeCampsites(combined, {
            '1': {
                site: 'A1', campsite_id: 'c1',
                availabilities: { '2026-06-26T00:00:00Z': 'Available' },
            },
        })
        checker.__mergeCampsites(combined, {
            '1': {
                site: 'A1', campsite_id: 'c1',
                availabilities: { '2026-07-04T00:00:00Z': 'Available' },
            },
            '2': {
                site: 'B2', campsite_id: 'c2',
                availabilities: { '2026-07-04T00:00:00Z': 'Reserved' },
            },
        })
        expect(combined['1'].availabilities).toEqual({
            '2026-06-26T00:00:00Z': 'Available',
            '2026-07-04T00:00:00Z': 'Available',
        })
        expect(combined['2']).toBeDefined()
    })

    test('multi-date: a site available on one date but reserved another reports only the open date', () => {
        const dates = ['2026-06-26T00:00:00Z', '2026-06-27T00:00:00Z']
        const checker = new Checker([], dates, WEBHOOK, [MONTH_START])
        const json = {
            campsites: {
                '1': {
                    site: 'A1',
                    campsite_id: 'c1',
                    availabilities: {
                        '2026-06-26T00:00:00Z': 'Available',
                        '2026-06-27T00:00:00Z': 'Reserved',
                    },
                },
            },
        }
        const result = checker.__getSiteAvailabilities(json)
        expect(result[0].availableDates).toEqual(['2026-06-26T00:00:00Z'])
    })

    test('backoff starts at 0', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        expect(checker.getBackoffMs()).toBe(0)
    })

    test('executeCheck refuses to start a second cycle while one is running', async () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        checker.cycleState.currentlyRunning = true
        const result = await checker.executeCheck()
        expect(result).toEqual({ ran: false, reason: 'already_running' })
        expect(checker.cycleState.cycleCount).toBe(0)
    })

    test('executeCheck reports ran:true on a clean cycle and increments cycleCount', async () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        const result = await checker.executeCheck()
        expect(result).toEqual({ ran: true })
        expect(checker.cycleState.cycleCount).toBe(1)
        expect(checker.cycleState.currentlyRunning).toBe(false)
    })

    test('__handleError grows backoff exponentially on 429', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        const fakeCampground = { toString: () => '[fake]' }
        const err = { response: { status: 429, headers: {} } }

        checker.__handleError(err, fakeCampground)
        const first = checker.getBackoffMs()
        checker.__handleError(err, fakeCampground)
        const second = checker.getBackoffMs()

        expect(first).toBeGreaterThan(0)
        expect(second).toBe(first * 2)
    })

    test('__handleError honors Retry-After header (in seconds)', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        const err = { response: { status: 429, headers: { 'retry-after': '30' } } }
        checker.__handleError(err, { toString: () => '[fake]' })
        expect(checker.getBackoffMs()).toBe(30 * 1000)
    })

    describe('getStatus', () => {
        test('initial status is pending for every campground, in original order', () => {
            const campgrounds = [
                { name: 'Upper Pines', id: 232447, park: 'Yosemite' },
                { name: 'Lower Pines', id: 232450, park: 'Yosemite' },
            ]
            const checker = new Checker(campgrounds, TARGET_DATES, WEBHOOK, [MONTH_START])
            const status = checker.getStatus()

            expect(status.targetDates).toEqual(TARGET_DATES)
            expect(status.monthStarts).toEqual([MONTH_START])
            expect(status.backoffMs).toBe(0)
            expect(status.cycle.cycleCount).toBe(0)
            expect(status.campgrounds).toHaveLength(2)
            expect(status.campgrounds[0].id).toBe(232447)
            expect(status.campgrounds[0].status).toBe('pending')
            expect(status.campgrounds[0].availableByDate).toEqual({})
        })

        test('campground metadata fields surface in status output', () => {
            const campgrounds = [{
                name: 'Upper Pines',
                id: 232447,
                park: 'Yosemite',
                valleyDriveMinutes: 0,
                elevationFt: 4000,
                season: 'year-round',
                totalSites: 238,
                accessType: 'drive-in',
            }]
            const checker = new Checker(campgrounds, TARGET_DATES, WEBHOOK, [MONTH_START])
            const cg = checker.getStatus().campgrounds[0]
            expect(cg.meta).toEqual({
                valleyDriveMinutes: 0,
                elevationFt: 4000,
                season: 'year-round',
                totalSites: 238,
                accessType: 'drive-in',
            })
        })

        test('campground metadata defaults to nulls when omitted', () => {
            const campgrounds = [{ name: 'X', id: 1, park: 'Y' }]
            const checker = new Checker(campgrounds, TARGET_DATES, WEBHOOK, [MONTH_START])
            const cg = checker.getStatus().campgrounds[0]
            expect(cg.meta).toEqual({
                valleyDriveMinutes: null,
                elevationFt: null,
                season: null,
                totalSites: null,
                accessType: null,
            })
        })

        test('report() advances state to all_reserved with zero counts when no sites open', () => {
            const campgrounds = [{ name: 'Upper Pines', id: 232447, park: 'Yosemite' }]
            const checker = new Checker(campgrounds, TARGET_DATES, WEBHOOK, [MONTH_START])
            const mockCampground = {
                id: 232447,
                toString: () => '[Yosemite][Upper Pines]',
                getBookingUrl: () => 'https://example.test/cg/232447',
            }
            checker.notifier.notify = () => {}

            checker.report(mockCampground, {
                data: { campsites: { '1': { site: '1', campsite_id: 'c1', availabilities: { [TARGET_DATE]: 'Reserved' } } } },
            })

            const cg = checker.getStatus().campgrounds[0]
            expect(cg.status).toBe('all_reserved')
            expect(cg.availableByDate).toEqual({ [TARGET_DATE]: 0 })
            expect(cg.availableSites).toEqual([])
        })

        test('report() carries site detail and per-date counts when sites open', () => {
            const dates = ['2026-06-26T00:00:00Z', '2026-06-27T00:00:00Z']
            const campgrounds = [{ name: 'Atwell', id: 10044710, park: 'Sequoia' }]
            const checker = new Checker(campgrounds, dates, WEBHOOK, [MONTH_START])
            const mockCampground = {
                id: 10044710,
                toString: () => '[Sequoia][Atwell]',
                getBookingUrl: () => 'https://example.test/cg/10044710',
            }
            const notifyCalls = []
            checker.notifier.notify = (m) => notifyCalls.push(m)

            checker.report(mockCampground, {
                data: {
                    campsites: {
                        '1': {
                            site: '02',
                            campsite_id: 'c2',
                            loop: 'East',
                            campsite_type: 'TENT ONLY',
                            max_num_people: 8,
                            availabilities: {
                                '2026-06-26T00:00:00Z': 'Available',
                                '2026-06-27T00:00:00Z': 'Reserved',
                            },
                        },
                        '2': {
                            site: '03',
                            campsite_id: 'c3',
                            loop: 'East',
                            campsite_type: 'TENT ONLY',
                            max_num_people: 6,
                            availabilities: {
                                '2026-06-26T00:00:00Z': 'Available',
                                '2026-06-27T00:00:00Z': 'Available',
                            },
                        },
                    },
                },
            })

            const cg = checker.getStatus().campgrounds[0]
            expect(cg.status).toBe('available')
            expect(cg.availableByDate).toEqual({
                '2026-06-26T00:00:00Z': 2,
                '2026-06-27T00:00:00Z': 1,
            })
            expect(cg.availableSites).toHaveLength(2)
            expect(cg.availableSites[0].loop).toBe('East')
            expect(cg.availableSites[0].campsiteType).toBe('TENT ONLY')
            expect(cg.availableSites[0].maxPeople).toBe(8)
            expect(notifyCalls).toHaveLength(1)
            // message groups by date and includes per-site detail
            expect(notifyCalls[0]).toMatch(/Fri 2026-06-26 \(2\):/)
            expect(notifyCalls[0]).toMatch(/Sat 2026-06-27 \(1\):/)
            expect(notifyCalls[0]).toMatch(/Site 02 \(East, TENT ONLY, max 8\):/)
        })

        test('__handleError marks the campground as error with the failure reason', () => {
            const campgrounds = [{ name: 'Upper Pines', id: 232447, park: 'Yosemite' }]
            const checker = new Checker(campgrounds, TARGET_DATES, WEBHOOK, [MONTH_START])
            const err = { response: { status: 429, headers: { 'retry-after': '30' } } }
            const fakeCampground = { id: 232447, toString: () => '[Yosemite][Upper Pines]' }

            checker.__handleError(err, fakeCampground)

            const cg = checker.getStatus().campgrounds[0]
            expect(cg.status).toBe('error')
            expect(cg.error).toBe('Retry-After:30')
        })
    })

    test('__resetBackoff zeroes out state', () => {
        const checker = new Checker([], TARGET_DATES, WEBHOOK, [MONTH_START])
        checker.backoffMs = 5000
        checker.lastErrorReason = 'HTTP 429'
        checker.__resetBackoff()
        expect(checker.getBackoffMs()).toBe(0)
        expect(checker.lastErrorReason).toBeNull()
    })
})
