#!/usr/bin/env node
import * as dotenv from 'dotenv'
dotenv.config()

import { readFileSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import FormData from 'form-data'

import CampspotChecker from './CampspotChecker.mjs'
import { tryGrabCampsite, releaseCampspotCart } from './CampspotCartBot.mjs'
import { httpsAgent } from '../permit-bot/dnsBypass.mjs'
import { writeBotState, appendEvent } from '../dashboard/botState.mjs'

const STATE_FILE = path.resolve('./campspot-bot/state/status.json')

const log = {
    info: (msg) => console.log(`[${new Date().toISOString()}] ${msg}`),
    warn: (msg) => console.warn(`[${new Date().toISOString()}] WARN ${msg}`),
    error: (msg) => console.error(`[${new Date().toISOString()}] ERR  ${msg}`),
}

// Routing: a campspot-specific Discord webhook keeps these alerts from
// drowning out the legacy campsite-checker and permit-bot channels. Falls back
// to the campspot-checker webhook, then nothing.
const DISCORD_WEBHOOK_URL = process.env.CAMPSPOT_DISCORD_WEBHOOK_URL
    || process.env.WEBHOOK_URL
    || null
const NTFY_TOPIC_URL = process.env.NTFY_TOPIC_URL || null

function loadConfig() {
    const p = path.resolve('./campspot-bot/config.json')
    return JSON.parse(readFileSync(p, 'utf-8'))
}

async function discordPush(text, screenshotPath = null) {
    if (!DISCORD_WEBHOOK_URL) {
        log.warn('No CAMPSPOT_DISCORD_WEBHOOK_URL / WEBHOOK_URL in .env — skipping Discord push.')
        return { ok: false, status: 0 }
    }
    try {
        if (screenshotPath) {
            const form = new FormData()
            form.append('payload_json', JSON.stringify({ content: text }), { contentType: 'application/json' })
            form.append('file1', createReadStream(screenshotPath), {
                filename: path.basename(screenshotPath),
                contentType: 'image/png',
            })
            const res = await axios.post(DISCORD_WEBHOOK_URL, form, {
                timeout: 20000,
                httpsAgent,
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            })
            return { ok: true, status: res.status }
        }
        const res = await axios.post(DISCORD_WEBHOOK_URL, { content: text }, { timeout: 10000, httpsAgent })
        return { ok: true, status: res.status }
    } catch (err) {
        log.warn(`Discord push failed: ${err.message}`)
        return { ok: false, status: err.response?.status ?? 0, error: err.message }
    }
}

async function pushNtfy(title, message, opts = {}) {
    if (!NTFY_TOPIC_URL) return
    try {
        const headers = {
            'Title': title.replace(/[\r\n]+/g, ' ').slice(0, 250),
            'Priority': opts.priority || '5',
            'Tags': opts.tags || 'tent,mountain',
        }
        if (opts.click) headers['Click'] = opts.click
        if (opts.actions?.length) {
            headers['Actions'] = opts.actions.map(a =>
                `view, ${a.label}, ${a.url}, clear=true`
            ).join('; ')
        }
        await axios.post(NTFY_TOPIC_URL, message, { headers, timeout: 5000, httpsAgent })
    } catch (err) {
        log.warn(`ntfy push failed: ${err.message}`)
    }
}

function fmtStay(s) {
    const range = `${s.startDate} → ${s.endDate} (${s.nights}n)`
    const meta = [s.loop, s.campsiteType, s.maxPeople ? `max ${s.maxPeople}` : null].filter(Boolean).join(' · ')
    return `Site ${s.siteNo || s.campsiteId}: ${range}${meta ? `  [${meta}]` : ''}`
}

function bookingUrl(campgroundId, s) {
    return `https://www.recreation.gov/camping/campgrounds/${campgroundId}?startdate=${s.startDate}&enddate=${s.endDate}`
}

async function cmdCheck() {
    const config = loadConfig()
    const checker = new CampspotChecker({
        campgroundId: config.campgroundId,
        rangeStartDate: config.rangeStartDate,
        rangeEndDate: config.rangeEndDate,
        targetWeekdays: config.targetWeekdays,
        maxNights: config.maxNights,
        minNights: config.minNights,
        minPeople: config.minPeople,
        log,
    })
    log.info(`check: cg=${config.campgroundId} window=${config.rangeStartDate}..${config.rangeEndDate} weekdays=${config.targetWeekdays.join(',')} nights=${config.minNights}-${config.maxNights} minPeople=${config.minPeople}`)
    const payload = await checker.pollOnce()
    const { snapshot } = checker.diff(payload)
    log.info(`Scanned ${snapshot.campsiteCount} campsites, found ${snapshot.stays.length} qualifying stays.`)
    for (const s of snapshot.stays.slice(0, 50)) {
        console.log('  ' + fmtStay(s))
    }
    if (snapshot.stays.length === 0) {
        console.log('  (no qualifying availability — campground fully booked across the window)')
    }
}

async function cmdCart({ overrides = {}, dryRun = true, accountIndex = 1 } = {}) {
    const config = loadConfig()
    if (!overrides.siteNo || !overrides.startDate || !overrides.endDate) {
        console.error('Usage: cart --site=068 --start=2026-06-22 --end=2026-06-23 [--for-real] [--account=N]')
        process.exit(2)
    }
    log.info(`cart: site=${overrides.siteNo} ${overrides.startDate}→${overrides.endDate} dryRun=${dryRun} account=${accountIndex}`)
    const result = await tryGrabCampsite({
        campgroundId: config.campgroundId,
        campsiteId: overrides.campsiteId || null,
        siteNo: overrides.siteNo,
        startDate: overrides.startDate,
        endDate: overrides.endDate,
        dryRun,
        accountIndex,
        log,
    })
    log.info(`Result: ${JSON.stringify({ ok: result.ok, reason: result.reason, cartState: result.cartState })}`)
    if (!dryRun && result.ok) {
        const lines = [
            result.cartState === 'held' ? '✅ **CAMPSPOT CART HOLD CONFIRMED**' :
            result.cartState === 'empty' ? '⚠️ Add to Cart clicked, but cart is EMPTY' :
            '⚠️ Add to Cart clicked — cart state unclear, see screenshot',
            `**Campground:** ${config.campgroundName} (${config.campgroundId})`,
            `**Site:** ${overrides.siteNo}`,
            `**Dates:** ${overrides.startDate} → ${overrides.endDate}`,
            `**Cart state:** ${result.cartState}`,
            `**Action needed:** open https://www.recreation.gov/cart and complete checkout within 15 min (or Remove if this was a test).`,
        ]
        await discordPush(lines.join('\n'), result.cartShot || result.postClickShot)
    }
    if (result.ctx) {
        await new Promise(r => setTimeout(r, 30_000))
        await result.ctx.close().catch(() => {})
    }
}

async function cmdRelease({ accountIndex = 1 } = {}) {
    const r = await releaseCampspotCart({ accountIndex, log })
    log.info(`removed=${r.removed} state=${r.state}`)
}

// watch: poll continuously, notify on new openings. With --auto-grab, fires
// CampspotCartBot on the highest-ranked new stay (sequentially — one cart at
// a time so we don't trigger captchas).
async function cmdWatch({ autoGrab = false, accountIndex = 1 } = {}) {
    const config = loadConfig()
    const checker = new CampspotChecker({
        campgroundId: config.campgroundId,
        rangeStartDate: config.rangeStartDate,
        rangeEndDate: config.rangeEndDate,
        targetWeekdays: config.targetWeekdays,
        maxNights: config.maxNights,
        minNights: config.minNights,
        minPeople: config.minPeople,
        log,
    })
    log.info(`watch: cg=${config.campgroundId} window=${config.rangeStartDate}..${config.rangeEndDate} ` +
        `weekdays=${config.targetWeekdays.join(',')} nights=${config.minNights}-${config.maxNights} ` +
        `minPeople=${config.minPeople} poll=${config.pollIntervalMs}ms autoGrab=${autoGrab}`)

    let cycle = 0
    let cartInFlight = false
    const recentlyAttempted = new Map() // key -> ts

    // Dashboard state. Cumulative counters + a bounded ring buffer of recent
    // events. Atomic-rename via writeBotState so the dashboard never observes
    // a half-written JSON file.
    const startedAtIso = new Date().toISOString()
    const dashState = {
        bot: 'campspot-bot',
        pid: process.pid,
        startedAt: startedAtIso,
        lastHeartbeat: startedAtIso,
        mode: autoGrab ? 'watch --auto-grab' : 'watch',
        config: {
            campgroundId: config.campgroundId,
            campgroundName: config.campgroundName,
            window: `${config.rangeStartDate} → ${config.rangeEndDate}`,
            weekdays: config.targetWeekdays,
            nights: `${config.minNights}-${config.maxNights}`,
            minPeople: config.minPeople,
            pollIntervalMs: config.pollIntervalMs,
            autoGrab,
        },
        metrics: {
            cycles: 0,
            totalStaysSeen: 0,
            newStaysDetected: 0,
            cartAttempts: 0,
            cartHolds: 0,
            errors: 0,
            backoffMs: 0,
        },
        lastSnapshot: null,
        recentEvents: [],
    }
    const persistState = () => {
        dashState.lastHeartbeat = new Date().toISOString()
        dashState.metrics.backoffMs = checker.backoffMs
        try { writeBotState(STATE_FILE, dashState) } catch (err) {
            log.warn(`state write failed: ${err.message}`)
        }
    }
    appendEvent(dashState, { type: 'startup', mode: dashState.mode })
    persistState()

    // Startup ping.
    await discordPush([
        '🟢 **campspot-bot watch started**',
        `**Campground:** ${config.campgroundName} (${config.campgroundId})`,
        `**Window:** ${config.rangeStartDate} → ${config.rangeEndDate}`,
        `**Weekdays:** ${config.targetWeekdays.join(', ')} · **Nights:** ${config.minNights}–${config.maxNights}`,
        `**Min capacity:** ${config.minPeople || 'any'} people`,
        `**Poll:** ${config.pollIntervalMs}ms · **Auto-cart:** ${autoGrab ? 'ON' : 'off'}`,
    ].join('\n'))

    while (true) {
        cycle++
        const t0 = Date.now()
        try {
            const payload = await checker.pollOnce()
            const { snapshot, newStays } = checker.diff(payload)
            checker.resetBackoff()
            log.info(`cycle ${cycle}: ${snapshot.stays.length} stays (${newStays.length} new)`)

            dashState.metrics.cycles = cycle
            dashState.metrics.totalStaysSeen = snapshot.stays.length
            dashState.metrics.newStaysDetected += newStays.length
            dashState.lastSnapshot = {
                fetchedAt: snapshot.fetchedAt,
                campsiteCount: snapshot.campsiteCount,
                stays: snapshot.stays.slice(0, 12), // cap so the state file doesn't bloat
            }

            if (newStays.length > 0) {
                for (const s of newStays.slice(0, 5)) {
                    appendEvent(dashState, {
                        type: 'new_stay',
                        siteNo: s.siteNo,
                        startDate: s.startDate,
                        endDate: s.endDate,
                        nights: s.nights,
                        campsiteType: s.campsiteType,
                        maxPeople: s.maxPeople,
                    })
                }
                const header = `🏕️ **${newStays.length} new ${config.campgroundName} opening(s)**`
                const body = newStays.slice(0, 10).map(s => {
                    const url = bookingUrl(config.campgroundId, s)
                    return `• ${fmtStay(s)} — ${url}`
                }).join('\n')
                await discordPush(`${header}\n${body}`)

                const best = newStays[0]
                await pushNtfy(
                    `Upper Pines: ${best.nights}n on ${best.startDate}`,
                    `Site ${best.siteNo} — ${best.startDate} → ${best.endDate}`,
                    {
                        click: bookingUrl(config.campgroundId, best),
                        priority: '5',
                        tags: 'tent,rotating_light',
                    },
                )

                if (autoGrab && !cartInFlight) {
                    // Take the best new stay we haven't tried in the last hour.
                    const ONE_HOUR = 60 * 60 * 1000
                    const candidate = newStays.find(s => {
                        const key = `${s.campsiteId}|${s.startDate}|${s.endDate}`
                        const last = recentlyAttempted.get(key) || 0
                        return Date.now() - last > ONE_HOUR
                    })
                    if (candidate) {
                        cartInFlight = true
                        dashState.metrics.cartAttempts += 1
                        const key = `${candidate.campsiteId}|${candidate.startDate}|${candidate.endDate}`
                        recentlyAttempted.set(key, Date.now())
                        ;(async () => {
                            try {
                                log.info(`auto-grab: ${fmtStay(candidate)}`)
                                const r = await tryGrabCampsite({
                                    campgroundId: config.campgroundId,
                                    campsiteId: candidate.campsiteId,
                                    siteNo: candidate.siteNo,
                                    startDate: candidate.startDate,
                                    endDate: candidate.endDate,
                                    dryRun: false,
                                    accountIndex,
                                    log,
                                })
                                if (r.cartState === 'held') dashState.metrics.cartHolds += 1
                                appendEvent(dashState, {
                                    type: 'cart_attempt',
                                    siteNo: candidate.siteNo,
                                    startDate: candidate.startDate,
                                    endDate: candidate.endDate,
                                    nights: candidate.nights,
                                    result: r.cartState ?? r.reason ?? 'unknown',
                                    observed: r.observed || null,
                                })
                                persistState()
                                const status = r.cartState === 'held'
                                    ? '✅ **CART HOLD CONFIRMED** — go check out!'
                                    : r.cartState === 'wrong_trip'
                                        ? `⚠️ **WRONG TRIP** — rec.gov gave us check-out ${r.observed?.checkOut} (wanted ${candidate.endDate}). Hold auto-released.`
                                        : `⚠️ auto-grab finished — cart state: ${r.cartState ?? r.reason ?? 'unknown'}`
                                await discordPush([
                                    status,
                                    `**Site ${candidate.siteNo}** — ${candidate.startDate} → ${candidate.endDate} (${candidate.nights}n)`,
                                    `**Cart:** https://www.recreation.gov/cart`,
                                    `**Booking link:** ${bookingUrl(config.campgroundId, candidate)}`,
                                ].join('\n'), r.cartShot || r.postClickShot)
                                // Louder phone notification ONLY on a real hold — Discord
                                // pushes can lag 5-15s on mobile, ntfy delivers in ~1s.
                                if (r.cartState === 'held') {
                                    await pushNtfy(
                                        `HOLD: ${config.campgroundName} site ${candidate.siteNo}`,
                                        `${candidate.startDate} → ${candidate.endDate} (${candidate.nights}n) — check out within 15 min!`,
                                        {
                                            click: 'https://www.recreation.gov/cart',
                                            priority: 'max',
                                            tags: 'tent,white_check_mark,rotating_light',
                                        },
                                    )
                                }
                                if (r.ctx) {
                                    await new Promise(rr => setTimeout(rr, 30_000))
                                    await r.ctx.close().catch(() => {})
                                }
                            } catch (err) {
                                log.error(`auto-grab error: ${err.stack || err.message}`)
                                appendEvent(dashState, { type: 'cart_attempt', result: 'error', error: err.message })
                                persistState()
                                await discordPush(`❌ auto-grab error: ${err.message}`)
                            } finally {
                                cartInFlight = false
                            }
                        })()
                    }
                }
            }
        } catch (err) {
            checker.handleError(err)
            dashState.metrics.errors += 1
            appendEvent(dashState, { type: 'poll_error', error: err.message, backoffMs: checker.backoffMs })
        }
        persistState()
        const elapsed = Date.now() - t0
        const sleepMs = Math.max(0, config.pollIntervalMs - elapsed) + checker.backoffMs
        await new Promise(r => setTimeout(r, sleepMs))
    }
}

const subcommand = process.argv[2]
const rest = process.argv.slice(3)
const flags = new Set(rest.filter(a => a.startsWith('--') && !a.includes('=')))
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
            case 'check':
                await cmdCheck(); break
            case 'cart':
                await cmdCart({
                    accountIndex,
                    dryRun: !flags.has('--for-real'),
                    overrides: {
                        siteNo: kv.site,
                        campsiteId: kv.campsite,
                        startDate: kv.start,
                        endDate: kv.end,
                    },
                }); break
            case 'release-cart':
                await cmdRelease({ accountIndex }); break
            case 'watch':
                await cmdWatch({ autoGrab: flags.has('--auto-grab'), accountIndex }); break
            default:
                console.log(`Usage:
  node campspot-bot/campspot-bot.mjs check                                  # one-shot availability scan
  node campspot-bot/campspot-bot.mjs cart --site=068 --start=YYYY-MM-DD --end=YYYY-MM-DD [--for-real] [--account=N]
                                                                            # dry-run by default; --for-real adds to cart
  node campspot-bot/campspot-bot.mjs release-cart [--account=N]             # clear holds (test cleanup)
  node campspot-bot/campspot-bot.mjs watch [--auto-grab] [--account=N]      # poll continuously, notify; --auto-grab fires the cart bot

Edit campspot-bot/config.json for campgroundId / weekday filter / window.
Re-uses the permit-bot rec.gov session — run \`node permit-bot/permit-bot.mjs login\` first.
`)
                process.exit(1)
        }
    } catch (err) {
        log.error(err.stack || err.message)
        process.exit(2)
    }
})()
