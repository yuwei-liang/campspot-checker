// Mock axios so we can drive recheckStay against synthetic responses.
import { jest } from '@jest/globals'

jest.unstable_mockModule('axios', () => ({
    default: { get: jest.fn() },
}))

const { default: axios } = await import('axios')
const { default: CampspotChecker } = await import('../CampspotChecker.mjs')

const baseConfig = {
    campgroundId: '232447',
    rangeStartDate: '2026-06-22',
    rangeEndDate: '2026-09-30',
    targetWeekdays: ['Thu', 'Fri', 'Sat', 'Sun'],
    maxNights: 4,
    minNights: 1,
    log: { info: () => {}, warn: () => {}, error: () => {} },
}

function payloadForCampsite(siteAvailMap) {
    return {
        data: {
            campsites: {
                '999': {
                    campsite_id: '999',
                    site: '003',
                    availabilities: Object.fromEntries(
                        Object.entries(siteAvailMap).map(([d, s]) => [`${d}T00:00:00Z`, s]),
                    ),
                },
            },
        },
    }
}

const stay = {
    campsiteId: '999',
    siteNo: '003',
    startDate: '2026-06-25',
    endDate: '2026-06-29',
    nights: 4,
    nightDates: ['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28'],
}

describe('CampspotChecker.recheckStay', () => {
    test('unchanged when every night is still Available', async () => {
        axios.get.mockResolvedValue(payloadForCampsite({
            '2026-06-25': 'Available',
            '2026-06-26': 'Available',
            '2026-06-27': 'Available',
            '2026-06-28': 'Available',
        }))
        const checker = new CampspotChecker(baseConfig)
        const r = await checker.recheckStay(stay)
        expect(r).toMatchObject({ ok: true, reason: 'unchanged' })
        expect(r.adjustedStay).toEqual(stay)
    })

    test('shortened when the tail flipped to Reserved', async () => {
        // Detected 4-night Jun 25-29. Now the last 2 nights are Reserved.
        // Should fall back to a 2-night stay ending Jun 27 (checkout).
        axios.get.mockResolvedValue(payloadForCampsite({
            '2026-06-25': 'Available',
            '2026-06-26': 'Available',
            '2026-06-27': 'Reserved',
            '2026-06-28': 'Reserved',
        }))
        const checker = new CampspotChecker(baseConfig)
        const r = await checker.recheckStay(stay)
        expect(r.ok).toBe(true)
        expect(r.reason).toBe('shortened')
        expect(r.adjustedStay).toMatchObject({
            nights: 2,
            startDate: '2026-06-25',
            endDate: '2026-06-27',
            nightDates: ['2026-06-25', '2026-06-26'],
        })
    })

    test('all_gone when first night is already taken', async () => {
        axios.get.mockResolvedValue(payloadForCampsite({
            '2026-06-25': 'Reserved',
            '2026-06-26': 'Available',
            '2026-06-27': 'Available',
            '2026-06-28': 'Available',
        }))
        const checker = new CampspotChecker(baseConfig)
        const r = await checker.recheckStay(stay)
        expect(r).toEqual({ ok: false, originalStay: stay, adjustedStay: null, reason: 'all_gone' })
    })

    test('shortened to 1-night when only Jun 25 still holds', async () => {
        axios.get.mockResolvedValue(payloadForCampsite({
            '2026-06-25': 'Available',
            '2026-06-26': 'Reserved',
            '2026-06-27': 'Available',
            '2026-06-28': 'Available',
        }))
        const checker = new CampspotChecker(baseConfig)
        const r = await checker.recheckStay(stay)
        expect(r.reason).toBe('shortened')
        expect(r.adjustedStay).toMatchObject({
            nights: 1,
            endDate: '2026-06-26',
            nightDates: ['2026-06-25'],
        })
    })

    test('spans a month boundary — hits two month endpoints', async () => {
        // Jun 29 (Mon) → Jul 3 (Fri) = nights Jun 29, 30, Jul 1, 2.
        // Verifies monthRangesForRange emits both June and July starts.
        const crossing = {
            campsiteId: '999',
            siteNo: '003',
            startDate: '2026-06-29',
            endDate: '2026-07-03',
            nights: 4,
            nightDates: ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'],
        }
        axios.get
            .mockResolvedValueOnce(payloadForCampsite({
                '2026-06-29': 'Available',
                '2026-06-30': 'Available',
            }))
            .mockResolvedValueOnce(payloadForCampsite({
                '2026-07-01': 'Available',
                '2026-07-02': 'Available',
            }))
        const checker = new CampspotChecker(baseConfig)
        const r = await checker.recheckStay(crossing)
        expect(axios.get).toHaveBeenCalledTimes(2)
        expect(r.reason).toBe('unchanged')
    })
})
