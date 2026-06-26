// Tests for the campspot-bot config normalizer.
//
// On-disk config grew a `{ shared, campgrounds[] }` shape so we can watch
// multiple Yosemite campgrounds with one config. The loader has to keep
// reading legacy single-campground files too — they were the only shape in
// production until this change, and any deployment that hasn't been
// re-rolled still has them on disk.

import { normalizeRawConfig, selectCampground } from '../configLoader.mjs'

describe('normalizeRawConfig', () => {
    test('new shape: campgrounds[] is returned with shared merged in', () => {
        const raw = {
            shared: { pollIntervalMs: 30000, minNights: 2, targetWeekdays: ['Thu', 'Fri'] },
            campgrounds: [
                { campgroundId: '232447', campgroundName: 'Upper Pines', park: 'Yosemite' },
                { campgroundId: '232450', campgroundName: 'Lower Pines', park: 'Yosemite' },
            ],
        }
        const configs = normalizeRawConfig(raw)
        expect(configs).toHaveLength(2)
        expect(configs[0]).toMatchObject({
            campgroundId: '232447',
            campgroundName: 'Upper Pines',
            park: 'Yosemite',
            pollIntervalMs: 30000,
            minNights: 2,
            targetWeekdays: ['Thu', 'Fri'],
        })
        expect(configs[1].campgroundId).toBe('232450')
        expect(configs[1].pollIntervalMs).toBe(30000)
    })

    test('per-campground field overrides shared', () => {
        const raw = {
            shared: { pollIntervalMs: 30000, minNights: 2 },
            campgrounds: [
                { campgroundId: '232447', campgroundName: 'Upper Pines', park: 'Yosemite' },
                { campgroundId: '232448', campgroundName: 'Tuolumne', park: 'Yosemite', pollIntervalMs: 60000 },
            ],
        }
        const configs = normalizeRawConfig(raw)
        expect(configs[0].pollIntervalMs).toBe(30000)
        expect(configs[1].pollIntervalMs).toBe(60000)
        expect(configs[1].minNights).toBe(2)
    })

    test('legacy single-campground shape is normalized to a one-element list', () => {
        const raw = {
            campgroundId: '232447',
            campgroundName: 'Upper Pines Campground',
            park: 'Yosemite',
            leadDays: 15,
            rangeStartDate: '2026-06-22',
            pollIntervalMs: 30000,
            minNights: 2,
        }
        const configs = normalizeRawConfig(raw)
        expect(configs).toHaveLength(1)
        expect(configs[0]).toEqual({
            campgroundId: '232447',
            campgroundName: 'Upper Pines Campground',
            park: 'Yosemite',
            leadDays: 15,
            rangeStartDate: '2026-06-22',
            pollIntervalMs: 30000,
            minNights: 2,
        })
    })

    test('throws when campgrounds[] is empty', () => {
        expect(() => normalizeRawConfig({ shared: {}, campgrounds: [] }))
            .toThrow(/empty/)
    })

    test('throws when a campground entry is missing campgroundId', () => {
        expect(() => normalizeRawConfig({
            shared: {},
            campgrounds: [{ campgroundName: 'No ID' }],
        })).toThrow(/missing campgroundId/)
    })

    test('throws when neither new nor legacy shape is present', () => {
        expect(() => normalizeRawConfig({ leadDays: 7 })).toThrow(/missing/)
    })
})

describe('selectCampground', () => {
    const configs = [
        { campgroundId: '232447', campgroundName: 'Upper Pines' },
        { campgroundId: '232450', campgroundName: 'Lower Pines' },
    ]

    test('returns the first entry when no id provided', () => {
        expect(selectCampground(configs).campgroundId).toBe('232447')
        expect(selectCampground(configs, null).campgroundId).toBe('232447')
    })

    test('matches by id (string or number)', () => {
        expect(selectCampground(configs, '232450').campgroundId).toBe('232450')
        expect(selectCampground(configs, 232450).campgroundId).toBe('232450')
    })

    test('throws with the known-ids list when id not found', () => {
        expect(() => selectCampground(configs, '999999'))
            .toThrow(/999999.*232447, 232450/)
    })
})
