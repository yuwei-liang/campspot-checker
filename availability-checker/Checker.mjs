import axios from 'axios'
import _ from 'lodash'
import Campground from './Campground.mjs'
import Notifier from './Notifier.mjs'
const UNAVAILABLE_STATUSES = [
    "Reserved", "Not Available", undefined, "Not Reservable Management",
    "NYR"
]
// Declaration
class Checker {
    excludedSites = []
    campgrounds
    constructor(campgrounds, targetDate, discordWebhookURL) {
        this.targetDate = targetDate
        this.notifier = new Notifier(discordWebhookURL)
        this.campgrounds = campgrounds
    }

    async executeCheck() {
        for (const campground of this.campgrounds) {
            await this.checkCampground(campground)
        }
        // this.campgrounds.forEach(async campgroundJson => {
        //     await this.__sleep(5000)
        //     this.checkCampground(campgroundJson)
        // })
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

    sendMsgToWebhook = async ($msg) => {
        const webhookURL = "https://discord.com/api/webhooks/1034203397802430504/DYpA_-yP2dWYQ9XpgI2xKsoK00sfDxBzni0D_IT1dXUw4o6t7A-4Uc_EjBQUN5YISe0M";
        return axios.post(webhookURL, {
            content: $msg,
        })
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

        let report = ""
        report += campground.toString()
        // report += `[${campground.name}]`
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

        logger.info(report)
        if (hasFoundAvailables) {
            // await this.sendMsgToWebhook(report);
            this.notifier.notify(report)
            // await
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
        const url = campground.getAvailabilityUrl()

        await this.__sleep(5000)
        await axios.get(url)
            .then(res => {
                this.report(campground, res, { excludedSites: this.excludedSites })
            })
            .catch(err => logger.error(err))
    }
}

export default Checker;
