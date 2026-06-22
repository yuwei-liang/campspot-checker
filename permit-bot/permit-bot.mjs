#!/usr/bin/env node
import * as dotenv from 'dotenv'
dotenv.config()

import { readFileSync, createReadStream, mkdirSync, appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import axios from 'axios'
import FormData from 'form-data'

import PermitChecker from './PermitChecker.mjs'
import { login, isLoggedIn, tryGrab, getAccount, warmCart, releaseCart, verifyConfigOnce } from './CartBot.mjs'
import * as outbox from './outbox.mjs'
import { decide } from './decision.mjs'
import { httpsAgent } from './dnsBypass.mjs'
import { benchmarkPolling } from './benchmark.mjs'
import { runChartCommand, latestSessionLogPath } from './chart.mjs'

const log = {
    info: (msg) => console.log(`[${new Date().toISOString()}] ${msg}`),
    warn: (msg) => console.warn(`[${new Date().toISOString()}] WARN ${msg}`),
    error: (msg) => console.error(`[${new Date().toISOString()}] ERR  ${msg}`),
}

function loadConfig() {
    const p = path.resolve('./permit-bot/config.json')
    const raw = readFileSync(p, 'utf-8')
    return JSON.parse(raw)
}

// ntfy topic from existing .env; same channel as the campground bot so the user
// only has one subscription to manage.
const NTFY_TOPIC_URL = process.env.NTFY_TOPIC_URL || null
// Permit-bot has its own Discord channel so cart-hold confirmations don't
// drown out the campspot-checker's campground alerts. Falls back to the
// campspot WEBHOOK_URL if no permit-specific one is set.
const DISCORD_WEBHOOK_URL = process.env.PERMIT_DISCORD_WEBHOOK_URL
    || process.env.WEBHOOK_URL
    || null

// Discord delivery telemetry. Tracks consecutive failures + last error so the
// heartbeat can surface "Discord is broken" without the user discovering it
// at fire moment (a silent webhook is a silent bot).
const discordTelemetry = {
    sent: 0,
    failed: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastStatusCode: null,
}

// Post to the campspot Discord webhook. Returns { ok, status, error } so
// callers can react to rate-limit / outage. If screenshotPath is provided, the
// image is attached as a multipart upload so the user can verify visually
// without leaving Discord.
async function discordPush(text, screenshotPath = null) {
    if (!DISCORD_WEBHOOK_URL) {
        log.warn('No WEBHOOK_URL in .env — skipping Discord push.')
        return { ok: false, status: 0, error: 'no_webhook' }
    }
    try {
        let res
        if (screenshotPath) {
            const form = new FormData()
            form.append('payload_json', JSON.stringify({ content: text }), {
                contentType: 'application/json',
            })
            form.append('file1', createReadStream(screenshotPath), {
                filename: path.basename(screenshotPath),
                contentType: 'image/png',
            })
            res = await axios.post(DISCORD_WEBHOOK_URL, form, {
                timeout: 20000,
                httpsAgent,
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            })
        } else {
            res = await axios.post(DISCORD_WEBHOOK_URL, { content: text }, { timeout: 10000, httpsAgent })
        }
        discordTelemetry.sent += 1
        discordTelemetry.consecutiveFailures = 0
        discordTelemetry.lastStatusCode = res.status
        log.info(`Discord push sent (status ${res.status}).`)
        return { ok: true, status: res.status }
    } catch (err) {
        const status = err.response?.status ?? 0
        discordTelemetry.failed += 1
        discordTelemetry.consecutiveFailures += 1
        discordTelemetry.lastError = err.message
        discordTelemetry.lastStatusCode = status
        // Discord rate-limits at 30/min per webhook; 429 means we're being
        // throttled and should slow down. 5xx = Discord outage. Either way,
        // a silent failure here = silent bot, so log loudly + enqueue.
        log.warn(`Discord push failed (status ${status}): ${err.message}. Consecutive: ${discordTelemetry.consecutiveFailures}`)
        // Outbox: enqueue the failed push so the next heartbeat retries.
        // Catches transient 429s and short Discord outages.
        try {
            const id = outbox.enqueue({ text, screenshotPath, reason: `status_${status}` })
            log.info(`Outbox enqueued ${id} for retry (depth=${outbox.depth()})`)
        } catch (oErr) {
            log.warn(`Outbox enqueue failed: ${oErr.message}`)
        }
        return { ok: false, status, error: err.message }
    }
}

// Raw HTTP push — no outbox indirection, no telemetry mutations. Used by
// the outbox flusher itself so retries don't infinite-loop back into the
// outbox.
async function rawDiscordSend(text, screenshotPath = null) {
    if (!DISCORD_WEBHOOK_URL) return { ok: false, status: 0, error: 'no_webhook' }
    try {
        let res
        if (screenshotPath) {
            const form = new FormData()
            form.append('payload_json', JSON.stringify({ content: text }), {
                contentType: 'application/json',
            })
            form.append('file1', createReadStream(screenshotPath), {
                filename: path.basename(screenshotPath),
                contentType: 'image/png',
            })
            res = await axios.post(DISCORD_WEBHOOK_URL, form, {
                timeout: 20000,
                httpsAgent,
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            })
        } else {
            res = await axios.post(DISCORD_WEBHOOK_URL, { content: text }, { timeout: 10000, httpsAgent })
        }
        return { ok: true, status: res.status }
    } catch (err) {
        return { ok: false, status: err.response?.status ?? 0, error: err.message }
    }
}

async function pushNtfy(title, message, opts = {}) {
    if (!NTFY_TOPIC_URL) return
    try {
        const headers = {
            'Title': title.replace(/[\r\n]+/g, ' ').slice(0, 250),
            'Priority': opts.priority || '5',
            'Tags': opts.tags || 'mountain,bell',
        }
        if (opts.click) headers['Click'] = opts.click
        if (opts.actions?.length) {
            // ntfy "Actions" header is comma-separated, ASCII-only labels.
            headers['Actions'] = opts.actions.map(a =>
                `view, ${a.label}, ${a.url}, clear=true`
            ).join('; ')
        }
        await axios.post(NTFY_TOPIC_URL, message, { headers, timeout: 5000, httpsAgent })
    } catch (err) {
        log.warn(`ntfy push failed: ${err.message}`)
    }
}

function pickIntervalMs(config) {
    const bw = config.burstWindow
    if (bw?.startIso && bw?.endIso && bw?.burstIntervalMs) {
        const now = Date.now()
        if (now >= Date.parse(bw.startIso) && now <= Date.parse(bw.endIso)) {
            return bw.burstIntervalMs
        }
    }
    return config.pollIntervalMs
}

function jitter(ms) {
    return ms + Math.floor(Math.random() * Math.min(500, ms * 0.2))
}

async function cmdLogin({ accountIndex = 1 } = {}) {
    await login({ log, accountIndex })
}

async function cmdCheckSession({ accountIndex = 1 } = {}) {
    const ok = await isLoggedIn({ log, accountIndex })
    const tag = `account=${accountIndex}`
    console.log(ok ? `LOGGED IN (${tag})` : `NOT logged in (${tag}) — run: node permit-bot/permit-bot.mjs login --account=${accountIndex}`)
    process.exit(ok ? 0 : 1)
}

// Pre-flight DOM check: confirms every target's nameTokens still resolve to
// a row in rec.gov's live DOM. Exits 0 if all OK, 1 if any missing — wire it
// into race-restart.sh and CI to catch rec.gov copy edits before race day.
async function cmdVerifyConfig() {
    const config = loadConfig()
    const targets = config.targets.map(t => ({
        divisionId: t.divisionId,
        name: t.name,
        // Fall back to first-segment tokens if config doesn't define nameTokens
        // explicitly (older configs without the field still get token matching).
        nameTokens: t.nameTokens || [t.name.split('->')[0].trim(), t.name.split(' (')[0].split('->').pop().trim()],
    }))
    log.info(`verify-config: probing ${targets.length} targets against live rec.gov`)
    const result = await verifyConfigOnce({
        permitId: config.permitId,
        date: config.targetDates[0],
        partySize: config.partySize,
        targets,
        log,
    })
    for (const t of result.perTarget) {
        console.log(`  ${t.found ? '✓' : '✗'} ${t.name.padEnd(60)} id=${t.divisionId} via=${t.strategy}`)
    }
    if (!result.ok) {
        console.error('\nVERIFY FAILED:')
        for (const e of result.errors) console.error(`  - ${e}`)
        process.exit(1)
    }
    console.log('\nVERIFY OK: all targets resolve from tokens.')
    process.exit(0)
}

async function cmdProbe() {
    const config = loadConfig()
    const checker = new PermitChecker({
        permitId: config.permitId,
        targets: config.targets,
        targetDates: config.targetDates,
        log,
    })
    const payload = await checker.pollOnce()
    const { snapshot } = checker.diff(payload)
    console.log('Snapshot rows:')
    for (const r of snapshot.rows) {
        const remain = r.remaining == null ? '—' : r.remaining
        const total = r.total == null ? '—' : r.total
        console.log(`  ${r.date}  ${r.target.name.padEnd(50)} ${remain}/${total}`)
    }
}

async function cmdTestCart({ dryRun = true, overrides = {}, accountIndex = 1 } = {}) {
    const config = loadConfig()
    const t = overrides.divisionId
        ? { divisionId: overrides.divisionId, name: overrides.name || overrides.divisionId }
        : config.targets[0]
    const date = overrides.date || config.targetDates[0]
    const acct = getAccount(accountIndex)
    log.info(`test-cart: ${t.name} on ${date} (dry-run=${dryRun}) account=${accountIndex}(${acct.email})`)
    const result = await tryGrab({
        accountIndex,
        permitId: config.permitId,
        divisionId: t.divisionId,
        divisionName: t.name,
        divisionTokens: t.nameTokens,
        date,
        partySize: overrides.partySize || config.partySize,
        dryRun,
        log,
    })
    log.info(`Result: ${JSON.stringify({ ok: result.ok, reason: result.reason, cartState: result.cartState })}`)

    // For real for-real runs: post a Discord confirmation with all the details
    // the user needs to verify (account, trailhead, date, cart state) plus the
    // /cart screenshot so they can SEE it without leaving Discord.
    if (!dryRun && result.ok) {
        const lines = [
            result.cartState === 'held'
                ? '✅ **CART HOLD CONFIRMED**'
                : result.cartState === 'empty'
                    ? '⚠️ Book Now clicked, but cart is EMPTY (still in wizard? not yet held)'
                    : '⚠️ Book Now clicked — cart state unclear, see screenshot',
            `**Account:** #${accountIndex} (${acct.email})`,
            `**Trailhead:** ${t.name}`,
            `**Date:** ${date}`,
            `**Party size:** ${overrides.partySize || config.partySize}`,
            `**Post-click URL:** ${result.postClickUrl || '(unknown)'}`,
            `**Cart state:** ${result.cartState}`,
            `**Action needed:** open https://www.recreation.gov/cart and Remove this hold within 15 min if it's a test`,
        ]
        await discordPush(lines.join('\n'), result.cartShot || result.postClickShot)
    }

    // Hold for 30s so user can inspect; then close.
    if (result.ctx) {
        await new Promise(r => setTimeout(r, 30_000))
        await result.ctx.close().catch(() => {})
    }
}

async function cmdTestWarm({ accountIndexes, overrides = {} }) {
    const config = loadConfig()
    const t = overrides.divisionId
        ? { divisionId: overrides.divisionId, name: overrides.name || overrides.divisionId }
        : config.targets[0]
    const date = overrides.date || config.targetDates[0]
    const partySize = overrides.partySize || config.partySize
    log.info(`test-warm: ${t.name} on ${date} party=${partySize} across accounts=[${accountIndexes.join(',')}]`)

    // 1) Pre-launch one warm cart per account, in parallel.
    const setupStart = Date.now()
    const warmers = await Promise.all(
        accountIndexes.map(idx => warmCart({
            permitId: config.permitId,
            date,
            partySize,
            accountIndex: idx,
            log,
        })),
    )
    const setupMs = Date.now() - setupStart
    log.info(`==== WARM SETUP COMPLETE in ${setupMs}ms across ${warmers.length} accounts ====`)

    // 2) Idle 3s to simulate "waiting for release".
    log.info('Idling 3s, then firing all hot() in parallel ...')
    await new Promise(r => setTimeout(r, 3000))

    // 3) Trigger ALL hot() in parallel. This is the simulated "release moment".
    const fireStart = Date.now()
    const results = await Promise.all(
        warmers.map(w => w.hot(t.name, date).catch(err => ({ ok: false, reason: err.message, accountIndex: w.accountIndex, email: w.email }))),
    )
    const fireWallMs = Date.now() - fireStart
    log.info(`==== HOT FIRE COMPLETE in ${fireWallMs}ms (wall clock for slowest) ====`)

    // 4) Report.
    for (const r of results) {
        log.info(`acct${r.accountIndex} (${r.email}): ok=${r.ok} cart=${r.cartState ?? '-'} bookClick=${r.latencyMs?.bookClick ?? '-'}ms total=${r.latencyMs?.total ?? '-'}ms`)
    }

    // 5) Discord per success.
    for (const r of results) {
        if (!r.ok) continue
        const lines = [
            r.cartState === 'held' ? '✅ **WARM CART HOLD CONFIRMED**' : `⚠️ Warm grab ran but cart=${r.cartState}`,
            `**Account:** #${r.accountIndex} (${r.email})`,
            `**Trailhead:** ${t.name}`,
            `**Date:** ${date}`,
            `**Party size:** ${partySize}`,
            `**Latency (book click):** ${r.latencyMs?.bookClick}ms`,
            `**Latency (cart confirmed):** ${r.latencyMs?.total}ms`,
            `**Setup time (pre-paid):** ${setupMs}ms`,
            `**Post-click URL:** ${r.postClickUrl ?? '(unknown)'}`,
            `**Release after testing:** https://www.recreation.gov/cart`,
        ]
        await discordPush(lines.join('\n'), r.cartShot || r.postShot)
    }

    // 6) Hold contexts open 25s so user can inspect.
    log.info('Holding warm contexts open 25s for inspection, then closing.')
    await new Promise(r => setTimeout(r, 25_000))
    await Promise.all(warmers.map(w => w.ctx.close().catch(() => {})))
}

// Open a JSONL session log for the current run. Every poll, decision, fire,
// and result gets appended so we can post-mortem failed grabs offline.
//
// Correlation IDs: every event carries a `sessionId` (one per watch-auto run)
// plus an optional `fireId` (one per fire). Post-mortem `jq` queries like
// `select(.fireId == "abc")` reconstruct the full timeline of one fire across
// decisions/shots/results. Lightweight trace context — no OpenTelemetry needed.
function openSessionLog() {
    const dir = path.resolve('./permit-bot/logs')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = path.join(dir, `watch-auto-${stamp}.jsonl`)
    const sessionId = randomUUID()
    return {
        filePath,
        sessionId,
        write(event, fields = {}) {
            const line = JSON.stringify({
                ts: new Date().toISOString(),
                sessionId,
                event,
                ...fields,
            }) + '\n'
            try { appendFileSync(filePath, line) } catch (err) {
                console.error(`session log write failed: ${err.message}`)
            }
        },
    }
}

// LYV-specific auto-grab watch. Polls the API every config.pollIntervalMs and
// on every cycle runs decide() to figure out if there's a viable plan
// (solo or split, party 7 first, fall back to 6). Fires all shots in parallel.
//
// Exit semantics:
//   FULL success (all shots → cart held) → exit + notify
//   PARTIAL success (1+ but not all)     → exit; user decides what to do
//   ALL fail                              → KEEP WATCHING; user can investigate
//
// Heartbeat: every HEARTBEAT_MS, posts a "still alive" Discord ping with
// poll count + last snapshot, so an unattended overnight monitor is visible.
//
// Session log: every event (poll, decision, fire, error, heartbeat) appended
// as JSONL to permit-bot/logs/watch-auto-{timestamp}.jsonl. Post-mortem fuel.
async function cmdWatchAuto({
    preWarm = false,
    simulate = null,
    fakeHi = null,
    fakeGp = null,
    partyTargets = null,
    hiDiv = null,
    hiName = null,
    gpDiv = null,
    gpName = null,
} = {}) {
    const config = loadConfig()
    // LYV-specific division IDs (must match decision.mjs).
    // Simulate mode overrides to Cottonwood Creek so we can dry-run the full
    // fire path against a known-available slot without waiting for LYV release.
    // Explicit --hi-div/--gp-div override both modes for custom test scenarios.
    // Names match rec.gov's exact DOM text (no spaces around `->`, with
    // "(No Donohue Pass)" on HI). nameTokens drive token-based row matching
    // in CartBot.findRowByTokens — robust to whitespace and rec.gov copy
    // edits. Simulate mode points at Cottonwood Creek for live-fire testing.
    const HI_ID = hiDiv || (simulate ? '44585909' : '44585917')
    const HI_NAME = hiName || (simulate ? 'Cottonwood Creek' : 'Happy Isles->Little Yosemite Valley (No Donohue Pass)')
    const HI_TOKENS = simulate ? ['Cottonwood Creek'] : ['Happy Isles', 'Little Yosemite Valley']
    const GP_ID = gpDiv || (simulate ? '44585909' : '44585913')
    const GP_NAME = gpName || (simulate ? 'Cottonwood Creek' : 'Glacier Point->Little Yosemite Valley')
    const GP_TOKENS = simulate ? ['Cottonwood Creek'] : ['Glacier Point', 'Little Yosemite Valley']
    const HI_TARGET = { divisionId: HI_ID, name: HI_NAME, nameTokens: HI_TOKENS }
    const GP_TARGET = { divisionId: GP_ID, name: GP_NAME, nameTokens: GP_TOKENS }
    const checker = new PermitChecker({
        permitId: config.permitId,
        targets: [HI_TARGET, GP_TARGET],
        targetDates: config.targetDates,
        log,
    })

    const session = openSessionLog()
    const sessionStart = Date.now()
    const HEARTBEAT_MS = 30 * 60 * 1000  // 30 min
    let pollCount = 0
    let consecutiveAllFail = 0
    let lastSnapshotSummary = '(none yet)'
    // Anchor first heartbeat to sessionStart so it fires HEARTBEAT_MS after
    // launch, not immediately (otherwise it doubles up with the startup ping).
    let lastHeartbeatAt = Date.now()

    // Per-heartbeat window stats: every poll bumps the right bucket per
    // (date, division). At heartbeat fire we render a summary and reset.
    // Tracks what we couldn't see in the prior single-snapshot heartbeat:
    // how the cell flapped between null/0/>0 during the window.
    const windowStats = new Map() // key: `${date}|${div}` -> stats
    const ensureStats = (key) => {
        if (!windowStats.has(key)) {
            windowStats.set(key, {
                nullCount: 0,
                zeroCount: 0,
                nonZeroCount: 0,
                peakV: 0,
                peakAt: null,
                transitions: 0,
                lastState: null,
            })
        }
        return windowStats.get(key)
    }
    const stateOf = (v) => v == null ? 'null' : v === 0 ? 'zero' : 'pos'

    // "Would-have-fired" shadow: for each candidate party size BELOW the
    // current floor, count polls where decide() would have returned a plan.
    // Lets the heartbeat answer "should I lower partyTargets?" with data
    // instead of speculation. Tracked per (date, size); also peakTotal/date.
    const WOULD_FIRE_SIZES = [2, 3, 4, 5]
    const wouldFireStats = new Map() // key: date -> { sizeCounts: Map, peakTotal: {v, ts} }
    const ensureWouldFire = (date) => {
        if (!wouldFireStats.has(date)) {
            wouldFireStats.set(date, {
                sizeCounts: new Map(WOULD_FIRE_SIZES.map(s => [s, 0])),
                peakTotal: { v: 0, ts: null },
            })
        }
        return wouldFireStats.get(date)
    }

    // Fire telemetry rollup: tracks reload outcomes and apiSignalToBookClickMs
    // across the heartbeat window. Most windows empty (no fire); the heartbeat
    // omits the section when so.
    const fireTelemetry = []
    // Format ISO ts as HH:MM:SS in America/Los_Angeles for at-a-glance reading.
    const formatPT = (iso) => new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(iso))

    log.info(`watch-auto: targets=LYV (HI+GP), dates=${config.targetDates.join(', ')}, poll=${config.pollIntervalMs}ms, preWarm=${preWarm}`)
    log.info(`Session log: ${session.filePath}`)
    session.write('startup', {
        targets: config.targetDates,
        pollIntervalMs: config.pollIntervalMs,
        preWarm,
        simulate,
        fakeHi,
        fakeGp,
    })

    // Startup Discord ping so you know the monitor is up.
    await discordPush([
        '🟢 **watch-auto started**',
        `**Dates:** ${config.targetDates.join(', ')}`,
        `**Poll interval:** ${config.pollIntervalMs}ms`,
        `**Pre-warm:** ${preWarm ? 'on (acct1 HI party=7)' : 'off'}`,
        `**Mode:** ${simulate ? 'SIMULATE → Cottonwood Creek' : 'LYV LIVE'}`,
        `**Session log:** \`${session.filePath}\``,
        `Heartbeat every 30 min until grab or shutdown.`,
    ].join('\n'))

    // Pre-warm BOTH accounts in parallel — acct1 on Happy Isles party=7 (solo
    // case), acct2 on Glacier Point party=6 (split case where gp ≤ 6). T11
    // autonomously downgrades party on the fly if remaining < pinned size, so
    // both warmers can also handle smaller-party plans without rebuilding.
    const warmers = []
    if (preWarm) {
        const specs = [
            { accountIndex: 1, target: HI_TARGET, partySize: 7, role: 'HI/solo' },
            { accountIndex: 2, target: GP_TARGET, partySize: 6, role: 'GP/split' },
        ]
        log.info(`Pre-warming ${specs.length} accounts in parallel: ${specs.map(s => `acct${s.accountIndex} ${s.role} party=${s.partySize}`).join(', ')}`)
        // Each warmer is briefed on BOTH LYV targets so it can sanity-check
        // that both rows are present at warm time. If one is missing, we
        // alert immediately rather than discovering at fire-time (the 06-12
        // bug class).
        const expectedTargets = [HI_TARGET, GP_TARGET]
        const results = await Promise.allSettled(specs.map(spec => warmCart({
            permitId: config.permitId,
            date: config.targetDates[0],
            partySize: spec.partySize,
            accountIndex: spec.accountIndex,
            expectedTargets,
            log,
        })))
        for (let i = 0; i < results.length; i++) {
            const spec = specs[i]
            const r = results[i]
            if (r.status === 'fulfilled') {
                warmers.push({ ...r.value, ...spec })
                session.write('prewarm', {
                    accountIndex: spec.accountIndex,
                    ok: true,
                    checkedRows: r.value.checkedRows,
                    domInventoryCount: r.value.domInventory?.length || 0,
                })
                // Item 1: snapshot the full trailhead inventory at warm time.
                // If any future race fails with row_not_visible, this is the
                // ground-truth record of which rows were on the page.
                session.write('warm_dom_inventory', {
                    accountIndex: spec.accountIndex,
                    count: r.value.domInventory?.length || 0,
                    trailheads: r.value.domInventory || [],
                })
            } else {
                log.warn(`Pre-warm acct${spec.accountIndex} failed: ${r.reason?.message}. Cold-only for that account.`)
                session.write('prewarm', { accountIndex: spec.accountIndex, ok: false, error: r.reason?.message })
            }
        }
        log.info(`Pre-warm complete; ${warmers.length}/${specs.length} warmers idling.`)

        // CRITICAL alarm: if any warmer reports a missing target row, race
        // will fail with row_not_visible. Surface it now (not at 7am).
        const missing = []
        for (const w of warmers) {
            for (const c of w.checkedRows || []) {
                if (!c.ok) missing.push({ accountIndex: w.accountIndex, ...c })
            }
        }
        if (missing.length) {
            const lines = [
                '🚨 **WARM-PAGE ROW CHECK FAILED — RACE WILL FAIL UNLESS FIXED**',
                ...missing.map(m =>
                    `acct${m.accountIndex} missing row: \`${m.name}\` (divisionId=${m.divisionId})`,
                ),
                '',
                'Tokens are out of sync with rec.gov display text. Run',
                '`node permit-bot/permit-bot.mjs verify-config` to see the live row text',
                'and update `decision.mjs` HAPPY_ISLES/GLACIER_POINT.',
            ].join('\n')
            log.error(lines)
            await discordPush(lines)
            session.write('warm_row_check_failed', { missing })
        } else if (warmers.length === expectedTargets.length) {
            log.info('Warm row check: ALL OK')
        }
    }

    let firedThisRun = false

    // Trailhead overrides feed into decide() so the returned shots target the
    // right divisions. simulate mode points both at Cottonwood; explicit
    // --hi-div/--gp-div let us mix trailheads (e.g. real cross-trailhead test).
    const overrideTrailheads = !!(simulate || hiDiv || gpDiv)
    const decideOpts = {}
    if (overrideTrailheads) {
        decideOpts.hiTrailhead = HI_TARGET
        decideOpts.gpTrailhead = GP_TARGET
    }
    if (partyTargets) decideOpts.partyTargets = partyTargets

    // Per-date independent decision. We exit on FULL or PARTIAL success;
    // ALL-FAIL keeps the watcher alive (incrementing consecutiveAllFail) so a
    // transient blip (slow network, bad selector miss, captcha) doesn't lose
    // the rest of the morning.
    const tryFireForDate = async (date, hiRemain, gpRemain) => {
        if (firedThisRun) return
        const plan = decide({ hi: hiRemain, gp: gpRemain, ...decideOpts })
        if (!plan) {
            // Item 5: log WHY decide() returned null. Helps understand "we
            // saw HI=3 GP=2 but didn't fire" — useful for tuning party-target
            // configs and detecting "we should have fired but didn't."
            const need = decideOpts.partyTargets?.[decideOpts.partyTargets.length - 1] || 6
            const total = (hiRemain || 0) + (gpRemain || 0)
            const reason = total < need
                ? `total ${total} < smallest party target ${need}`
                : hiRemain === 0 && gpRemain === 0
                    ? 'both trailheads at zero'
                    : 'split infeasible (likely gp > GP_CAP)'
            session.write('decision_skipped', { date, hi: hiRemain, gp: gpRemain, reason })
            return
        }
        // Item D: correlation ID per fire. Every event in this fire carries
        // the same fireId so post-mortem `jq` can reconstruct the sequence.
        const fireId = randomUUID().slice(0, 8)
        // apiSignalAt: timestamp of the poll that produced this decision.
        // Within ~1ms of the actual API response — passed to hot() so it can
        // surface apiSignalToBookClickMs (the user's actual KPI: how long
        // from "API said yes" to "Book Now clicked").
        const apiSignalAt = Date.now()
        log.info(`!! decision for ${date} [fire=${fireId}]: ${plan.kind} party=${plan.partySize}`)
        for (const s of plan.shots) log.info(`   shot: acct${s.accountIndex} ${s.name} party=${s.party}`)
        session.write('decision', { fireId, date, plan: { kind: plan.kind, partySize: plan.partySize, shots: plan.shots } })

        await pushNtfy(
            `LYV plan firing: ${plan.kind} party=${plan.partySize} on ${date}`,
            plan.shots.map(s => `acct${s.accountIndex} ${s.name.split('->')[0].trim()} ${s.party}p`).join(' + '),
            { priority: '5', tags: 'rotating_light,mountain' },
        )

        // Match shot to warmer by accountIndex (each account has at most one
        // warmer). T11 autonomous downgrade handles party-size mismatch on the
        // page itself, so any planned party ≤ warmer.partySize works.
        const findWarmer = (s) => warmers.find(w => w.accountIndex === s.accountIndex)

        const shotPromises = plan.shots.map(async (s) => {
            const tag = `[shot acct${s.accountIndex} ${s.divisionId}]`
            const warmer = findWarmer(s)
            // Shots from decide() carry name + divisionId + nameTokens spread
            // from the HI/GP target constants. Pass the full target into the
            // row finder.
            const shotTarget = {
                divisionId: s.divisionId,
                name: s.name,
                nameTokens: s.nameTokens,
            }
            try {
                if (warmer) {
                    log.info(`${tag} using warm hot path (warmer pinned at party=${warmer.partySize}, plan party=${s.party})`)
                    const r = await warmer.hot(shotTarget, date, { apiSignalAt })
                    return { ...r, shot: s }
                } else {
                    log.info(`${tag} cold launch`)
                    const r = await tryGrab({
                        permitId: config.permitId,
                        divisionId: s.divisionId,
                        divisionName: s.name,
                        divisionTokens: s.nameTokens,
                        date,
                        partySize: s.party,
                        accountIndex: s.accountIndex,
                        log,
                    })
                    // tryGrab returns slightly different shape; normalize.
                    return {
                        ok: r.ok,
                        cartState: r.cartState,
                        postClickUrl: r.postClickUrl,
                        postShot: r.postClickShot,
                        cartShot: r.cartShot,
                        accountIndex: s.accountIndex,
                        email: getAccount(s.accountIndex).email,
                        shot: s,
                    }
                }
            } catch (err) {
                log.error(`${tag} threw: ${err.message}`)
                return { ok: false, reason: err.message, accountIndex: s.accountIndex, email: getAccount(s.accountIndex).email, shot: s }
            }
        })

        const results = await Promise.all(shotPromises)
        const heldCount = results.filter(r => r.cartState === 'held').length
        const allHeld = heldCount === plan.shots.length
        const allFailed = heldCount === 0
        // Use ACTUAL party (after autonomous overcap downgrade), not the
        // planned shot.party. A shot planned for 7 may have committed 4 if
        // the soldier-on-the-field detected only 4 left.
        const partyAcquired = results
            .filter(r => r.cartState === 'held')
            .reduce((sum, r) => sum + (r.actualParty ?? r.shot?.party ?? 0), 0)

        const summary = allHeld
            ? `✅ FULL SUCCESS: ${plan.kind} party=${plan.partySize}`
            : !allFailed
                ? `⚠️ PARTIAL: held ${partyAcquired}/${plan.partySize} people across ${heldCount}/${plan.shots.length} shots`
                : `❌ ALL FAILED — watcher will keep polling`
        log.info(summary)
        // Capture per-shot rollup for heartbeat-level fire telemetry: who
        // reloaded, what the reload yielded, and the user's actual KPI
        // (apiSignal → bookClick).
        for (const r of results) {
            fireTelemetry.push({
                fireId,
                date,
                accountIndex: r.accountIndex,
                cartState: r.cartState,
                reason: r.reason,
                apiSignalToBookClickMs: r.latencyMs?.apiSignalToBookClickMs ?? null,
                didReload: r.latencyMs?.didReload ?? null,
                reloadOutcome: r.latencyMs?.reloadOutcome ?? null,
            })
        }
        session.write('fire_results', {
            fireId,
            date,
            allHeld,
            allFailed,
            heldCount,
            partyAcquired,
            apiSignalAt,
            results: results.map(r => ({
                accountIndex: r.accountIndex,
                shot: r.shot,
                cartState: r.cartState,
                reason: r.reason,
                latencyMs: r.latencyMs,
            })),
        })

        // Per-shot Discord notifications.
        for (const r of results) {
            const partyLine = (r.actualParty != null && r.actualParty !== r.shot.party)
                ? `**Party:** ${r.actualParty} acquired (planned ${r.shot.party} — autonomous downgrade)`
                : `**Party size:** ${r.shot.party}`
            const lines = [
                r.cartState === 'held'
                    ? '✅ **CART HOLD CONFIRMED (watch-auto)**'
                    : `❌ Shot failed: ${r.reason || `cart=${r.cartState ?? 'unknown'}`}`,
                `**Account:** #${r.accountIndex} (${r.email})`,
                `**Trailhead:** ${r.shot.name}`,
                `**Date:** ${date}`,
                partyLine,
                `**Plan kind:** ${plan.kind} (target party=${plan.partySize})`,
                `**Latency book-click:** ${r.latencyMs?.bookClick ?? '-'}ms`,
                `**Latency total:** ${r.latencyMs?.total ?? '-'}ms`,
                `**API→bookClick:** ${r.latencyMs?.apiSignalToBookClickMs ?? '-'}ms`,
                `**Stale-DOM reload:** ${r.latencyMs?.reloadOutcome ? `fired → ${r.latencyMs.reloadOutcome}` : 'not needed'}`,
            ]
            await discordPush(lines.join('\n'), r.cartShot || r.postShot || null)
        }

        // Plan-level summary push.
        const summarySuffix = allHeld
            ? ' — RELEASE TEST HOLDS IF THIS WAS A SIMULATION'
            : !allFailed
                ? ` — partial hold. Release at https://www.recreation.gov/cart if you don't want it.`
                : ` — kept watching (attempt ${consecutiveAllFail + 1})`
        await discordPush(`${summary} — ${date} — fired ${plan.shots.length} shot(s)${summarySuffix}`)

        // Exit/continue logic.
        // 06-22 update: capping at 3 strikes with a 90s cooldown between
        // attempts (was 5×30s). The 06-16 race showed our old burst rate
        // (5 fires in 8 min) tripped rec.gov's reCAPTCHA v3 score and
        // triggered visible challenges that blocked subsequent clicks. After
        // 3 strikes we SLEEP 30 min instead of shutting down — the bot keeps
        // polling and can fire again later (echo windows, next attempt the
        // following race day). Shutting down silently lost us six race days
        // 06-17 through 06-22.
        if (allHeld || !allFailed) {
            firedThisRun = true
            consecutiveAllFail = 0
        } else {
            consecutiveAllFail += 1
            if (consecutiveAllFail >= 3) {
                log.warn('3 consecutive all-fails — pausing fires for 30 min, watcher stays alive.')
                await discordPush('🟡 **watch-auto: 3 consecutive all-fail attempts. Pausing fires for 30 min** (watcher stays alive — polls + heartbeat continue).')
                await new Promise(r => setTimeout(r, 30 * 60 * 1000))
                consecutiveAllFail = 0
            } else {
                // 90s human-paced cooldown — slow enough not to look scripted,
                // fast enough to catch a slot-recycling echo.
                await new Promise(r => setTimeout(r, 90_000))
            }
        }
    }

    // Main poll loop.
    while (!firedThisRun) {
        const tickStart = Date.now()
        try {
            const payload = await checker.pollOnce()
            const { snapshot } = checker.diff(payload)
            checker.resetBackoff()
            pollCount += 1

            // Build {date -> {hi, gp}} from snapshot rows.
            const byDate = {}
            for (const r of snapshot.rows) {
                if (!byDate[r.date]) byDate[r.date] = { hi: null, gp: null }
                if (r.target.divisionId === HI_ID) byDate[r.date].hi = r.remaining
                if (r.target.divisionId === GP_ID) byDate[r.date].gp = r.remaining
            }

            const summary = Object.entries(byDate)
                .map(([d, v]) => `${d.slice(5)} HI=${v.hi ?? '—'} GP=${v.gp ?? '—'}`)
                .join(' | ')
            lastSnapshotSummary = summary
            log.info(`poll ${pollCount} ok | ${summary}`)
            session.write('poll', { count: pollCount, byDate, durationMs: Date.now() - tickStart })

            // Window stats: bump per (date, division). Captures null/0/>0
            // distribution, peak remaining, and transitions for the heartbeat.
            const nowIso = new Date().toISOString()
            for (const [d, v] of Object.entries(byDate)) {
                for (const [divName, val] of [['hi', v.hi], ['gp', v.gp]]) {
                    const stats = ensureStats(`${d}|${divName}`)
                    const cur = stateOf(val)
                    if (cur === 'null') stats.nullCount++
                    else if (cur === 'zero') stats.zeroCount++
                    else stats.nonZeroCount++
                    if (val != null && val > stats.peakV) {
                        stats.peakV = val
                        stats.peakAt = nowIso
                    }
                    if (stats.lastState !== null && stats.lastState !== cur) {
                        stats.transitions++
                    }
                    stats.lastState = cur
                }

                // Shadow: per candidate party size, would decide() have fired?
                const hiNum = v.hi ?? 0
                const gpNum = v.gp ?? 0
                const wf = ensureWouldFire(d)
                const total = hiNum + gpNum
                if (total > wf.peakTotal.v) {
                    wf.peakTotal = { v: total, ts: nowIso }
                }
                for (const size of WOULD_FIRE_SIZES) {
                    const shadowPlan = decide({
                        hi: hiNum,
                        gp: gpNum,
                        partyTargets: [size],
                        ...decideOpts,
                    })
                    if (shadowPlan) wf.sizeCounts.set(size, wf.sizeCounts.get(size) + 1)
                }
            }

            for (const [date, v] of Object.entries(byDate)) {
                // For testing: --fake-hi/--fake-gp override the snapshot values
                // (e.g. force a split scenario when real numbers say solo).
                const hiUsed = fakeHi != null ? fakeHi : (v.hi ?? 0)
                const gpUsed = fakeGp != null ? fakeGp : (v.gp ?? 0)
                if (fakeHi != null || fakeGp != null) {
                    log.info(`(fake snapshot) hi=${hiUsed} gp=${gpUsed} for ${date}`)
                }
                await tryFireForDate(date, hiUsed, gpUsed)
                if (firedThisRun) break
            }
        } catch (err) {
            checker.handleError(err)
            session.write('poll_error', { error: err.message, backoffMs: checker.backoffMs })
        }

        // Heartbeat: every HEARTBEAT_MS, ping Discord so the user knows we're alive.
        const now = Date.now()
        if (now - lastHeartbeatAt >= HEARTBEAT_MS) {
            lastHeartbeatAt = now
            const uptimeMin = Math.floor((now - sessionStart) / 60000)

            // Drift watchdog: every heartbeat we also run verify-config in a
            // separate headless context. If rec.gov renames a trailhead, the
            // alarm fires here — hours before race-time — instead of at fire
            // time when it's too late. Skipped in simulate mode (tokens point
            // at Cottonwood; verify against real LYV is misleading there).
            let verifyLine = '_(skipped in simulate mode)_'
            let verifyOk = true
            if (!simulate) {
                try {
                    const verifyResult = await verifyConfigOnce({
                        permitId: config.permitId,
                        date: config.targetDates[0],
                        partySize: config.partySize,
                        targets: [HI_TARGET, GP_TARGET],
                        log: { info: () => {}, warn: log.warn, error: log.error },
                    })
                    verifyOk = verifyResult.ok
                    verifyLine = verifyOk
                        ? `OK (${verifyResult.perTarget.map(t => `${t.divisionId}:${t.strategy}`).join(', ')})`
                        : `**DRIFT — ${verifyResult.errors.join('; ')}**`
                    session.write('verify_config', verifyResult)
                } catch (err) {
                    verifyLine = `verify-config errored: ${err.message}`
                    verifyOk = false
                }
            }

            // Outbox flush: retry any Discord pushes that previously failed.
            // Bounded by current outbox depth; runs before this heartbeat's
            // push so a green flush drops the warning flag in flags below.
            let outboxFlush = null
            try {
                outboxFlush = await outbox.flush(rawDiscordSend, { info: log.info })
                if (outboxFlush.sent > 0) log.info(`Outbox flush: sent ${outboxFlush.sent}, ${outboxFlush.queueDepth} still queued`)
            } catch (err) {
                log.warn(`Outbox flush errored: ${err.message}`)
            }

            // Item 3: compute anomaly flags so one glance at the heartbeat tells
            // you if it's healthy or not. Without this you'd have to read every
            // line carefully — the 06-12 race had ~13 heartbeats and we didn't
            // notice anything was off until 7am.
            const flags = []
            if (!verifyOk) flags.push('config_drift')
            if (consecutiveAllFail > 0) flags.push(`consec_fail=${consecutiveAllFail}`)
            if (checker.backoffMs > 0) flags.push(`backoff=${checker.backoffMs}ms`)
            if (discordTelemetry.consecutiveFailures >= 2) {
                flags.push(`discord_failing=${discordTelemetry.consecutiveFailures}`)
            }
            if (outbox.depth() > 0) flags.push(`outbox_depth=${outbox.depth()}`)
            const statusEmoji = flags.length === 0 ? '🟢' : '🟡'

            // Per-cell window summary. One line per (date, division) showing
            // how the API ticked across the heartbeat window. Order: dates by
            // target list, divisions HI then GP.
            const datesForWindow = config.targetDates.length
                ? [...config.targetDates].sort()
                : [...new Set([...windowStats.keys()].map(k => k.split('|')[0]))].sort()
            const windowLines = []
            for (const d of datesForWindow) {
                for (const divName of ['hi', 'gp']) {
                    const key = `${d}|${divName}`
                    const stats = windowStats.get(key)
                    const label = `${d.slice(5)} ${divName.toUpperCase()}`
                    if (!stats) {
                        windowLines.push(`\`${label}\`: no polls this window`)
                        continue
                    }
                    const total = stats.nullCount + stats.zeroCount + stats.nonZeroCount
                    const peakStr = stats.peakV > 0
                        ? `peak=${stats.peakV} at ${formatPT(stats.peakAt)} PT`
                        : 'no stock'
                    windowLines.push(
                        `\`${label}\`: ${stats.nonZeroCount}>0 / ${stats.zeroCount}=0 / ${stats.nullCount}— ` +
                        `(of ${total}) · ${stats.transitions} transitions · ${peakStr}`
                    )
                }
            }
            // Reset the window for the next heartbeat.
            windowStats.clear()

            // Would-have-fired summary: for each candidate size below the
            // current floor, how many polls in the window had enough stock.
            // Direct answer to "should I lower partyTargets?" Reset alongside.
            const wfLines = []
            for (const d of datesForWindow) {
                const wf = wouldFireStats.get(d)
                if (!wf) continue
                const cells = WOULD_FIRE_SIZES
                    .map(s => `party=${s}: ${wf.sizeCounts.get(s)}`)
                    .join(' · ')
                const peakStr = wf.peakTotal.v > 0
                    ? `peak hi+gp=${wf.peakTotal.v} at ${formatPT(wf.peakTotal.ts)} PT`
                    : 'no concurrent stock'
                wfLines.push(`\`${d.slice(5)}\`: ${cells} (${peakStr})`)
            }
            wouldFireStats.clear()

            // Fire telemetry (most windows: empty). When present, shows
            // whether reload-on-mismatch was exercised and the actual KPI.
            const fireLines = []
            if (fireTelemetry.length > 0) {
                for (const f of fireTelemetry) {
                    const reload = f.reloadOutcome ? `reload→${f.reloadOutcome}` : 'no reload'
                    const kpi = f.apiSignalToBookClickMs != null
                        ? `${f.apiSignalToBookClickMs}ms`
                        : '-'
                    fireLines.push(
                        `\`${f.fireId}\` acct${f.accountIndex} ${f.date}: ` +
                        `cart=${f.cartState ?? f.reason ?? 'unknown'} · ` +
                        `API→book=${kpi} · ${reload}`
                    )
                }
                fireTelemetry.length = 0
            }

            const msg = [
                `💓 **watch-auto heartbeat** ${statusEmoji}`,
                `**Uptime:** ${uptimeMin} min`,
                `**Polls:** ${pollCount}`,
                `**Last snapshot:** ${lastSnapshotSummary}`,
                `**API window (last ${Math.round(HEARTBEAT_MS / 60000)} min):**`,
                ...windowLines.map(l => `  ${l}`),
                `_\`—\` = rec.gov suppressed the cell from the API payload (treated as 0 for firing). Common, not an error._`,
                `**Would-have-fired (below current floor):**`,
                ...wfLines.map(l => `  ${l}`),
                ...(fireLines.length > 0
                    ? [`**Fires this window:**`, ...fireLines.map(l => `  ${l}`)]
                    : []),
                `**Consec failures:** ${consecutiveAllFail}`,
                `**Backoff:** ${checker.backoffMs}ms`,
                `**Config verify:** ${verifyLine}`,
                `**Discord push:** ${discordTelemetry.sent} sent, ${discordTelemetry.failed} failed (last status ${discordTelemetry.lastStatusCode ?? '-'})`,
                flags.length
                    ? `**Flags:** \`${flags.join(', ')}\``
                    : `Still watching — no opening yet (or last fire pending).`,
                verifyOk
                    ? ''
                    : `🚨 **VERIFY-CONFIG DRIFTED.** Run \`node permit-bot/permit-bot.mjs verify-config\` and update decision.mjs tokens BEFORE the next release.`,
            ].filter(Boolean).join('\n')
            await discordPush(msg)
            session.write('heartbeat', {
                pollCount,
                uptimeMin,
                lastSnapshotSummary,
                windowSummary: windowLines,
                wouldFireSummary: wfLines,
                fireSummary: fireLines,
                verifyOk,
                flags,
                discord: { ...discordTelemetry },
            })
        }

        if (firedThisRun) break
        const elapsed = Date.now() - tickStart
        const sleepMs = Math.max(0, pickIntervalMs(config) - elapsed) + checker.backoffMs
        await new Promise(r => setTimeout(r, sleepMs))
    }

    log.info(`watch-auto: exiting. Session log: ${session.filePath}`)
    session.write('shutdown', { pollCount, uptimeMs: Date.now() - sessionStart })
    await new Promise(r => setTimeout(r, 30_000))
    for (const w of warmers) await w.ctx.close().catch(() => {})
}

