// Atomic JSON state writer + bounded ring buffer for bot heartbeats.
//
// Each bot calls `writeBotState({ path, ... })` once per cycle. The dashboard
// reads back via `readBotState(path)`. Atomic-rename keeps the dashboard from
// ever observing a half-written file.
//
// Recent-events ring buffer: callers `appendEvent(state, evt)` to push, and we
// trim to RECENT_EVENT_CAP. Lets the dashboard show "last 50 actions" without
// the state file growing unbounded over multi-day runs.
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const RECENT_EVENT_CAP = 50

export function writeBotState(filePath, state) {
    const dir = dirname(filePath)
    mkdirSync(dir, { recursive: true })
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, filePath)
}

export function readBotState(filePath) {
    if (!existsSync(filePath)) return null
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
        return null
    }
}

export function appendEvent(state, event) {
    if (!Array.isArray(state.recentEvents)) state.recentEvents = []
    state.recentEvents.unshift({ ts: new Date().toISOString(), ...event })
    if (state.recentEvents.length > RECENT_EVENT_CAP) {
        state.recentEvents.length = RECENT_EVENT_CAP
    }
}

// Liveness from a heartbeat timestamp + the bot's poll interval. We tolerate
// a 3× expected interval before declaring "stale" — accounts for slow cycles
// (cart automation takes 10-30s) without blinking the dashboard.
export function classifyLiveness({ lastHeartbeatIso, pollIntervalMs }) {
    if (!lastHeartbeatIso) return 'unknown'
    const ageMs = Date.now() - Date.parse(lastHeartbeatIso)
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown'
    const expected = pollIntervalMs || 60_000
    if (ageMs <= expected * 3) return 'live'
    if (ageMs <= expected * 10) return 'stale'
    return 'dead'
}

// Process liveness: pid is recorded at bot startup. We probe via process.kill(pid, 0)
// which throws if the process is gone. False on missing pid → callers fall back
// to the heartbeat-based classifier.
export function isPidAlive(pid) {
    if (!pid || !Number.isFinite(pid)) return false
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}
