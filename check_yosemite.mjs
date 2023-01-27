import Checker from './availability-checker/Checker.mjs'

// Lower Pines Campground
const campgrounds = [
    {
        name: "Lower Pines Campground",
        url:  "https://www.recreation.gov/api/camps/availability/campground/232450/month?start_date=2023-05-01T00%3A00%3A00.000Z",
    },
    {
        name: "North Pines Campground",
        url:  "https://www.recreation.gov/api/camps/availability/campground/232449/month?start_date=2023-05-01T00%3A00%3A00.000Z",
    },
];
// const availabilityUrl = "https://www.recreation.gov/api/camps/availability/campground/232450/month?start_date=2023-05-01T00%3A00%3A00.000Z";

const liveCheck = (interval = 30) => {
    var date = new Date()
    const minutes = date.getMinutes();
    if (minutes % interval == 0)
    {
        sendMsgToWebhook("I am still alive.");
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
    let checker = new Checker(availabilityUrl);
    checker.check();
}

setInterval(execute, 5000)
setInterval(liveCheck, 60000)
