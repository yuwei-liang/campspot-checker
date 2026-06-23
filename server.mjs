// Dashboard server.
//
// Hosts /bots (HTML) and /api/bots (JSON aggregator) for the active bots
// (permit-bot, campspot-bot). No longer runs the legacy pitchwatch
// campground checker — campspot-bot's auto-cart loop has replaced it for
// the Upper Pines use case. The legacy modules + DB / weather code remain
// in the tree but are not wired into this process.
import winston from 'winston'
const { printf, combine, timestamp } = winston.format

const myFormat = printf((info) => `${info.timestamp} ${info.level} ${info.message}`)
const logger = winston.createLogger({
    level: 'info',
    format: combine(timestamp(), myFormat),
    defaultMeta: { service: 'dashboard' },
    transports: [
        new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'log/combined.log' }),
    ],
})
if (process.env.NODE_ENV !== 'production') logger.add(new winston.transports.Console())
global.logger = logger

import * as dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { DASHBOARD_PAGE_HTML } from './dashboard/dashboardPage.mjs'
import { buildDashboardData } from './dashboard/dashboardData.mjs'

const PORT = Number.parseInt(process.env.PORT || '8787', 10)
const HOST = '0.0.0.0'

const app = express()
app.use(express.json())
app.use(express.static('public'))

// Default route -> dashboard. Pitchwatch's status page is no longer wired
// up; if someone has it bookmarked they land on the dashboard instead.
app.get('/', (req, res) => res.redirect('/bots'))

app.get('/bots', (req, res) => {
    res.type('html').send(DASHBOARD_PAGE_HTML)
})
app.get('/api/bots', (req, res) => {
    try {
        res.json(buildDashboardData())
    } catch (err) {
        logger.error(`buildDashboardData: ${err.message}`)
        res.status(500).json({ error: err.message })
    }
})

app.listen(PORT, HOST, () => {
    logger.info(`Dashboard on http://${HOST}:${PORT}/bots`)
})
