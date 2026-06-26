// Aggregator: collects state from the two active bots and returns one JSON
// for the dashboard.
//   - permit-bot:   derived from its session JSONL.
//   - campspot-bot: read from campspot-bot/state/status.json.
//
// Pitchwatch (the legacy campground checker baked into server.mjs) was
// retired 2026-06-22 — campspot-bot's auto-cart flow covers the use case
// end-to-end now. server.mjs is dashboard-only.
import path from 'node:path'
import { readdirSync, existsSync } from 'node:fs'
import { readBotState, classifyLiveness, isPidAlive } from './botState.mjs'
import { readPermitBotState } from './permitBotState.mjs'

// Resolved at call time so the dashboard can read campspot-bot's state from a
// different checkout via CAMPSPOT_STATE_DIR (symmetric to PERMIT_BOT_LOG_DIR).
// Default is the running server's cwd, which Just Works when the dashboard
// runs out of the same checkout as the bot. CAMPSPOT_STATE_FILE is the legacy
// single-file knob — still honored so existing deployments don't break, but
// the multi-campground path is the directory scan.
function campspotStateDir() {
    if (process.env.CAMPSPOT_STATE_DIR) return path.resolve(process.env.CAMPSPOT_STATE_DIR)
    if (process.env.CAMPSPOT_STATE_FILE) return path.dirname(path.resolve(process.env.CAMPSPOT_STATE_FILE))
    return path.resolve('./campspot-bot/state')
}

function campspotStateFiles() {
    const dir = campspotStateDir()
    if (!existsSync(dir)) return []
    // Match the per-campground naming the bot writes — `status-<id>.json`.
    // The legacy `status.json` (single-campground deployments) is included
    // so dashboards updating ahead of bots don't blank out the card.
    return readdirSync(dir)
        .filter(f => /^status(-.+)?\.json$/.test(f))
        .map(f => path.join(dir, f))
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
    // One card per running watch — each campground writes its own state file.
    // If nothing is on disk yet, surface a single "absent" placeholder so the
    // dashboard still tells the operator what to run.
    const stateFiles = campspotStateFiles()
    const campspotViews = stateFiles
        .map(f => readBotState(f))
        .filter(Boolean)
        .map(s => ({
            ...s,
            label: campspotLabel(s),
            liveness: isPidAlive(s.pid)
                ? classifyLiveness({
                    lastHeartbeatIso: s.lastHeartbeat,
                    pollIntervalMs: s.config?.pollIntervalMs,
                })
                : 'dead',
        }))
    if (campspotViews.length === 0) {
        campspotViews.push({
            bot: 'campspot-bot',
            label: 'campspot-bot',
            liveness: 'absent',
            absentReason: 'not started yet — run `node campspot-bot/campspot-bot.mjs watch --campground=<id>`',
        })
    }

    return {
        serverTime: now,
        bots: [permitView, ...campspotViews],
    }
}

function campspotLabel(state) {
    const name = state.config?.campgroundName
    return name ? `campspot-bot (${name})` : 'campspot-bot'
}
