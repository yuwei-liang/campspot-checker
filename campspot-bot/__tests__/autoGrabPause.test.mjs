import {
    shouldPause,
    pauseFor,
    pauseStatus,
    inheritPauseFromPrevious,
    AUTO_GRAB_PAUSE_HOURS,
} from '../autoGrabPause.mjs'

describe('shouldPause', () => {
    test('held → pause (real hold, user may be paying)', () => {
        expect(shouldPause({ cartState: 'held' })).toBe(true)
    })

    test('has_items_but_not_target → pause (verifier failed but items ARE there — 2026-07-01 win)', () => {
        expect(shouldPause({ cartState: 'has_items_but_not_target' })).toBe(true)
    })

    test('wrong_trip kept (didn\'t auto-release) → pause (items still in cart)', () => {
        expect(shouldPause({ cartState: 'wrong_trip', autoReleased: false })).toBe(true)
    })

    test('wrong_trip auto-released → NO pause (cart is empty again)', () => {
        expect(shouldPause({ cartState: 'wrong_trip', autoReleased: true })).toBe(false)
    })

    test('empty → NO pause', () => {
        expect(shouldPause({ cartState: 'empty' })).toBe(false)
    })

    test('unknown/error → NO pause (don\'t block on ambiguous failures)', () => {
        expect(shouldPause({ cartState: 'unknown' })).toBe(false)
        expect(shouldPause({ reason: 'network_error' })).toBe(false)
        expect(shouldPause(null)).toBe(false)
        expect(shouldPause(undefined)).toBe(false)
    })
})

describe('pauseFor', () => {
    test('default = 24h from now', () => {
        const now = new Date('2026-07-01T20:00:00Z')
        const p = pauseFor({ now, reason: 'held site 233' })
        expect(p.pausedUntil).toBe('2026-07-02T20:00:00.000Z')
        expect(p.pauseReason).toBe('held site 233')
        expect(AUTO_GRAB_PAUSE_HOURS).toBe(24)
    })

    test('custom hours', () => {
        const now = new Date('2026-07-01T00:00:00Z')
        expect(pauseFor({ now, hours: 1, reason: 'x' }).pausedUntil).toBe('2026-07-01T01:00:00.000Z')
    })
})

describe('pauseStatus', () => {
    const now = new Date('2026-07-01T20:00:00Z')

    test('null pausedUntil → not active, not expired', () => {
        expect(pauseStatus({ pausedUntil: null }, now)).toEqual({ active: false, expired: false })
        expect(pauseStatus({}, now)).toEqual({ active: false, expired: false })
        expect(pauseStatus(null, now)).toEqual({ active: false, expired: false })
    })

    test('pausedUntil in future → active', () => {
        expect(pauseStatus({ pausedUntil: '2026-07-02T20:00:00Z' }, now)).toEqual({ active: true, expired: false })
    })

    test('pausedUntil in past → expired (caller should clear)', () => {
        expect(pauseStatus({ pausedUntil: '2026-06-30T20:00:00Z' }, now)).toEqual({ active: false, expired: true })
    })

    test('malformed pausedUntil → treated as no pause', () => {
        expect(pauseStatus({ pausedUntil: 'not a date' }, now)).toEqual({ active: false, expired: false })
    })
})

describe('inheritPauseFromPrevious', () => {
    const now = new Date('2026-07-01T20:00:00Z')

    test('previous pause still in future → carry it forward', () => {
        const prev = { autoGrab: { pausedUntil: '2026-07-02T00:00:00Z', pauseReason: 'held' } }
        expect(inheritPauseFromPrevious(prev, now)).toEqual({
            pausedUntil: '2026-07-02T00:00:00Z',
            pauseReason: 'held',
        })
    })

    test('previous pause already expired → drop (fresh restart post-cooldown)', () => {
        const prev = { autoGrab: { pausedUntil: '2026-06-30T00:00:00Z', pauseReason: 'held' } }
        expect(inheritPauseFromPrevious(prev, now)).toEqual({ pausedUntil: null, pauseReason: null })
    })

    test('no previous autoGrab field → no pause', () => {
        expect(inheritPauseFromPrevious({}, now)).toEqual({ pausedUntil: null, pauseReason: null })
        expect(inheritPauseFromPrevious(null, now)).toEqual({ pausedUntil: null, pauseReason: null })
    })

    test('malformed previous field → no pause', () => {
        expect(inheritPauseFromPrevious({ autoGrab: { pausedUntil: 'garbage' } }, now)).toEqual({
            pausedUntil: null,
            pauseReason: null,
        })
    })
})
