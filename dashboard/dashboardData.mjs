// Aggregator: collects state from the two active bots and returns one JSON
// for the dashboard.
//   - permit-bot:   derived from its session JSONL.
//   - campspot-bot: read from campspot-bot/state/status.json.
//
// Pitchwatch (the legacy campground checker baked into server.mjs) was
// retired 2026-06-22 — campspot-bot's auto-cart flow covers the use case
// end-to-end now. server.mjs is dashboard-only.
import path from 'node:path'
import { readBotState, classifyLiveness, isPidAlive } from './botState.mjs'
import { readPermitBotState } from './permitBotState.mjs'

// Resolved at call time so the dashboard can read campspot-bot's state from a
// different checkout via CAMPSPOT_STATE_FILE (symmetric to PERMIT_BOT_LOG_DIR).
// Default is the running server's cwd, which Just Works when the dashboard
// runs out of the same checkout as the bot.
function campspotStateFile() {
    return path.resolve(process.env.CAMPSPOT_STATE_FILE || './campspot-bot/state/status.json')
}

export function buildDashboardData() {
    const now = new Date().toISOString()

    // --- permit-bot ---------------------------------------------------------
    const permit = readPermitBotState()
    const permitView = permit.present ? {
        bot: 'permit-bot',
        label: 'permit-bot (LYV watch-auto)',
        mode: permit.mode,
        pid: null, // not embedded in session log
        liveness: classifyLiveness({
            lastHeartbeatIso: permit.lastHeartbeat,
            pollIntervalMs: permit.config?.pollIntervalMs ?? 1500,
        }),
        startedAt: permit.startedAt,
        lastHeartbeat: permit.lastHeartbeat,
        sessionLog: permit.sessionLog,
        config: permit.config,
        metrics: permit.metrics,
        lastSnapshotSummary: permit.lastSnapshotSummary,
        lastHeartbeatSummary: permit.lastHeartbeatSummary,
        recentEvents: permit.recentEvents,
    } : {
        bot: 'permit-bot',
        label: 'permit-bot (LYV watch-auto)',
        liveness: 'absent',
        absentReason: permit.reason,
    }

    // --- campspot-bot -------------------------------------------------------
    const campspot = readBotState(campspotStateFile())
    const campspotView = campspot ? {
        ...campspot,
        label: 'campspot-bot (Upper Pines auto-cart)',
        // Process-level liveness wins when we have a pid: a dead pid is a
        // dead bot even if the heartbeat looks recent (process just exited).
        liveness: isPidAlive(campspot.pid)
            ? classifyLiveness({
                lastHeartbeatIso: campspot.lastHeartbeat,
                pollIntervalMs: campspot.config?.pollIntervalMs,
            })
            : 'dead',
    } : {
        bot: 'campspot-bot',
        label: 'campspot-bot (Upper Pines auto-cart)',
        liveness: 'absent',
        absentReason: 'not started yet — run `node campspot-bot/campspot-bot.mjs watch --auto-grab`',
    }

    return {
        serverTime: now,
        bots: [permitView, campspotView],
    }
}
