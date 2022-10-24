const axios = require('axios');
const { result } = require('lodash');
const _ = require('lodash');

const parse = (json) => {
    const sites = json.campsites;
    const result = _.map(sites, (siteData, siteNum) => {
        const a1105 = _.get(siteData.availabilities, "2022-11-05T00:00:00Z")
        const isAvailable = !_.includes(
            ["Reserved", "Not Available", undefined],
            a1105
        );
        // const siteNO = siteData.site;
        const siteNO = siteData.site;
        // console.log((siteData));
        // console.log(`${siteNO}: [${a1105}] - [internal no ${siteNum}]`);
        // console.log(_.get(siteData.availabilities, "2022-11-05T00:00:00Z"));

        return {
            siteNO,
            isAvailable,
        }
    })
    return result;
    // console.log(json);
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

    if (availableSites.length > 0)
    {
        console.log("FOUND AVAILABLE SITES~");
        console.log(availableSites);
    }
    else
    {
        console.log("ALL RESERVED")
    }
}

const execute = () => {
    axios.get('https://www.recreation.gov/api/camps/availability/campground/232250/month?start_date=2022-11-01T00%3A00%3A00.000Z')
    // Show response data
    .then(res => {
        const json = res.data
        const parsedRes = parse(res.data)
        // console.log(parsedRes)
        alertWhenTrue(parsedRes)
    })
    .catch(err => console.log(err))
}

setInterval(execute, 5000);

// while(true)
// {
//     sleep(5)
//     execute()
// }