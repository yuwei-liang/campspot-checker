// const axios = require('axios');
import axios from 'axios'
import _ from 'lodash'

// Declaration
class Checker {
    excludedSites = []
    constructor(url) {
        this.url = url;
    }

    parse = (json) => {
        const sites = json.campsites;
        const result = _.map(sites, (siteData, siteNum) => {
            const a1105 = _.get(siteData.availabilities, "2022-11-05T00:00:00Z")
            const isAvailable = !_.includes(
                ["Reserved", "Not Available", undefined],
                a1105
            );
            const siteNO = siteData.site;

            return {
                siteNO,
                isAvailable,
            }
        })
        return result;
    }

    /**
     * @todo print available sites
     * @todo return filtered available sites
     */
    alertWhenTrue = async (
        resultMap,
        options = {
            excludedSites: [],
        }
    ) => {
        const excludedSites = options.excludedSites
        console.log("excluding: " + excludedSites)
        const availableSites = _.filter(resultMap, (
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
        let hasFoundAvailables = false;

        if (availableSites.length > 0) {
            hasFoundAvailables = true;
            report += 'FOUND AVAILABLE SITES~';
            report += JSON.stringify(availableSites);
        }
        else {
            report += "ALL RESERVED";
        }

        console.log(report)
        if (hasFoundAvailables) {
            await sendMsgToWebhook(report);
        }
    }

    check() {
        axios.get(this.url)
            // Show response data
            .then(res => {
                const parsedRes = this.parse(res.data)
                this.alertWhenTrue(parsedRes, { excludedSites: this.excludedSites })
            })
            .catch(err => console.log(err))
    }
}

export default Checker;
