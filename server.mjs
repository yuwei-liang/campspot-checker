// logger
import winston from 'winston'
const { printf, combine, timestamp } = winston.format

const myFormat = printf((info) => {
    return `${info.timestamp} ${info.level} ${info.message}`;
})

const logger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp(),
        myFormat
    ),
    defaultMeta: { service: 'user-service' },
    transports: [
        new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'log/combined.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console());
}

global.logger = logger;

import * as dotenv from 'dotenv'
dotenv.config()

import { createRequire } from 'node:module'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
const require = createRequire(import.meta.url)
const campgroundsSeed = require('./campgrounds.json')

import Checker from './availability-checker/Checker.mjs'
import Notifier from './availability-checker/Notifier.mjs'
import { loadConfig } from './availability-checker/configLoader.mjs'
import { openDatabase, DEFAULT_DB_PATH } from './availability-checker/db/db.mjs'
import { createCampgroundsRepo } from './availability-checker/db/campgroundsRepo.mjs'
import { createCyclesRepo } from './availability-checker/db/cyclesRepo.mjs'
import { createAvailabilityRepo } from './availability-checker/db/availabilityRepo.mjs'
import { createWeatherRepo } from './availability-checker/db/weatherRepo.mjs'
import { scheduleWeatherRefresh } from './availability-checker/weatherService.mjs'
import { STATUS_PAGE_HTML } from './availability-checker/statusPage.mjs'
import express from 'express'

const PORT = Number.parseInt(process.env.PORT || '8787', 10)
const HOST = '0.0.0.0'
const LEGACY_RUNTIME_STATE_FILE = './.runtime-state.json'

let config
try {
    config = loadConfig()
} catch (err) {
    logger.error(err.message)
    process.exit(1)
}

// Open the DB, run migrations, create repos.
const db = openDatabase(process.env.DB_PATH || DEFAULT_DB_PATH)
const repos = {
    campgrounds: createCampgroundsRepo(db),
    cycles: createCyclesRepo(db),
    availability: createAvailabilityRepo(db),
    weather: createWeatherRepo(db),
}

// Seed campgrounds from campgrounds.json. upsert is INSERT-or-UPDATE on id,
// but does NOT touch the `enabled` column, so UI toggles persist.
repos.campgrounds.upsertMany(campgroundsSeed)
logger.info(`DB ready: ${repos.campgrounds.count()} campgrounds`)

// One-time migration of any legacy .runtime-state.json into the DB.
if (existsSync(LEGACY_RUNTIME_STATE_FILE)) {
    try {
        const legacy = JSON.parse(readFileSync(LEGACY_RUNTIME_STATE_FILE, 'utf-8'))
        const ids = Array.isArray(legacy.disabledIds) ? legacy.disabledIds : []
        for (const id of ids) repos.campgrounds.setEnabled(id, false)
        unlinkSync(LEGACY_RUNTIME_STATE_FILE)
        logger.info(`Migrated ${ids.length} disabled id(s) from .runtime-state.json into DB`)
    } catch (err) {
        logger.error(`failed to migrate legacy runtime state: ${err.message}`)
    }
}

const checker = new Checker(
    repos,
    config.targetDates,
    config.webhookUrl,
    config.monthStarts,
)
const heartbeatNotifier = new Notifier(config.webhookUrl)

const liveCheck = (notifier, intervalMinutes = 30) => {
    setInterval(() => {
        const minutes = new Date().getMinutes();
        if (minutes % intervalMinutes === 0) {
            notifier.heartbeat()
        }
    }, 60 * 1000)
}

const jitter = () => Math.floor(Math.random() * 10_000)

const scheduleNextCheck = (checker, baseIntervalMs) => {
    const backoff = checker.getBackoffMs()
    const delay = backoff > 0
        ? backoff + jitter()
        : baseIntervalMs + jitter()

    if (backoff > 0) {
        logger.info(`Backing off for ${delay}ms before next cycle`)
    }

    setTimeout(async () => {
        logger.info("Executing ...")
        try {
            await checker.executeCheck()
        } catch (err) {
            logger.error(`executeCheck threw: ${err.message}`)
        }
        scheduleNextCheck(checker, baseIntervalMs)
    }, delay)
}

const app = express()
app.use(express.json())
app.get('/', (req, res) => {
    res.type('html').send(STATUS_PAGE_HTML);
});
app.get('/api/status', (req, res) => {
    res.json({
        ...checker.getStatus(),
        pollIntervalMs: config.pollIntervalMs,
        serverTime: new Date().toISOString(),
    });
});
app.get('/api/history', (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 500)
    const cgId = req.query.campground_id ? Number(req.query.campground_id) : null
    const events = cgId
        ? repos.availability.recentEventsForCampground(cgId, limit)
        : repos.availability.recentEvents(limit)
    res.json({ events, cycles: repos.cycles.recent(20) })
});
app.post('/api/poll', (req, res) => {
    if (checker.cycleState.currentlyRunning) {
        return res.status(409).json({ ok: false, reason: 'already_running' });
    }
    logger.info('Manual poll triggered via /api/poll');
    checker.executeCheck().catch(err => logger.error(`manual poll: ${err.message}`));
    res.status(202).json({ ok: true, startedAt: new Date().toISOString() });
});
app.post('/api/campgrounds/:id/enabled', (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
        return res.status(400).json({ ok: false, reason: 'id must be a number' })
    }
    const { enabled } = req.body || {}
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ ok: false, reason: 'body.enabled must be a boolean' })
    }
    if (!repos.campgrounds.byId(id)) {
        return res.status(404).json({ ok: false, reason: 'unknown campground id' })
    }
    const newState = checker.setEnabled(id, enabled)
    logger.info(`Campground ${id} ${newState ? 'enabled' : 'disabled'}`)
    res.json({ ok: true, id, enabled: newState })
});

app.listen(PORT, HOST, async () => {
    logger.info(`Running on http://${HOST}:${PORT}`);
    logger.info(`MONTHS=${config.monthStarts.length} (starting ${config.monthStarts[0]}), TARGET_DATES=${config.targetDates.length} dates, POLL_INTERVAL_MS=${config.pollIntervalMs}`)
    checker.executeCheck().catch(err => logger.error(`initial executeCheck: ${err.message}`))
    scheduleNextCheck(checker, config.pollIntervalMs)
    liveCheck(heartbeatNotifier)
    scheduleWeatherRefresh({
        repos,
        getCampgrounds: () => repos.campgrounds.all(),
        getTargetDates: () => config.targetDates,
        log: logger,
    })
});
