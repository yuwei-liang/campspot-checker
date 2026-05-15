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
const require = createRequire(import.meta.url)
const campgrounds = require('./campgrounds.json')

import Checker from './availability-checker/Checker.mjs'
import Notifier from './availability-checker/Notifier.mjs'
import { loadConfig } from './availability-checker/configLoader.mjs'
import express from 'express'

const PORT = 8080
const HOST = '0.0.0.0'

let config
try {
    config = loadConfig()
} catch (err) {
    logger.error(err.message)
    process.exit(1)
}

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
app.get('/', (req, res) => {
    res.send('Hello World');
});

app.listen(PORT, HOST, () => {
    logger.info(`Running on http://${HOST}:${PORT}`);
    logger.info(`MONTH_START=${config.monthStart}, TARGET_DATE=${config.targetDate}, POLL_INTERVAL_MS=${config.pollIntervalMs}`)

    const checker = new Checker(
        campgrounds,
        config.targetDate,
        config.webhookUrl,
        config.monthStart,
    );
    const heartbeatNotifier = new Notifier(config.webhookUrl)

    scheduleNextCheck(checker, config.pollIntervalMs)
    liveCheck(heartbeatNotifier)
});
