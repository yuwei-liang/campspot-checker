// Derive permit-bot state from its session JSONL log without modifying the
// bot itself. The bot writes one event per poll / decision / fire / heartbeat
// to permit-bot/logs/watch-auto-<ts>.jsonl. We tail the most recent file and
// roll up enough for the dashboard.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

const LOG_DIR = path.resolve('./permit-bot/logs')

// Latest log file by mtime. Returns null if dir / files missing.
export function latestPermitBotLog() {
    if (!existsSync(LOG_DIR)) return null
    const files = readdirSync(LOG_DIR)
        .filter(f => /^watch-auto-.+\.jsonl$/.test(f))
        .map(f => ({ f, mtime: statSync(path.join(LOG_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    return files[0] ? path.join(LOG_DIR, files[0].f) : null
}

// Read every line of the latest log. For our use the logs stay small (~1MB)
// so we don't bother streaming. Each line is one JSON event with
// `ts, sessionId, event, ...fields`.
function readEvents(filePath, maxLines = 5000) {
    if (!filePath || !existsSync(filePath)) return []
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const events = []
    // Walk from the tail so a 100MB log doesn't waste cycles parsing the head.
    for (let i = lines.length - 1; i >= 0 && events.length < maxLines; i--) {
        try { events.push(JSON.parse(lines[i])) } catch { /* truncated tail line */ }
    }
    return events.reverse()
}

export function readPermitBotState() {
    const logPath = latestPermitBotLog()
    if (!logPath) {
        return { present: false, reason: 'no session log' }
    }
    const events = readEvents(logPath)
    if (events.length === 0) {
        return { present: false, reason: 'empty log' }
    }
    const startup = events.find(e => e.event === 'startup')
    const lastEvent = events[events.length - 1]
    const lastPoll = [...events].reverse().find(e => e.event === 'poll')
    const lastHeartbeat = [...events].reverse().find(e => e.event === 'heartbeat')
    const decisions = events.filter(e => e.event === 'decision')
    const fires = events.filter(e => e.event === 'fire_results')
    const heldShots = fires.flatMap(f => f.results || []).filter(r => r.cartState === 'held').length
    const errors = events.filter(e => e.event === 'poll_error').length
    const recentEvents = events
        .filter(e => /^(new|decision|fire_results|prewarm|warm_row_check_failed|verify_config|heartbeat)$/.test(e.event))
        .slice(-30)
        .reverse()

    return {
        present: true,
        bot: 'permit-bot',
        mode: 'watch-auto',
        sessionLog: logPath,
        startedAt: startup?.ts || events[0]?.ts || null,
        lastHeartbeat: lastEvent?.ts || null,
        config: {
            targetDates: startup?.targets || null,
            pollIntervalMs: startup?.pollIntervalMs ?? null,
            preWarm: startup?.preWarm ?? null,
            simulate: startup?.simulate ?? null,
        },
        metrics: {
            cycles: lastPoll?.count ?? 0,
            decisions: decisions.length,
            fires: fires.length,
            heldShots,
            errors,
        },
        lastSnapshotSummary: lastPoll
            ? Object.entries(lastPoll.byDate || {})
                .map(([d, v]) => `${d.slice(5)} HI=${v.hi ?? '—'} GP=${v.gp ?? '—'}`)
                .join(' | ')
            : null,
        lastHeartbeatSummary: lastHeartbeat ? {
            uptimeMin: lastHeartbeat.uptimeMin,
            flags: lastHeartbeat.flags,
            pollCount: lastHeartbeat.pollCount,
        } : null,
        recentEvents,
    }
}
