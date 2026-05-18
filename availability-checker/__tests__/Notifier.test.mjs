import Notifier from '../Notifier.mjs'

describe('Notifier.__limitSize', () => {
    const notifier = new Notifier('https://example.invalid')

    test('passes through messages within the Discord limit', () => {
        const msg = 'short message'
        expect(notifier.__limitSize(msg)).toBe(msg)
    })

    test('passes through messages exactly at the limit', () => {
        const msg = 'a'.repeat(2000)
        expect(notifier.__limitSize(msg)).toBe(msg)
    })

    test('truncates messages over the limit and appends a marker', () => {
        const msg = 'a'.repeat(3000)
        const out = notifier.__limitSize(msg)
        expect(out.length).toBeLessThanOrEqual(2000)
        expect(out).toMatch(/truncated/)
    })

    test('truncation is roughly the original length (not 500 chars like the old bug)', () => {
        const msg = 'a'.repeat(3000)
        const out = notifier.__limitSize(msg)
        expect(out.length).toBeGreaterThan(1500)
    })
})

describe('Notifier.__buildNtfyHeaders', () => {
    const notifier = new Notifier('https://example.invalid', 'https://ntfy.example/topic')

    test('always includes Content-Type and loud Priority', () => {
        const h = notifier.__buildNtfyHeaders()
        expect(h['Content-Type']).toBe('text/plain')
        expect(h.Priority).toBe('5')
        expect(h.Title).toBeUndefined()
        expect(h.Click).toBeUndefined()
        expect(h.Actions).toBeUndefined()
    })

    test('attaches title, click URL, and action buttons when provided', () => {
        const h = notifier.__buildNtfyHeaders({
            title: 'Upper Pines: 2 site(s)',
            clickUrl: 'https://rec.gov/cg/232447?startdate=2026-06-19&enddate=2026-06-20',
            actions: [
                { label: 'Site 7 - 06-19', url: 'https://rec.gov/cs/A?startdate=2026-06-19&enddate=2026-06-20' },
                { label: 'Site 9 - 06-19', url: 'https://rec.gov/cs/B?startdate=2026-06-19&enddate=2026-06-20' },
            ],
        })
        expect(h.Title).toBe('Upper Pines: 2 site(s)')
        expect(h.Click).toMatch(/^https:\/\/rec\.gov\/cg\/232447/)
        expect(h.Actions).toContain('view, "Site 7 - 06-19", https://rec.gov/cs/A')
        expect(h.Actions).toContain('view, "Site 9 - 06-19", https://rec.gov/cs/B')
        expect(h.Actions).toContain('clear=true')
    })

    test('caps action buttons at ntfys 3-action limit', () => {
        const actions = Array.from({ length: 5 }, (_, i) => ({
            label: `s${i}`, url: `https://x/${i}`,
        }))
        const h = notifier.__buildNtfyHeaders({ actions })
        const sections = h.Actions.split(';')
        expect(sections).toHaveLength(3)
    })

    test('quotes labels so commas and semicolons in campground names dont break the parser', () => {
        const h = notifier.__buildNtfyHeaders({
            actions: [{ label: 'Site A, B; C', url: 'https://x' }],
        })
        expect(h.Actions).toContain('"Site A, B; C"')
    })
})
