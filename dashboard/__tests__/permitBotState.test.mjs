// Tests for the permit-bot session-log → dashboard-state reducer.
//
// The reducer's job is to surface high-signal events from a session JSONL
// log. After we started writing `poll_recovered` events on every successful
// poll that followed a backoff, the filter had to learn two new event types
// (`poll_error` + `poll_recovered`) so the dashboard pairs the hit with the
// comeback instead of going silent after a 429.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readPermitBotState } from '../permitBotState.mjs'

function writeLog(dir, name, events) {
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n'
    writeFileSync(path.join(dir, name), lines)
}

describe('readPermitBotState', () => {
    let tmp
    let prevEnv

    beforeEach(() => {
        tmp = mkdtempSync(path.join(tmpdir(), 'permit-bot-log-'))
        prevEnv = process.env.PERMIT_BOT_LOG_DIR
        process.env.PERMIT_BOT_LOG_DIR = tmp
    })

    afterEach(() => {
        if (prevEnv === undefined) delete process.env.PERMIT_BOT_LOG_DIR
        else process.env.PERMIT_BOT_LOG_DIR = prevEnv
        rmSync(tmp, { recursive: true, force: true })
    })

    test('present=false when no session log exists', () => {
        const state = readPermitBotState()
        expect(state.present).toBe(false)
    })

    test('surfaces poll_error and poll_recovered in recentEvents', () => {
        writeLog(tmp, 'watch-auto-2026-06-26.jsonl', [
            { ts: '2026-06-26T07:40:00Z', event: 'startup', targets: ['HI', 'GP'], pollIntervalMs: 20000 },
            { ts: '2026-06-26T07:40:14Z', event: 'poll_error', error: 'Request failed with status code 429', backoffMs: 4000 },
            { ts: '2026-06-26T07:40:34Z', event: 'poll_recovered', priorBackoffMs: 4000 },
            { ts: '2026-06-26T07:40:35Z', event: 'poll', count: 1, byDate: {}, durationMs: 200 },
        ])

        const state = readPermitBotState()
        expect(state.present).toBe(true)
        const types = state.recentEvents.map(e => e.type)
        expect(types).toContain('poll_error')
        expect(types).toContain('poll_recovered')

        const recovered = state.recentEvents.find(e => e.type === 'poll_recovered')
        expect(recovered.priorBackoffMs).toBe(4000)
        const errored = state.recentEvents.find(e => e.type === 'poll_error')
        expect(errored.backoffMs).toBe(4000)
        expect(errored.error).toMatch(/429/)
    })

    test('errors metric counts poll_error events independent of the recentEvents cap', () => {
        const events = [{ ts: '2026-06-26T07:00:00Z', event: 'startup' }]
        for (let i = 0; i < 3; i++) {
            events.push({ ts: `2026-06-26T07:0${i}:00Z`, event: 'poll_error', error: '429', backoffMs: 1000 << i })
        }
        writeLog(tmp, 'watch-auto-2026-06-26.jsonl', events)

        const state = readPermitBotState()
        expect(state.metrics.errors).toBe(3)
    })

    test('low-signal events (prewarm, warm_dom_inventory) are filtered out', () => {
        writeLog(tmp, 'watch-auto-2026-06-26.jsonl', [
            { ts: '2026-06-26T07:00:00Z', event: 'startup' },
            { ts: '2026-06-26T07:00:01Z', event: 'prewarm', accountIndex: 0, ok: true },
            { ts: '2026-06-26T07:00:02Z', event: 'warm_dom_inventory', rows: 12 },
            { ts: '2026-06-26T07:00:03Z', event: 'heartbeat', uptimeMin: 1, pollCount: 1 },
        ])

        const types = readPermitBotState().recentEvents.map(e => e.type)
        expect(types).not.toContain('prewarm')
        expect(types).not.toContain('warm_dom_inventory')
        expect(types).toContain('heartbeat')
    })
})