async function cmdWatch({ autoGrab = false } = {}) {
    const config = loadConfig()
    const checker = new PermitChecker({
        permitId: config.permitId,
        targets: config.targets,
        targetDates: config.targetDates,
        log,
    })

    // We only fire the cart bot once per (date, division) hit to avoid stacking
    // browser windows when the slot stays open across several polls.
    const fired = new Set()
    let grabInFlight = false

    log.info(`Watching permit ${config.permitId} for ${config.targetDates.join(', ')}`)
    log.info(`Targets: ${config.targets.map(t => t.name).join(' | ')}`)
    log.info(`Auto-grab: ${autoGrab ? 'ON' : 'OFF (notify only)'}; ntfy: ${NTFY_TOPIC_URL ? 'on' : 'off'}`)

    while (true) {
        const intervalMs = pickIntervalMs(config)
        const start = Date.now()
        try {
            const payload = await checker.pollOnce()
            const { openings } = checker.diff(payload)
            checker.resetBackoff()
            if (openings.length > 0) {
                log.info(`!! Openings (${openings.length}): ${openings.map(o => `${o.name} ${o.date} (${o.remaining})`).join(' | ')}`)
                for (const o of openings) {
                    const key = `${o.date}|${o.divisionId}`
                    if (fired.has(key)) continue
                    fired.add(key)
                    const title = `LYV OPEN: ${o.name} ${o.date}`
                    const msg = `${o.remaining}/${o.total} remaining — grab now`
                    const click = `https://www.recreation.gov/permits/${config.permitId}/registration/detailed-availability?type=overnight-permit&date=${o.date}`
                    await pushNtfy(title, msg, { click, priority: '5', tags: 'rotating_light,mountain' })
                    if (autoGrab && !grabInFlight) {
                        grabInFlight = true
                        ;(async () => {
                            try {
                                await tryGrab({
                                    permitId: config.permitId,
                                    divisionId: o.divisionId,
                                    divisionName: o.name,
                                    date: o.date,
                                    partySize: config.partySize,
                                    dryRun: false,
                                    log,
                                })
                            } finally {
                                grabInFlight = false
                            }
                        })()
                    }
                }
            } else {
                // quiet log every cycle so we can tell it's alive
                const sample = checker.lastSnapshot?.rows
                    ?.map(r => `${r.date.slice(5)}/${r.target.divisionId}=${r.remaining ?? '—'}`)
                    .join(' ')
                log.info(`poll ok | ${sample}`)
            }
        } catch (err) {
            checker.handleError(err)
        }
        const elapsed = Date.now() - start
        const sleepMs = Math.max(0, jitter(intervalMs) - elapsed) + checker.backoffMs
        await new Promise(r => setTimeout(r, sleepMs))
    }
}

