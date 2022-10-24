const axios = require('axios');
const _ = require('lodash');

const parse = (json) => {
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

const liveCheck = () => {
    var date = new Date()
    const minutes = date.getMinutes();
    if (minutes % 30 == 0)
    {
        sendMsgToWebhook("I am still alive.");
    }
}

const alertWhenTrue = async (resultMap) => {
    const availableSites = _.filter(resultMap, (
        {
            siteNO,
            isAvailable,
        }
    ) => {
        return isAvailable;
    })

    var date = new Date()
    const ts = date.toTimeString()

    let report = ts
    let hasFoundAvailables = false;

    if (availableSites.length > 0)
    {
        hasFoundAvailables = true;
        report += 'FOUND AVAILABLE SITES~';
        report += JSON.stringify(availableSites);
    }
    else
    {
        report += "ALL RESERVED";
    }

    console.log(report)
    if (hasFoundAvailables)
    {
        await sendMsgToWebhook(report);
    }
}

const sendMsgToWebhook = async ($msg) => {
    const webhookURL = "https://discord.com/api/webhooks/1034203397802430504/DYpA_-yP2dWYQ9XpgI2xKsoK00sfDxBzni0D_IT1dXUw4o6t7A-4Uc_EjBQUN5YISe0M";
    return axios.post(webhookURL, {
        // content: "test",
        content: $msg,
    })
}

const execute = () => {
    axios.get('https://www.recreation.gov/api/camps/availability/campground/232250/month?start_date=2022-11-01T00%3A00%3A00.000Z')
    // Show response data
    .then(res => {
        const parsedRes = parse(res.data)
        alertWhenTrue(parsedRes)
    })
    .catch(err => console.log(err))
}

setInterval(execute, 5000);
setInterval(liveCheck, 1000);
