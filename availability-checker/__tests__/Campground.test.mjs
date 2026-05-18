import Campground from '../Campground.mjs'

describe('Campground', () => {
    describe('getAvailabilityUrl', () => {
        test('returns URL containing the id and URL-encoded monthStart', () => {
            const c = new Campground('Upper Pines Campground', 232447, 'Yosemite')
            const url = c.getAvailabilityUrl('2026-06-01T00:00:00.000Z')

            expect(url).toBe(
                'https://www.recreation.gov/api/camps/availability/campground/232447/month' +
                '?start_date=2026-06-01T00%3A00%3A00.000Z'
            )
        })

        test('throws when monthStart is undefined (no silent stale URL)', () => {
            const c = new Campground('Upper Pines', 232447, 'Yosemite')
            expect(() => c.getAvailabilityUrl()).toThrow(/monthStart is required/)
        })

        test('throws when monthStart is empty string', () => {
            const c = new Campground('Upper Pines', 232447, 'Yosemite')
            expect(() => c.getAvailabilityUrl('')).toThrow(/monthStart is required/)
        })
    })

    describe('booking URLs', () => {
        test('getBookingUrl returns user-facing campground page', () => {
            const c = new Campground('Upper Pines', 232447, 'Yosemite')
            expect(c.getBookingUrl()).toBe(
                'https://www.recreation.gov/camping/campgrounds/232447'
            )
        })

        test('getCampsiteUrl returns user-facing site page', () => {
            expect(Campground.getCampsiteUrl('98765')).toBe(
                'https://www.recreation.gov/camping/campsites/98765'
            )
        })

        test('getBookingUrl appends startdate + enddate for a one-night stay', () => {
            const c = new Campground('Upper Pines', 232447, 'Yosemite')
            expect(c.getBookingUrl('2026-06-19T00:00:00.000Z')).toBe(
                'https://www.recreation.gov/camping/campgrounds/232447?startdate=2026-06-19&enddate=2026-06-20'
            )
        })

        test('getCampsiteUrl appends startdate + enddate for a one-night stay', () => {
            expect(Campground.getCampsiteUrl('98765', '2026-06-19T00:00:00Z')).toBe(
                'https://www.recreation.gov/camping/campsites/98765?startdate=2026-06-19&enddate=2026-06-20'
            )
        })

        test('date range crosses a month boundary correctly', () => {
            const c = new Campground('X', 1)
            expect(c.getBookingUrl('2026-06-30T00:00:00Z')).toBe(
                'https://www.recreation.gov/camping/campgrounds/1?startdate=2026-06-30&enddate=2026-07-01'
            )
        })

        test('accepts a bare YYYY-MM-DD string', () => {
            expect(Campground.getCampsiteUrl('5', '2026-06-19')).toBe(
                'https://www.recreation.gov/camping/campsites/5?startdate=2026-06-19&enddate=2026-06-20'
            )
        })

        test('falls back to no date params when targetDate is malformed', () => {
            const c = new Campground('X', 1)
            expect(c.getBookingUrl('not-a-date')).toBe('https://www.recreation.gov/camping/campgrounds/1')
            expect(Campground.getCampsiteUrl('5', '')).toBe('https://www.recreation.gov/camping/campsites/5')
        })
    })

    describe('toString', () => {
        test('formats with park, name, and id', () => {
            const c = new Campground('Upper Pines Campground', 232447, 'Yosemite')
            expect(c.toString()).toBe('[Yosemite][Upper Pines Campground][id:232447]')
        })

        test('omits park when not provided', () => {
            const c = new Campground('Lodgepole', 232461)
            expect(c.toString()).toBe('[Lodgepole][id:232461]')
        })
    })
})