const subcommand = process.argv[2]
const rest = process.argv.slice(3)
const flags = new Set(rest.filter(a => a.startsWith('--') && !a.includes('=')))
// Parse --key=value style overrides for test-cart
const kv = Object.fromEntries(
    rest.filter(a => a.startsWith('--') && a.includes('='))
        .map(a => {
            const [k, ...v] = a.slice(2).split('=')
            return [k, v.join('=')]
        })
)

;(async () => {
    try {
        const accountIndex = kv.account ? Number(kv.account) : 1
        switch (subcommand) {
            case 'login':
                await cmdLogin({ accountIndex }); break
            case 'check-session':
                await cmdCheckSession({ accountIndex }); break
            case 'probe':
                await cmdProbe(); break
            case 'verify-config':
                await cmdVerifyConfig(); break
            case 'test-cart':
                await cmdTestCart({
                    accountIndex,
                    dryRun: !flags.has('--for-real'),
                    overrides: {
                        divisionId: kv.division,
                        name: kv.name,
                        date: kv.date,
                        partySize: kv.party ? Number(kv.party) : undefined,
                    },
                }); break
            case 'watch':
                await cmdWatch({ autoGrab: flags.has('--auto-grab') }); break
            case 'watch-auto':
                await cmdWatchAuto({
                    preWarm: flags.has('--pre-warm'),
                    simulate: flags.has('--simulate'),
                    fakeHi: kv['fake-hi'] != null ? Number(kv['fake-hi']) : null,
                    fakeGp: kv['fake-gp'] != null ? Number(kv['fake-gp']) : null,
                    hiDiv: kv['hi-div'] || null,
                    hiName: kv['hi-name'] || null,
                    gpDiv: kv['gp-div'] || null,
                    gpName: kv['gp-name'] || null,
                    partyTargets: kv['party-targets']
                        ? kv['party-targets'].split(',').map(s => Number(s.trim())).filter(Number.isFinite)
                        : null,
                }); break
            case 'test-warm': {
                const accountsCsv = kv.accounts || '1,2'
                const accountIndexes = accountsCsv.split(',').map(s => Number(s.trim())).filter(Number.isFinite)
                await cmdTestWarm({
                    accountIndexes,
                    overrides: {
                        divisionId: kv.division,
                        name: kv.name,
                        date: kv.date,
                        partySize: kv.party ? Number(kv.party) : undefined,
                    },
                })
                break
            }
            case 'release-cart': {
                // Test-only helper: clear cart hold(s) for the given account(s).
                // NEVER call this from watch / production paths.
                const accountsCsv = kv.accounts || String(accountIndex)
                const accountIndexes = accountsCsv.split(',').map(s => Number(s.trim())).filter(Number.isFinite)
                for (const idx of accountIndexes) {
                    const r = await releaseCart({ accountIndex: idx, log })
                    log.info(`acct${idx}: removed=${r.removed} state=${r.state}`)
                }
                break
            }
            case 'chart': {
                // Render an SVG + HTML report of a session log's API tick
                // history, fires, and recent heartbeats. Defaults: most recent
                // session log + first targeted date + 06:50-07:35 PT window.
                // --all-sessions: also merge events from every other session
                // log in the same directory whose PT day matches this one
                // (race-day reality is multi-session after restarts).
                const sessionPath = kv.session || latestSessionLogPath()
                const { reportPath, polls } = await runChartCommand({
                    sessionPath,
                    date: kv.date,
                    fromHHMM: kv.from,
                    toHHMM: kv.to,
                    windowDay: kv['window-day'] || null,
                    allSameDay: flags.has('--all-sessions'),
                })
                log.info(`chart: rendered ${polls} polls from ${sessionPath}${flags.has('--all-sessions') ? ' (+ same-day siblings)' : ''}`)
                log.info(`chart: report at ${reportPath}`)
                console.log(reportPath)
                break
            }
            case 'benchmark': {
                const config = loadConfig()
                const ym = config.targetDates[0].slice(0, 7)
                const [yy, mm] = ym.split('-').map(Number)
                const monthStartIso = new Date(Date.UTC(yy, mm - 1, 1)).toISOString()
                const monthEndIso = new Date(Date.UTC(yy, mm, 0)).toISOString()
                await benchmarkPolling({
                    permitId: config.permitId,
                    monthStartIso,
                    monthEndIso,
                    intervalMs: Number(kv.interval ?? 2000),
                    concurrency: Number(kv.concurrency ?? 1),
                    durationSec: Number(kv.duration ?? 60),
                    log,
                })
                break
            }
            default:
                console.log(`Usage:
  node permit-bot/permit-bot.mjs login [--account=N]              # interactive rec.gov login (default account=1)
  node permit-bot/permit-bot.mjs check-session [--account=N]      # verify saved login still works
  node permit-bot/permit-bot.mjs probe                             # one-shot availability snapshot
  node permit-bot/permit-bot.mjs verify-config                     # confirm trailhead tokens still match rec.gov DOM
  node permit-bot/permit-bot.mjs watch                             # poll continuously, notify only
  node permit-bot/permit-bot.mjs watch --auto-grab                 # poll continuously, fire CartBot on hit
  node permit-bot/permit-bot.mjs test-cart [--account=N]           # dry-run cart flow (no clicks)
  node permit-bot/permit-bot.mjs test-cart --for-real [--account=N]
  node permit-bot/permit-bot.mjs benchmark --interval=2000 --duration=60 --concurrency=1
  node permit-bot/permit-bot.mjs chart [--session=<log.jsonl>] [--date=YYYY-MM-DD] [--from=HH:MM] [--to=HH:MM] [--window-day=YYYY-MM-DD] [--all-sessions]
                                                                  # render SVG+HTML report of API tick history. --all-sessions merges every
                                                                  # same-PT-day session log. --window-day pins the chart window to a
                                                                  # specific PT day (for long-running sessions spanning midnight)
`)
                process.exit(1)
        }
    } catch (err) {
        log.error(err.stack || err.message)
        process.exit(2)
    }
})()
