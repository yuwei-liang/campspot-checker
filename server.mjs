// server
import winston from 'winston'
const { printf, combine, timestamp, json } = winston.format

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
        //
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `combined.log`
        //
        new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'log/combined.log' }),
    ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console());
}

global.logger = logger;

import * as dotenv from 'dotenv'
dotenv.config()

// app
import campgrounds from './campgrounds.json' assert { type: 'json' }
import Checker from './availability-checker/Checker.mjs'
import express from 'express'
import Notifier from './availability-checker/Notifier.mjs'

const PORT = 8080
const HOST = '0.0.0.0'
const DISCORD_WEBHOOK = process.env.WEBHOOK_URL
const TARGET_DATE = "2023-05-27T00:00:00Z"

// To tell discord this server is still running
const liveCheck = (interval = 30) => {
    const notifier = new Notifier(DISCORD_WEBHOOK)
    setInterval(() => {
        var date = new Date()
        const minutes = date.getMinutes();
        if (minutes % interval == 0) {
            notifier.heartbeat()
        }
    }, 30000)
}

const executeCheck = () => {
    logger.info("Executing ...")
    const checker = new Checker(
        campgrounds,
        TARGET_DATE,
        DISCORD_WEBHOOK
    );
    checker.executeCheck()
}

const printStartMsg = () => {
    logger.info("Discord webhook url:")
    logger.info(process.env.WEBHOOK_URL)
}

// App
const app = express()
app.get('/', (req, res) => {
    res.send('Hello World');
});

app.listen(PORT, HOST, () => {
    printStartMsg()
    logger.info(`Running on http://${HOST}:${PORT}`);

    // first run
    executeCheck()

    // send heatbeats
    liveCheck()

    // repeated run
    setInterval(executeCheck, 30000)
});
