import axios from 'axios'
import _ from 'lodash'
import Campground from './Campground.mjs'
import Notifier from './Notifier.mjs'
import { weekdayLabel } from './configLoader.mjs'

// Deny-list of statuses that mean "do not alert." "Closed" was added 2026-05-15
// after a smoke check found Upper Pines / Lower Pines returning it for off-season
// dates — without it, every poll would spam Discord with false-positive openings.
const UNAVAILABLE_STATUSES = [
    "Reserved", "Not Available", undefined, "Not Reservable Management",
    "NYR", "Closed"
]

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const INTER_CAMPGROUND_SLEEP_MS = 2000
const INTER_MONTH_SLEEP_MS = 500
const MAX_BACKOFF_MS = 10 * 60 * 1000

class Checker {
    excludedSites = []
    campgrounds
    backoffMs = 0
    lastErrorReason = null

    constructor(campgrounds, targetDates, discordWebhookURL, monthStarts) {
        if (!Array.isArray(monthStarts) || monthStarts.length === 0) {
            throw new Error('Checker: monthStarts must be a non-empty array')
        }
        if (!Array.isArray(targetDates) || targetDates.length === 0) {
            throw new Error('Checker: targetDates must be a non-empty array')
        }
        this.targetDates = targetDates
        this.monthStarts = monthStarts
        this.notifier = new Notifier(discordWebhookURL)
        this.campgrounds = campgrounds

        this.cycleState = {
            lastStartedAt: null,
            lastFinishedAt: null,
            currentlyRunning: false,
            cycleCount: 0,
        }
        this.campgroundState = new Map()
        for (const cg of campgrounds) {
            this.campgroundState.set(cg.id, {
                id: cg.id,
                name: cg.name,
                park: cg.park || '',
                meta: {
                    valleyDriveMinutes: cg.valleyDriveMinutes ?? null,
                    elevationFt: cg.elevationFt ?? null,
                    season: cg.season ?? null,
                    totalSites: cg.totalSites ?? null,
                    accessType: cg.accessType ?? null,
                },
                lastPolledAt: null,
                status: 'pending',
                availableByDate: {},
                availableSites: [],
                error: null,
            })
        }
    }

    async executeCheck() {
        if (this.cycleState.currentlyRunning) {
            return { ran: false, reason: 'already_running' }
        }
        this.cycleState.currentlyRunning = true
        this.cycleState.lastStartedAt = new Date().toISOString()
        try {
            for (const campground of this.campgrounds) {
                await this.__sleep(INTER_CAMPGROUND_SLEEP_MS)
                await this.checkCampground(campground)
            }
        } finally {
            this.cycleState.lastFinishedAt = new Date().toISOString()
            this.cycleState.currentlyRunning = false
            this.cycleState.cycleCount += 1
        }
        logger.info("Done!")
        return { ran: true }
    }

    getBackoffMs() {
        return this.backoffMs
    }

    getStatus() {
        return {
            targetDates: this.targetDates,
            monthStarts: this.monthStarts,
            backoffMs: this.backoffMs,
            lastErrorReason: this.lastErrorReason,
            cycle: { ...this.cycleState },
            campgrounds: this.campgrounds.map(cg => this.campgroundState.get(cg.id)),
        }
    }

    __sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Merge the campsites payload from one month into the running combined
     * payload. Same campsite_id key across months yields one entry whose
     * `availabilities` map is the union of both months.
     */
    __mergeCampsites(combined, monthCampsites) {
        for (const [key, siteData] of Object.entries(monthCampsites || {})) {
            if (combined[key]) {
                combined[key].availabilities = {
                    ...combined[key].availabilities,
                    ...siteData.availabilities,
                }
            } else {
                combined[key] = { ...siteData }
            }
        }
    }

    /**
     * For each site in the (possibly multi-month-merged) API response, return
     * the set of target dates on which it is available, plus static site
     * detail (loop, campsite_type, max_num_people).
     */
    __getSiteAvailabilities = (json) => {
        const sites = json.campsites;
        return _.map(sites, (siteData) => {
            const availableDates = this.targetDates.filter((date) => {
                const status = _.get(siteData.availabilities, date)
                return !_.includes(UNAVAILABLE_STATUSES, status)
            })
            return {
                siteNO: siteData.site,
                campsiteId: siteData.campsite_id,
                loop: siteData.loop || null,
                campsiteType: siteData.campsite_type || null,
                maxPeople: siteData.max_num_people ?? null,
                availableDates,
            }
        })
    }

