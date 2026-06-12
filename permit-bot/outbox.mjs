// Outbox pattern for at-least-once Discord delivery.
//
// Today's Discord pushes are fire-and-forget. If the webhook is rate-limited
// (Discord throttles at 30/min/webhook), down (Discord outage), or
// misconfigured (URL revoked), the message is lost — the bot has no memory
// of the failure and no retry path. That means a critical alert ("DRIFT
// DETECTED") can vanish silently.
//
// The outbox pattern: every outbound push first goes to a durable buffer
// (./permit-bot/.outbox.jsonl). A flusher tries to send each entry; on
// success the entry is removed. On failure it stays. The heartbeat loop
// calls flush() periodically, so a transient 429 → recovered alert in
// next 30 min, never lost.
//
// Industry standard for guaranteed-delivery: every queue-backed system
// (Kafka, SQS, RabbitMQ, Outbox-with-CDC) is some variant of this pattern.
// For one bot we use a JSONL file; same invariants, ~50 lines instead of
// 50,000.

import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const OUTBOX_PATH = path.resolve('./permit-bot/.outbox.jsonl')

// Append a message to the outbox. Returns the entry id (timestamp+random)
// so the caller can correlate with later flush outcomes.
export function enqueue({ text, screenshotPath = null, reason = 'unspecified' }) {
    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const entry = {
        id,
        ts: new Date().toISOString(),
        text,
        screenshotPath,
        reason,
        attempts: 0,
    }
    appendFileSync(OUTBOX_PATH, JSON.stringify(entry) + '\n')
    return id
}

// Try to send every entry in the outbox. Successfully delivered entries
// are dropped; failed entries get their `attempts` count incremented and
// stay queued. Returns { sent, failed, queueDepth }.
//
// The sendFn is injected so tests can stub it without hitting Discord.
export async function flush(sendFn, log = console) {
    if (!existsSync(OUTBOX_PATH)) return { sent: 0, failed: 0, queueDepth: 0 }
    const lines = readFileSync(OUTBOX_PATH, 'utf-8').split('\n').filter(Boolean)
    const entries = lines.map(l => {
        try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
    const remaining = []
    let sent = 0
    let failed = 0
    for (const e of entries) {
        try {
            const r = await sendFn(e.text, e.screenshotPath)
            if (r?.ok) {
                sent += 1
                log.info?.(`outbox: drained ${e.id} (was queued for ${Math.floor((Date.now() - new Date(e.ts).getTime()) / 1000)}s, ${e.attempts} prior attempts)`)
            } else {
                failed += 1
                e.attempts += 1
                remaining.push(e)
            }
        } catch (err) {
            failed += 1
            e.attempts += 1
            e.lastError = err.message
            remaining.push(e)
        }
    }
    if (remaining.length === 0) {
        // No leftover entries — wipe the file.
        writeFileSync(OUTBOX_PATH, '')
    } else {
        writeFileSync(OUTBOX_PATH, remaining.map(e => JSON.stringify(e)).join('\n') + '\n')
    }
    return { sent, failed, queueDepth: remaining.length }
}

// Returns current queue depth without trying to send.
export function depth() {
    if (!existsSync(OUTBOX_PATH)) return 0
    return readFileSync(OUTBOX_PATH, 'utf-8').split('\n').filter(Boolean).length
}

// Test/dev helper: clear the outbox.
export function clear() {
    if (existsSync(OUTBOX_PATH)) writeFileSync(OUTBOX_PATH, '')
}
