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
