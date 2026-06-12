// Tests for the Discord outbox pattern.
//
// Critical behaviors:
//   - enqueue() persists messages durably (survives process restart)
//   - flush() drains successful entries, retains failed
//   - flush() with mixed success leaves only the failures
//   - depth() reports current queue length without sending
//   - clear() wipes the queue

import { jest } from '@jest/globals'
import { enqueue, flush, depth, clear } from '../outbox.mjs'

beforeEach(() => {
    clear()
})

afterAll(() => {
    clear()
})

describe('outbox', () => {
    test('enqueue persists; depth reflects it', () => {
        expect(depth()).toBe(0)
        enqueue({ text: 'hello' })
        expect(depth()).toBe(1)
        enqueue({ text: 'world' })
        expect(depth()).toBe(2)
    })

    test('flush with always-success sends every entry and drains the queue', async () => {
        enqueue({ text: 'a' })
        enqueue({ text: 'b' })
        enqueue({ text: 'c' })
        const sendFn = jest.fn().mockResolvedValue({ ok: true, status: 204 })
        const result = await flush(sendFn, { info: () => {} })

        expect(result).toEqual({ sent: 3, failed: 0, queueDepth: 0 })
        expect(sendFn).toHaveBeenCalledTimes(3)
        expect(depth()).toBe(0)
    })

    test('flush with always-failure retains every entry, increments attempts', async () => {
        enqueue({ text: 'a' })
        enqueue({ text: 'b' })
        const sendFn = jest.fn().mockResolvedValue({ ok: false, status: 429, error: 'rate limited' })
        const result = await flush(sendFn, { info: () => {} })

        expect(result).toEqual({ sent: 0, failed: 2, queueDepth: 2 })
        expect(depth()).toBe(2)

        // Second flush — attempts should now be >= 2
        await flush(sendFn, { info: () => {} })
        expect(depth()).toBe(2)
    })

    test('flush with mixed success: failures stay queued, successes drain', async () => {
        enqueue({ text: 'a' })
        enqueue({ text: 'b' })
        enqueue({ text: 'c' })
        let n = 0
        const sendFn = jest.fn(async () => {
            n += 1
            // First and third succeed, second fails
            return n === 2 ? { ok: false, status: 500 } : { ok: true, status: 204 }
        })
        const result = await flush(sendFn, { info: () => {} })

        expect(result).toEqual({ sent: 2, failed: 1, queueDepth: 1 })
        expect(depth()).toBe(1)
    })

    test('flush handles sendFn that throws (not just returns ok:false)', async () => {
        enqueue({ text: 'a' })
        const sendFn = jest.fn().mockRejectedValue(new Error('network exploded'))
        const result = await flush(sendFn, { info: () => {} })

        expect(result.failed).toBe(1)
        expect(depth()).toBe(1)
    })

    test('eventual recovery: first flush fails, second succeeds, queue drains', async () => {
        enqueue({ text: 'eventual recovery' })
        const sendFn = jest.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, status: 204 })

        await flush(sendFn, { info: () => {} })
        expect(depth()).toBe(1) // still queued

        await flush(sendFn, { info: () => {} })
        expect(depth()).toBe(0) // drained
        expect(sendFn).toHaveBeenCalledTimes(2)
    })

    test('flush on empty outbox is a no-op', async () => {
        const sendFn = jest.fn()
        const result = await flush(sendFn, { info: () => {} })
        expect(result).toEqual({ sent: 0, failed: 0, queueDepth: 0 })
        expect(sendFn).not.toHaveBeenCalled()
    })

    test('enqueue returns a unique id', () => {
        const id1 = enqueue({ text: 'a' })
        const id2 = enqueue({ text: 'b' })
        expect(id1).not.toEqual(id2)
        expect(typeof id1).toBe('string')
    })

    test('clear empties the queue', () => {
        enqueue({ text: 'a' })
        enqueue({ text: 'b' })
        expect(depth()).toBe(2)
        clear()
        expect(depth()).toBe(0)
    })
})
