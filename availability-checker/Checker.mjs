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
    backoffMs = 0
    lastErrorReason = null

    /**
     * @param {object} repos { campgrounds, cycles, availability }
     */
    constructor(repos, targetDates, discordWebhookURL, monthStarts) {
        if (!Array.isArray(monthStarts) || monthStarts.length === 0) {
            throw new Error('Checker: monthStarts must be a non-empty array')
        }
        if (!Array.isArray(targetDates) || targetDates.length === 0) {
            throw new Error('Checker: targetDates must be a non-empty array')
        }
        this.repos = repos
        this.targetDates = targetDates
        this.monthStarts = monthStarts
        this.notifier = new Notifier(discordWebhookURL)

        this.cycleState = {
            lastStartedAt: null,
            lastFinishedAt: null,
            currentlyRunning: false,
            cycleCount: 0,
        }
        this.campgroundState = new Map()
        this.__refreshCampgroundsFromDb()
    }

    /** Load the campground list from the DB and rebuild the in-memory state map,
     *  preserving any prior runtime-only fields (lastPolledAt, status, etc.). */
    __refreshCampgroundsFromDb() {
        this.campgrounds = this.repos.campgrounds.all()
        for (const cg of this.campgrounds) {
            if (!this.campgroundState.has(cg.id)) {
                this.campgroundState.set(cg.id, {
                    lastPolledAt: null,
                    status: 'pending',
                    availableByDate: {},
                    availableSites: [],
                    error: null,
                })
            }
        }
        // Prune state entries for campgrounds no longer in the DB.
        const ids = new Set(this.campgrounds.map(c => c.id))
        for (const id of [...this.campgroundState.keys()]) {
            if (!ids.has(id)) this.campgroundState.delete(id)
        }
    }

    async executeCheck() {
        if (this.cycleState.currentlyRunning) {
            return { ran: false, reason: 'already_running' }
        }
        this.cycleState.currentlyRunning = true
        const startedAtIso = new Date().toISOString()
        this.cycleState.lastStartedAt = startedAtIso
        const cycleId = this.repos.cycles.start(startedAtIso)
        let polledCount = 0
        const startMs = Date.now()
        try {
            this.__refreshCampgroundsFromDb()  // pick up enable/disable changes between cycles
            for (const campground of this.campgrounds) {
                if (!campground.enabled) continue
                await this.__sleep(INTER_CAMPGROUND_SLEEP_MS)
                await this.checkCampground(campground, cycleId)
                polledCount += 1
            }
        } finally {
            const finishedAtIso = new Date().toISOString()
            const duration = Date.now() - startMs
            this.repos.cycles.finish(cycleId, finishedAtIso, duration, polledCount)
            this.cycleState.lastFinishedAt = finishedAtIso
            this.cycleState.currentlyRunning = false
            this.cycleState.cycleCount += 1
        }
        logger.info(`Done! (cycle ${cycleId}, polled ${polledCount})`)
        return { ran: true, cycleId, polledCount }
    }

    getBackoffMs() {
        return this.backoffMs
    }

    isEnabled(id) {
        const row = this.repos.campgrounds.byId(id)
        return row ? row.enabled : false
    }

    setEnabled(id, enabled) {
        this.repos.campgrounds.setEnabled(id, enabled)
        this.__refreshCampgroundsFromDb()
        return this.isEnabled(id)
    }

    getStatus() {
        this.__refreshCampgroundsFromDb()
        return {
            targetDates: this.targetDates,
            monthStarts: this.monthStarts,
            backoffMs: this.backoffMs,
            lastErrorReason: this.lastErrorReason,
            cycle: { ...this.cycleState },
            campgrounds: this.campgrounds.map(cg => {
                const s = this.campgroundState.get(cg.id) || {}
                return {
                    id: cg.id,
                    name: cg.name,
                    park: cg.park,
                    enabled: cg.enabled,
                    meta: {
                        valleyDriveMinutes: cg.valleyDriveMinutes ?? null,
                        elevationFt: cg.elevationFt ?? null,
                        season: cg.season ?? null,
                        totalSites: cg.totalSites ?? null,
                        accessType: cg.accessType ?? null,
                    },
                    lastPolledAt: s.lastPolledAt ?? null,
                    status: s.status ?? 'pending',
                    availableByDate: s.availableByDate ?? {},
                    availableSites: s.availableSites ?? [],
                    error: s.error ?? null,
                }
            }),
        }
    }

    __sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

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

    formatNewlyOpenedMessage(campground, newlyOpened) {
        const header = `${campground.toString()} ${newlyOpened.length} new site(s) opened`
        const bookingLink = `Book: ${campground.getBookingUrl()}`

        const byDate = new Map()
        for (const n of newlyOpened) {
            if (!byDate.has(n.targetDate)) byDate.set(n.targetDate, [])
            byDate.get(n.targetDate).push(n)
        }

        const sections = [...byDate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, items]) => {
                const datePart = date.slice(0, 10)
                const lines = [`${weekdayLabel(date)} ${datePart} (${items.length}):`]
                for (const n of items) {
                    const url = Campground.getCampsiteUrl(n.campsiteId)
                    const detail = [n.loop, n.campsiteType, n.maxPeople ? `max ${n.maxPeople}` : null]
                        .filter(Boolean).join(', ')
                    const detailPart = detail ? ` (${detail})` : ''
                    lines.push(`- Site ${n.siteNo || n.campsiteId}${detailPart}: ${url}`)
                }
                return lines.join('\n')
            })

        return [header, bookingLink, '', ...sections].join('\n')
    }

    report = (campground, res, cycleId, options = { excludedSites: [] }) => {
        const allSites = this.__getSiteAvailabilities(res.data)
        const excludedSites = options.excludedSites

        // Build observation list spanning every (site, date) pair we saw — needed
        // so the dedup repo can detect both opened AND closed transitions.
        const observations = []
        for (const s of allSites) {
            if (_.includes(excludedSites, s.siteNO)) continue
            for (const date of this.targetDates) {
                observations.push({
                    campgroundId: campground.id,
                    campsiteId: s.campsiteId,
                    siteNo: s.siteNO,
                    targetDate: date,
                    isOpen: s.availableDates.includes(date),
                    loop: s.loop,
                    campsiteType: s.campsiteType,
                    maxPeople: s.maxPeople,
                })
            }
        }
        const newlyOpened = this.repos.availability.applyObservations(observations)

        // In-memory "currently open" state for the dashboard.
        const availableSites = allSites
            .filter(s => s.availableDates.length > 0)
            .filter(s => !_.includes(excludedSites, s.siteNO))

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
        } else {
            state.status = 'all_reserved'
        }

        this.repos.cycles.recordResult(cycleId, campground.id, state.status, availableSites.length, null, state.lastPolledAt)

        // Only notify on FRESH transitions to open. Dedup handled in DB.
        if (newlyOpened.length > 0) {
            const message = this.formatNewlyOpenedMessage(campground, newlyOpened)
            logger.info(message)
            this.notifier.notify(message)
        } else if (availableSites.length > 0) {
            logger.info(`${campground.toString()} ${availableSites.length} site(s) still open (no new openings)`)
        } else {
            logger.info(`${campground.toString()} ALL RESERVED across ${this.targetDates.length} date(s)`)
        }
    }

    __createCampground(campgroundJson) {
        const { name, id, park } = campgroundJson
        return new Campground(name, id, park)
    }

    __handleError(err, campground, cycleId) {
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
        if (cycleId != null) {
            this.repos.cycles.recordResult(cycleId, campground.id, 'error', 0, this.lastErrorReason, new Date().toISOString())
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

    async checkCampground(campgroundJson, cycleId) {
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
            this.report(campground, { data: { campsites: combined } }, cycleId, { excludedSites: this.excludedSites })
            this.__resetBackoff()
        } catch (err) {
            this.__handleError(err, campground, cycleId)
        }
    }
}

export default Checker;
