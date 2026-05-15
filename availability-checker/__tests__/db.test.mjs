import { openDatabase } from '../db/db.mjs'
import { createCampgroundsRepo } from '../db/campgroundsRepo.mjs'
import { createCyclesRepo } from '../db/cyclesRepo.mjs'
import { createAvailabilityRepo } from '../db/availabilityRepo.mjs'

const fresh = () => openDatabase(':memory:')

const sampleCg = (overrides = {}) => ({
    id: 232447,
    name: 'Upper Pines',
    park: 'Yosemite',
    valleyDriveMinutes: 0,
    elevationFt: 4000,
    season: 'year-round',
    totalSites: 238,
    accessType: 'drive-in',
    ...overrides,
})

describe('openDatabase / migrations', () => {
    test('creates schema_migrations and applies all initial migrations on first open', () => {
        const db = fresh()
        const versions = db.prepare('SELECT version FROM schema_migrations').all()
        expect(versions.map(v => v.version)).toContain('001_initial')
        db.close()
    })

    test('reopening is idempotent (does not re-apply)', () => {
        const db = fresh()
        const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n
        // Pretend to reopen — re-run migrations
        const repos = createCampgroundsRepo(db)
        expect(repos.count()).toBe(0)
        const after = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n
        expect(after).toBe(before)
        db.close()
    })
})

describe('campgroundsRepo', () => {
    test('upsert + all + byId + enabledIds + setEnabled', () => {
        const db = fresh()
        const repo = createCampgroundsRepo(db)
        repo.upsert(sampleCg(), 0)
        repo.upsert(sampleCg({ id: 232450, name: 'Lower Pines' }), 1)
        expect(repo.count()).toBe(2)
        expect(repo.byId(232447).name).toBe('Upper Pines')
        expect(repo.all().map(c => c.id)).toEqual([232447, 232450])
        expect(repo.enabledIds()).toEqual([232447, 232450])

        repo.setEnabled(232447, false)
        expect(repo.byId(232447).enabled).toBe(false)
        expect(repo.enabledIds()).toEqual([232450])
        db.close()
    })

    test('upsert is idempotent on id and updates fields', () => {
        const db = fresh()
        const repo = createCampgroundsRepo(db)
        repo.upsert(sampleCg(), 0)
        repo.upsert(sampleCg({ name: 'Upper Pines RENAMED' }), 0)
        expect(repo.count()).toBe(1)
        expect(repo.byId(232447).name).toBe('Upper Pines RENAMED')
        db.close()
    })

    test('upsertMany preserves order via sort_order', () => {
        const db = fresh()
        const repo = createCampgroundsRepo(db)
        repo.upsertMany([
            sampleCg({ id: 3 }),
            sampleCg({ id: 1 }),
            sampleCg({ id: 2 }),
        ])
        expect(repo.all().map(c => c.id)).toEqual([3, 1, 2])
        db.close()
    })

    test('upsertMany preserves existing enabled state', () => {
        const db = fresh()
        const repo = createCampgroundsRepo(db)
        repo.upsert(sampleCg({ id: 1 }))
        repo.setEnabled(1, false)
        repo.upsertMany([sampleCg({ id: 1, name: 'Renamed' })])
        expect(repo.byId(1).enabled).toBe(false)
        expect(repo.byId(1).name).toBe('Renamed')
        db.close()
    })
})

describe('cyclesRepo', () => {
    test('start / finish / recent returns rows in reverse order', () => {
        const db = fresh()
        const repo = createCyclesRepo(db)
        const cgRepo = createCampgroundsRepo(db)
        cgRepo.upsert(sampleCg({ id: 1 }))

        const id1 = repo.start('2026-05-15T17:00:00Z')
        repo.recordResult(id1, 1, 'all_reserved', 0, null, '2026-05-15T17:00:02Z')
        repo.finish(id1, '2026-05-15T17:00:30Z', 30000, 1)

        const id2 = repo.start('2026-05-15T17:01:30Z')
        repo.finish(id2, '2026-05-15T17:02:00Z', 30000, 1)

        const recent = repo.recent(5)
        expect(recent).toHaveLength(2)
        expect(recent[0].id).toBe(id2)
        expect(recent[1].id).toBe(id1)
        db.close()
    })
})

