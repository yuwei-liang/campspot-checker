// Tests for the bot-state helpers shared by campspot-bot and permit-bot.
//
// The interesting one here is resetBackoffWithRecovery — it bundles
// "clear the checker's backoff" with "publish a recovery event" so a future
// caller can't accidentally do one without the other. That invariant is the
// reason the helper exists; these tests pin it down.

import { jest } from '@jest/globals'
import { appendEvent, resetBackoffWithRecovery } from '../botState.mjs'

function fakeChecker(initialBackoffMs = 0) {
    return {
        backoffMs: initialBackoffMs,
        resetBackoffCalls: 0,
        resetBackoff() {
            this.resetBackoffCalls += 1
            this.backoffMs = 0
        },
    }
}

describe('resetBackoffWithRecovery', () => {
    test('emits recovery with the prior backoff when backoff was non-zero', () => {
        const checker = fakeChecker(4000)
        const emit = jest.fn()

        resetBackoffWithRecovery(checker, emit)

        expect(emit).toHaveBeenCalledTimes(1)
        expect(emit).toHaveBeenCalledWith({ priorBackoffMs: 4000 })
        expect(checker.backoffMs).toBe(0)
        expect(checker.resetBackoffCalls).toBe(1)
    })

    test('does not emit when checker had no pending backoff', () => {
        const checker = fakeChecker(0)
        const emit = jest.fn()

        resetBackoffWithRecovery(checker, emit)

        expect(emit).not.toHaveBeenCalled()
        // Reset still runs so the contract is "always clear, sometimes emit":
        // callers can rely on backoffMs being 0 afterward regardless of input.
        expect(checker.resetBackoffCalls).toBe(1)
        expect(checker.backoffMs).toBe(0)
    })

    test('captures backoff before reset, so emit sees the prior value not 0', () => {
        // Regression guard: if we ever flipped the order to reset-then-read,
        // emit would always see 0 and the recovery event would silently lie.
        const checker = fakeChecker(2500)
        let observedDuringEmit = null
        resetBackoffWithRecovery(checker, ({ priorBackoffMs }) => {
            observedDuringEmit = { priorBackoffMs, currentBackoffMs: checker.backoffMs }
        })
        expect(observedDuringEmit).toEqual({ priorBackoffMs: 2500, currentBackoffMs: 0 })
    })

    test('integrates with appendEvent: produces a well-formed poll_recovered row', () => {
        const checker = fakeChecker(8000)
        const dashState = { recentEvents: [] }

        resetBackoffWithRecovery(checker, ({ priorBackoffMs }) =>
            appendEvent(dashState, { type: 'poll_recovered', priorBackoffMs }))

        expect(dashState.recentEvents).toHaveLength(1)
        const evt = dashState.recentEvents[0]
        expect(evt.type).toBe('poll_recovered')
        expect(evt.priorBackoffMs).toBe(8000)
        expect(evt.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    test('emit can throw without leaving backoff stuck — reset already happened', () => {
        // If a downstream emitter (Discord webhook, session.write) throws,
        // we still want backoff cleared so the bot can keep polling. The
        // reset runs before emit, so this should propagate cleanly.
        const checker = fakeChecker(4000)
        expect(() => {
            resetBackoffWithRecovery(checker, () => { throw new Error('emit boom') })
        }).toThrow('emit boom')
        expect(checker.backoffMs).toBe(0)
    })
})
