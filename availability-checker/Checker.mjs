import axios from 'axios'
import _ from 'lodash'
import Campground from './Campground.mjs'
import Notifier from './Notifier.mjs'

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
const MAX_BACKOFF_MS = 10 * 60 * 1000

class Checker {
    excludedSites = []
    campgrounds
    backoffMs = 0
    lastErrorReason = null

    constructor(campgrounds, targetDate, discordWebhookURL, monthStart) {
        if (!monthStart) {
            throw new Error('Checker: monthStart is required')
        }
        if (!targetDate) {
            throw new Error('Checker: targetDate is required')
        }
        this.targetDate = targetDate
        this.monthStart = monthStart
        this.notifier = new Notifier(discordWebhookURL)
        this.campgrounds = campgrounds
    }

    async executeCheck() {
        for (const campground of this.campgrounds) {
            await this.__sleep(INTER_CAMPGROUND_SLEEP_MS)
            await this.checkCampground(campground)
        }
        logger.info("Done!")
    }

    getBackoffMs() {
        return this.backoffMs
    }

    __sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    __getSiteAvailabilities = (json) => {
        const sites = json.campsites;
        const result = _.map(sites, (siteData, siteNum) => {
            const targetAvailability = _.get(
                siteData.availabilities,
                this.targetDate
            )
            const isAvailable = !_.includes(
                UNAVAILABLE_STATUSES,
                targetAvailability
            );
            const siteNO = siteData.site;

            return {
                siteNO,
                isAvailable,
                campsiteId: siteData.campsite_id,
                availability: targetAvailability,
            }
        })
        return result;
    }

    report = (campground, res, options = { excludedSites: [] }) => {
        const availabilities = this.__getSiteAvailabilities(res.data)
        const excludedSites = options.excludedSites
        const availableSites = _.filter(availabilities, ({ siteNO, isAvailable }) => {
            if (_.includes(excludedSites, siteNO)) {
                return false
            }
            return isAvailable;
        })

        let report = ""
        report += campground.toString()
        let hasFoundAvailables = false;

        if (availableSites.length > 0) {
            hasFoundAvailables = true;
            report += 'FOUND AVAILABLE SITES~';
            report += JSON.stringify(availableSites);
        } else {
            report += "ALL RESERVED";
        }

        logger.info(report)
        if (hasFoundAvailables) {
            this.notifier.notify(report)
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
        const url = campground.getAvailabilityUrl(this.monthStart)

        try {
            const res = await axios.get(url, {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 15000,
            })
            this.report(campground, res, { excludedSites: this.excludedSites })
            this.__resetBackoff()
        } catch (err) {
            this.__handleError(err, campground)
        }
    }
}

export default Checker;