describe('availabilityRepo (transition + dedup)', () => {
    test('first observation: opened transitions emit events + notification rows', () => {
        const db = fresh()
        const repo = createAvailabilityRepo(db)
        const notify = repo.applyObservations([
            { campgroundId: 1, campsiteId: 'A', siteNo: '01', targetDate: '2026-06-26T00:00:00Z', isOpen: true,
              loop: 'X', campsiteType: 'TENT', maxPeople: 4 },
        ])
        expect(notify).toHaveLength(1)
        expect(notify[0].campsiteId).toBe('A')

        const events = repo.recentEvents()
        expect(events).toHaveLength(1)
        expect(events[0].event).toBe('opened')
    })

    test('second observation: same site still open = NO new notification (dedup)', () => {
        const db = fresh()
        const repo = createAvailabilityRepo(db)
        const obs = [{ campgroundId: 1, campsiteId: 'A', siteNo: '01',
                       targetDate: '2026-06-26T00:00:00Z', isOpen: true }]
        repo.applyObservations(obs)
        const notify2 = repo.applyObservations(obs)
        expect(notify2).toHaveLength(0)
    })

    test('open → closed → open: re-notifies, logs two events', () => {
        const db = fresh()
        const repo = createAvailabilityRepo(db)
        const key = { campgroundId: 1, campsiteId: 'A', siteNo: '01',
                      targetDate: '2026-06-26T00:00:00Z' }

        const n1 = repo.applyObservations([{ ...key, isOpen: true }])
        expect(n1).toHaveLength(1)

        const n2 = repo.applyObservations([{ ...key, isOpen: false }])
        expect(n2).toHaveLength(0)

        const n3 = repo.applyObservations([{ ...key, isOpen: true }])
        expect(n3).toHaveLength(1)

        const events = repo.recentEvents()
        expect(events.map(e => e.event)).toEqual(['opened', 'closed', 'opened'])
    })

    test('mixed batch: only the freshly opened sites generate notifications', () => {
        const db = fresh()
        const repo = createAvailabilityRepo(db)

        const stillOpenKey = { campgroundId: 1, campsiteId: 'A', siteNo: 'A',
                               targetDate: '2026-06-26T00:00:00Z' }
        const closedKey = { campgroundId: 1, campsiteId: 'B', siteNo: 'B',
                            targetDate: '2026-06-26T00:00:00Z' }
        const newlyOpenedKey = { campgroundId: 1, campsiteId: 'C', siteNo: 'C',
                                 targetDate: '2026-06-26T00:00:00Z' }

        // Seed prior state
        repo.applyObservations([
            { ...stillOpenKey, isOpen: true },
            { ...closedKey, isOpen: true },
        ])

        // Mixed cycle
        const notify = repo.applyObservations([
            { ...stillOpenKey, isOpen: true },
            { ...closedKey, isOpen: false },
            { ...newlyOpenedKey, isOpen: true },
        ])

        expect(notify.map(n => n.campsiteId)).toEqual(['C'])
    })

    test('recentEventsForCampground filters by campground', () => {
        const db = fresh()
        const repo = createAvailabilityRepo(db)
        repo.applyObservations([{ campgroundId: 1, campsiteId: 'A', targetDate: '2026-06-26T00:00:00Z', isOpen: true }])
        repo.applyObservations([{ campgroundId: 2, campsiteId: 'B', targetDate: '2026-06-26T00:00:00Z', isOpen: true }])
        const events = repo.recentEventsForCampground(1)
        expect(events).toHaveLength(1)
        expect(events[0].campgroundId).toBe(1)
    })
})
