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
