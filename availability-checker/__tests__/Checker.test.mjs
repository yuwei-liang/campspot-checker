import Checker from '../Checker.mjs'
import { openDatabase } from '../db/db.mjs'
import { createCampgroundsRepo } from '../db/campgroundsRepo.mjs'
import { createCyclesRepo } from '../db/cyclesRepo.mjs'
import { createAvailabilityRepo } from '../db/availabilityRepo.mjs'

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

const mkChecker = (campgrounds = [], targetDates = TARGET_DATES, monthStarts = [MONTH_START]) => {
    const db = openDatabase(':memory:')
    const repos = {
        campgrounds: createCampgroundsRepo(db),
        cycles: createCyclesRepo(db),
        availability: createAvailabilityRepo(db),
    }
    repos.campgrounds.upsertMany(campgrounds)
    const checker = new Checker(repos, targetDates, WEBHOOK, monthStarts)
    return { checker, db, repos }
}

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
            availabilities: { [TARGET_DATE]: 'Reserved' },
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
        const db = openDatabase(':memory:')
        const repos = {
            campgrounds: createCampgroundsRepo(db),
            cycles: createCyclesRepo(db),
            availability: createAvailabilityRepo(db),
        }
        expect(() => new Checker(repos, TARGET_DATES, WEBHOOK)).toThrow(/monthStarts/)
        expect(() => new Checker(repos, TARGET_DATES, WEBHOOK, [])).toThrow(/monthStarts/)
    })

    test('constructor requires targetDates non-empty array', () => {
        const db = openDatabase(':memory:')
        const repos = {
            campgrounds: createCampgroundsRepo(db),
            cycles: createCyclesRepo(db),
            availability: createAvailabilityRepo(db),
        }
        expect(() => new Checker(repos, [], WEBHOOK, [MONTH_START])).toThrow(/targetDates/)
        expect(() => new Checker(repos, undefined, WEBHOOK, [MONTH_START])).toThrow(/targetDates/)
    })

    test('__getSiteAvailabilities classifies sites by UNAVAILABLE_STATUSES per date', () => {
        const { checker } = mkChecker()
        const result = checker.__getSiteAvailabilities(fixture())
        const byNo = Object.fromEntries(result.map(r => [r.siteNO, r]))
        expect(byNo['100'].availableDates).toEqual([TARGET_DATE])
        expect(byNo['101'].availableDates).toEqual([])
        expect(byNo['102'].availableDates).toEqual([])
        expect(byNo['103'].availableDates).toEqual([])
        expect(byNo['104'].availableDates).toEqual([])
    })

    test('__getSiteAvailabilities captures loop / campsite_type / max_num_people', () => {
        const { checker } = mkChecker()
        const result = checker.__getSiteAvailabilities(fixture())
        const site100 = result.find(s => s.siteNO === '100')
        expect(site100.loop).toBe('Loop A')
        expect(site100.campsiteType).toBe('STANDARD ELECTRIC')
        expect(site100.maxPeople).toBe(6)
    })

    test('__mergeCampsites unions availabilities across months for the same campsite_id', () => {
        const { checker } = mkChecker([], TARGET_DATES, ['2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'])
        const combined = {}
        checker.__mergeCampsites(combined, {
            '1': { site: 'A1', campsite_id: 'c1', availabilities: { '2026-06-26T00:00:00Z': 'Available' } },
        })
        checker.__mergeCampsites(combined, {
            '1': { site: 'A1', campsite_id: 'c1', availabilities: { '2026-07-04T00:00:00Z': 'Available' } },
            '2': { site: 'B2', campsite_id: 'c2', availabilities: { '2026-07-04T00:00:00Z': 'Reserved' } },
        })
        expect(combined['1'].availabilities).toEqual({
            '2026-06-26T00:00:00Z': 'Available',
            '2026-07-04T00:00:00Z': 'Available',
        })
        expect(combined['2']).toBeDefined()
    })

    test('backoff starts at 0', () => {
        const { checker } = mkChecker()
        expect(checker.getBackoffMs()).toBe(0)
    })

    test('executeCheck refuses to start a second cycle while one is running', async () => {
        const { checker } = mkChecker()
        checker.cycleState.currentlyRunning = true
        const result = await checker.executeCheck()
        expect(result).toEqual({ ran: false, reason: 'already_running' })
        expect(checker.cycleState.cycleCount).toBe(0)
    })

    test('executeCheck reports ran:true on a clean (empty) cycle and increments cycleCount', async () => {
        const { checker, repos } = mkChecker()
        const result = await checker.executeCheck()
        expect(result.ran).toBe(true)
        expect(checker.cycleState.cycleCount).toBe(1)
        expect(checker.cycleState.currentlyRunning).toBe(false)
        expect(repos.cycles.recent(5).length).toBe(1)
    })

    test('__handleError grows backoff exponentially on 429', () => {
        const { checker } = mkChecker()
        const fakeCampground = { id: 1, toString: () => '[fake]' }
        const err = { response: { status: 429, headers: {} } }
        checker.__handleError(err, fakeCampground, null)
        const first = checker.getBackoffMs()
        checker.__handleError(err, fakeCampground, null)
        const second = checker.getBackoffMs()
        expect(first).toBeGreaterThan(0)
        expect(second).toBe(first * 2)
    })

    test('__handleError honors Retry-After header', () => {
        const { checker } = mkChecker()
        const err = { response: { status: 429, headers: { 'retry-after': '30' } } }
        checker.__handleError(err, { id: 1, toString: () => '[fake]' }, null)
        expect(checker.getBackoffMs()).toBe(30 * 1000)
    })

    describe('getStatus', () => {
        test('returns campground rows from the DB with default state', () => {
            const { checker } = mkChecker([
                { name: 'Upper Pines', id: 232447, park: 'Yosemite' },
                { name: 'Lower Pines', id: 232450, park: 'Yosemite' },
            ])
            const status = checker.getStatus()
            expect(status.targetDates).toEqual(TARGET_DATES)
            expect(status.monthStarts).toEqual([MONTH_START])
            expect(status.campgrounds).toHaveLength(2)
            expect(status.campgrounds[0].status).toBe('pending')
            expect(status.campgrounds[0].enabled).toBe(true)
        })

        test('metadata fields flow into status output', () => {
            const { checker } = mkChecker([{
                name: 'Upper Pines',
                id: 232447,
                park: 'Yosemite',
                valleyDriveMinutes: 0,
                elevationFt: 4000,
                season: 'year-round',
                totalSites: 238,
                accessType: 'drive-in',
            }])
            const cg = checker.getStatus().campgrounds[0]
            expect(cg.meta).toEqual({
                valleyDriveMinutes: 0,
                elevationFt: 4000,
                season: 'year-round',
                totalSites: 238,
                accessType: 'drive-in',
                lat: null,
                lon: null,
            })
        })

        test('report() advances state to all_reserved with zero counts when no sites open', () => {
            const { checker, repos } = mkChecker([{ name: 'X', id: 232447, park: 'Yosemite' }])
            const cycleId = repos.cycles.start('2026-05-15T00:00:00Z')
            const mockCampground = {
                id: 232447,
                toString: () => '[X]',
                getBookingUrl: () => 'https://example.test/cg/232447',
            }
            checker.notifier.notify = () => {}

            checker.report(mockCampground, {
                data: { campsites: { '1': { site: '1', campsite_id: 'c1', availabilities: { [TARGET_DATE]: 'Reserved' } } } },
            }, cycleId)

            const cg = checker.getStatus().campgrounds[0]
            expect(cg.status).toBe('all_reserved')
            expect(cg.availableByDate).toEqual({ [TARGET_DATE]: 0 })
        })

        test('report() persists per-site detail + dedup: first cycle notifies, second cycle does not', () => {
            const { checker, repos } = mkChecker(
                [{ name: 'Atwell', id: 10044710, park: 'Sequoia' }],
                ['2026-06-26T00:00:00Z', '2026-06-27T00:00:00Z'],
            )
            const mockCampground = {
                id: 10044710,
                toString: () => '[Sequoia][Atwell]',
                getBookingUrl: () => 'https://example.test/cg/10044710',
            }
            const notifyCalls = []
            checker.notifier.notify = (m) => notifyCalls.push(m)
            const apiData = {
                data: {
                    campsites: {
                        '1': {
                            site: '02', campsite_id: 'c2', loop: 'East', campsite_type: 'TENT ONLY', max_num_people: 8,
                            availabilities: {
                                '2026-06-26T00:00:00Z': 'Available',
                                '2026-06-27T00:00:00Z': 'Reserved',
                            },
                        },
                    },
                },
            }

            const cycleId1 = repos.cycles.start('2026-05-15T00:00:00Z')
            checker.report(mockCampground, apiData, cycleId1)
            expect(notifyCalls).toHaveLength(1)
            expect(notifyCalls[0]).toMatch(/1 new site\(s\) opened/)

            // Second cycle: same data, no fresh opens
            const cycleId2 = repos.cycles.start('2026-05-15T00:01:00Z')
            checker.report(mockCampground, apiData, cycleId2)
            expect(notifyCalls).toHaveLength(1)  // unchanged
        })

        test('report() re-notifies after a close-then-reopen', () => {
            const { checker, repos } = mkChecker(
                [{ name: 'X', id: 1, park: 'Y' }],
                ['2026-06-26T00:00:00Z'],
            )
            const mockCampground = {
                id: 1,
                toString: () => '[X]',
                getBookingUrl: () => 'https://example.test/cg/1',
            }
            const calls = []
            checker.notifier.notify = (m) => calls.push(m)

            const dataOpen = () => ({ data: { campsites: { '1': { site: '01', campsite_id: 'c1',
                availabilities: { '2026-06-26T00:00:00Z': 'Available' } } } } })
            const dataClosed = () => ({ data: { campsites: { '1': { site: '01', campsite_id: 'c1',
                availabilities: { '2026-06-26T00:00:00Z': 'Reserved' } } } } })

            checker.report(mockCampground, dataOpen(), repos.cycles.start('t1'))
            expect(calls).toHaveLength(1)
            checker.report(mockCampground, dataClosed(), repos.cycles.start('t2'))
            expect(calls).toHaveLength(1)  // closing doesn't notify
            checker.report(mockCampground, dataOpen(), repos.cycles.start('t3'))
            expect(calls).toHaveLength(2)  // reopen pings again
        })

        test('__handleError marks the campground as error with the failure reason', () => {
            const { checker, repos } = mkChecker([{ name: 'X', id: 232447, park: 'Y' }])
            const cycleId = repos.cycles.start('t')
            const err = { response: { status: 429, headers: { 'retry-after': '30' } } }
            checker.__handleError(err, { id: 232447, toString: () => '[X]' }, cycleId)
            const cg = checker.getStatus().campgrounds[0]
            expect(cg.status).toBe('error')
            expect(cg.error).toBe('Retry-After:30')
        })
    })

    describe('enable/disable', () => {
        test('isEnabled defaults to true, setEnabled toggles', () => {
            const { checker } = mkChecker([{ name: 'X', id: 1, park: 'Y' }])
            expect(checker.isEnabled(1)).toBe(true)
            expect(checker.setEnabled(1, false)).toBe(false)
            expect(checker.isEnabled(1)).toBe(false)
            expect(checker.setEnabled(1, true)).toBe(true)
        })

        test('getStatus reflects DB enabled column', () => {
            const { checker, repos } = mkChecker([
                { name: 'X', id: 1, park: 'Y' },
                { name: 'Z', id: 2, park: 'Y' },
            ])
            repos.campgrounds.setEnabled(1, false)
            const status = checker.getStatus()
            expect(status.campgrounds.find(c => c.id === 1).enabled).toBe(false)
            expect(status.campgrounds.find(c => c.id === 2).enabled).toBe(true)
        })
    })

    test('__resetBackoff zeroes out state', () => {
        const { checker } = mkChecker()
        checker.backoffMs = 5000
        checker.lastErrorReason = 'HTTP 429'
        checker.__resetBackoff()
        expect(checker.getBackoffMs()).toBe(0)
        expect(checker.lastErrorReason).toBeNull()
    })
})
