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

const alertWhenTrue = (resultMap) => {
    const availableSites = _.filter(resultMap, (
        {
            siteNO,
            isAvailable,
        }
    ) => {
        return isAvailable;
    })

    var date = Date.now()
    var date = new Date()
    const ts = date.toTimeString()

    if (availableSites.length > 0)
    {
        console.log(`${ts} FOUND AVAILABLE SITES~`);
        console.log(availableSites);
    }
    else
    {
        console.log(`${ts} ALL RESERVED`)
    }
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
