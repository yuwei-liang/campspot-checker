import axios from 'axios'
import _ from 'lodash'
import Campground from './Campground.mjs'
import Notifier from './Notifier.mjs'
const UNAVAILABLE_STATUSES = [
    "Reserved", "Not Available", undefined, "Not Reservable Management",
    "NYR", "Closed"
]
// Declaration
class Checker {
    excludedSites = []
    campgrounds
    logger
    targetDate
    constructor(campgrounds, targetDate, discordWebhookURL) {
        this.targetDate = targetDate
        this.notifier = new Notifier(discordWebhookURL)
        this.campgrounds = campgrounds
    }

    setLogger(logger) {
        this.logger = logger
    }

    async executeCheck() {
        for (const campground of this.campgrounds) {
            await this.__sleep(2000)
            await this.checkCampground(campground)
        }
        this.logger.info("Done!")
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
                loop: siteData.loop,
                availability: targetAvailability,
            }
        })
        return result;
    }

    /**
     * @todo print available sites
     * @todo return filtered available sites
     */
    report = async (
        campground,
        res,
        options = {
            excludedSites: [],
        }
    ) => {
        // console.log(res.data);
        const availabilities = this.__getSiteAvailabilities(res.data)
        const excludedSites = options.excludedSites
        // console.log("excluding: " + excludedSites)
        const availableSites = _.filter(availabilities, (
            {
                siteNO,
                isAvailable,
            }
        ) => {
            if (_.includes(excludedSites, siteNO)) {
                return false
            }

            return isAvailable;
        })

        let report = `[${campground.id}]`
        let hasFoundAvailables = false;

        if (availableSites.length > 0) {
            hasFoundAvailables = true;
            report += 'FOUND AVAILABLE SITES~';
            // @TODO: the report might be too long
            report += JSON.stringify(availableSites);
        }
        else {
            report += "ALL RESERVED";
        }

        this.logger.info(report)
        if (hasFoundAvailables) {
            this.notifier.notify(report)
        }
    }

    /**
     * Get a Campground instance with provided json
     * @param {object} campgroundJson
     * @returns {Campground} campground instance
     */
    __createCampground(campgroundJson) {
        const {
            name,
            id,
            park
        } = campgroundJson
        return new Campground(name, id, park)
    }

    async checkCampground(campgroundJson) {
        const campground = this.__createCampground(campgroundJson)
        this.logger.info("what is targetDate: " + this.targetDate)
        // get year and month from targetDate
        const year = this.targetDate.split("-")[0]
        const month = this.targetDate.split("-")[1]
        const url = campground.getAvailabilityUrl(
            year,
            month
        )
        this.logger.info(`Checking ${url} ...`)

        await axios.get(url)
            .then(res => {
                this.report(campground, res, { excludedSites: this.excludedSites })
            })
            .catch(err => this.logger.error(err))
    }
}

export default Checker;
