import axios from 'axios'
import _ from 'lodash'
import Notifier from './Notifier.mjs'
const UNAVAILABLE_STATUSES = [
    "Reserved", "Not Available", undefined, "Not Reservable Management"
]
// Declaration
class Checker {
    excludedSites = []
    constructor(targetDate, discordWebhookURL) {
        this.targetDate = targetDate
        this.notifier = new Notifier(discordWebhookURL)
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
        campgroundName,
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

        var date = new Date()
        const ts = date.toTimeString()

        let report = ts
        report += `[${campgroundName}]`
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

        console.log(report)
        if (hasFoundAvailables) {
            // await this.sendMsgToWebhook(report);
            this.notifier.notify(report)
            // await
        }
    }

    checkCampground(campground) {
        const {
            name,
            id,
            url
        } = campground
        axios.get(url)
            .then(res => {
                this.report(name, res, { excludedSites: this.excludedSites })
            })
            .catch(err => console.log(err))
    }
}

export default Checker;