    /**
     * Pure formatter: takes a campground + a list of {site, availableDates}
     * records and produces a Discord-friendly message with booking links,
     * grouped by date so the reader can see which night opens up.
     */
    formatAvailabilityMessage(campground, availableSites) {
        const header = `${campground.toString()} ${availableSites.length} site(s) available`
        const bookingLink = `Book: ${campground.getBookingUrl()}`

        const byDate = new Map()
        for (const site of availableSites) {
            for (const date of site.availableDates) {
                if (!byDate.has(date)) byDate.set(date, [])
                byDate.get(date).push(site)
            }
        }

        const sections = [...byDate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, sites]) => {
                const datePart = date.slice(0, 10)
                const lines = [`${weekdayLabel(date)} ${datePart} (${sites.length}):`]
                for (const s of sites) {
                    const url = Campground.getCampsiteUrl(s.campsiteId)
                    const detail = [s.loop, s.campsiteType, s.maxPeople ? `max ${s.maxPeople}` : null]
                        .filter(Boolean).join(', ')
                    const detailPart = detail ? ` (${detail})` : ''
                    lines.push(`- Site ${s.siteNO}${detailPart}: ${url}`)
                }
                return lines.join('\n')
            })

        return [header, bookingLink, '', ...sections].join('\n')
    }

    report = (campground, res, options = { excludedSites: [] }) => {
        const allSites = this.__getSiteAvailabilities(res.data)
        const excludedSites = options.excludedSites
        const availableSites = allSites
            .filter((s) => s.availableDates.length > 0)
            .filter((s) => !_.includes(excludedSites, s.siteNO))

        const availableByDate = {}
        for (const date of this.targetDates) {
            availableByDate[date] = availableSites.filter(s => s.availableDates.includes(date)).length
        }

        const state = this.campgroundState.get(campground.id)
        state.lastPolledAt = new Date().toISOString()
        state.availableByDate = availableByDate
        state.availableSites = availableSites.map(s => ({
            siteNO: s.siteNO,
            campsiteId: s.campsiteId,
            url: Campground.getCampsiteUrl(s.campsiteId),
            loop: s.loop,
            campsiteType: s.campsiteType,
            maxPeople: s.maxPeople,
            availableDates: s.availableDates,
        }))
        state.error = null

        if (availableSites.length > 0) {
            state.status = 'available'
            const message = this.formatAvailabilityMessage(campground, state.availableSites)
            logger.info(message)
            this.notifier.notify(message)
        } else {
            state.status = 'all_reserved'
            logger.info(`${campground.toString()} ALL RESERVED across ${this.targetDates.length} date(s)`)
        }
    }

    __createCampground(campgroundJson) {
        const { name, id, park } = campgroundJson
        return new Campground(name, id, park)
    }

    __handleError(err, campground) {
        const status = err.response?.status
        const retryAfterRaw = err.response?.headers?.['retry-after']

        let nextBackoff
        if (retryAfterRaw) {
            const retryAfterSec = Number.parseInt(retryAfterRaw, 10)
            nextBackoff = Number.isFinite(retryAfterSec)
                ? retryAfterSec * 1000
                : Math.min((this.backoffMs || 1000) * 2, MAX_BACKOFF_MS)
            this.lastErrorReason = `Retry-After:${retryAfterRaw}`
        } else if (status === 429 || (status >= 500 && status < 600)) {
            nextBackoff = Math.min((this.backoffMs || 1000) * 2, MAX_BACKOFF_MS)
            this.lastErrorReason = `HTTP ${status}`
        } else if (
            err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ECONNABORTED'
        ) {
            nextBackoff = Math.min((this.backoffMs || 1000) * 2, MAX_BACKOFF_MS)
            this.lastErrorReason = `Network ${err.code}`
        } else {
            nextBackoff = this.backoffMs
            this.lastErrorReason = err.message
        }

        this.backoffMs = nextBackoff

        const state = this.campgroundState.get(campground.id)
        if (state) {
            state.lastPolledAt = new Date().toISOString()
            state.status = 'error'
            state.error = this.lastErrorReason
        }

        logger.error(
            `Error checking ${campground.toString()}: ${this.lastErrorReason}. ` +
            `Next backoff: ${this.backoffMs}ms`
        )
    }

    __resetBackoff() {
        if (this.backoffMs > 0) {
            logger.info(`Recovered from backoff (was ${this.backoffMs}ms)`)
        }
        this.backoffMs = 0
        this.lastErrorReason = null
    }

    async checkCampground(campgroundJson) {
        const campground = this.__createCampground(campgroundJson)
        const combined = {}

        try {
            for (let i = 0; i < this.monthStarts.length; i++) {
                if (i > 0) await this.__sleep(INTER_MONTH_SLEEP_MS)
                const monthStart = this.monthStarts[i]
                const url = campground.getAvailabilityUrl(monthStart)
                const res = await axios.get(url, {
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 15000,
                })
                this.__mergeCampsites(combined, res.data?.campsites)
            }
            this.report(campground, { data: { campsites: combined } }, { excludedSites: this.excludedSites })
            this.__resetBackoff()
        } catch (err) {
            this.__handleError(err, campground)
        }
    }
}

export default Checker;
