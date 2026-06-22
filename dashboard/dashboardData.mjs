// Aggregator: collects state from all three bots and returns one JSON for the
// dashboard.
//   - legacy campground-checker: in-process via Checker.getStatus().
//   - permit-bot:  derived from its session JSONL.
//   - campspot-bot: read from campspot-bot/state/status.json.
import path from 'node:path'
import { readBotState, classifyLiveness, isPidAlive } from './botState.mjs'
import { readPermitBotState } from './permitBotState.mjs'

const CAMPSPOT_STATE_FILE = path.resolve('./campspot-bot/state/status.json')

export function buildDashboardData({ checker, config }) {
    const now = new Date().toISOString()

    // --- Bot 1: legacy campground-checker -----------------------------------
    const legacyStatus = checker.getStatus()
    const legacyOpenings = legacyStatus.campgrounds.reduce(
        (n, cg) => n + (cg.availableSites?.length || 0), 0,
    )
    const legacy = {
        bot: 'pitchwatch',
        label: 'Pitchwatch (legacy campground checker)',
        mode: 'watch (notify-only)',
        pid: process.pid,
        liveness: 'live', // it's in the same process
        startedAt: null,
        lastHeartbeat: now,
        config: {
            targetDates: legacyStatus.targetDates,
            pollIntervalMs: legacyStatus.pollIntervalMs ?? config.pollIntervalMs,
            campgroundCount: legacyStatus.campgrounds.length,
        },
        metrics: {
            cycles: legacyStatus.cycle?.cycleCount ?? 0,
            campgrounds: legacyStatus.campgrounds.length,
            openCampgrounds: legacyStatus.campgrounds.filter(c => c.status === 'available').length,
            openSites: legacyOpenings,
            backoffMs: legacyStatus.backoffMs,
            errors: legacyStatus.campgrounds.filter(c => c.status === 'error').length,
        },
        cycle: legacyStatus.cycle,
        campgrounds: legacyStatus.campgrounds.map(c => ({
            id: c.id,
            name: c.name,
            park: c.park,
            enabled: c.enabled,
            status: c.status,
            lastPolledAt: c.lastPolledAt,
            availableByDate: c.availableByDate,
            siteCount: c.availableSites?.length || 0,
        })),
    }

    // --- Bot 2: permit-bot --------------------------------------------------
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

    // --- Bot 3: campspot-bot ------------------------------------------------
    const campspot = readBotState(CAMPSPOT_STATE_FILE)
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
        bots: [legacy, permitView, campspotView],
    }
}
