import Checker from './availability-checker/Checker.mjs'
import express from 'express'
import Notifier from './availability-checker/Notifier.mjs'
const PORT = 8080
const HOST = '0.0.0.0'
const DISCORD_WEBHOOK = process.env.WEBHOOK_URL
const TARGET_DATE = "2023-05-27T00:00:00Z"
const campgrounds = [
    {
        name: "Lower Pines Campground",
        id: 232450,
        url: "https://www.recreation.gov/api/camps/availability/campground/232450/month?start_date=2023-05-01T00%3A00%3A00.000Z",
    },
    {
        name: "North Pines Campground",
        id: 232449,
        url: "https://www.recreation.gov/api/camps/availability/campground/232449/month?start_date=2023-05-01T00%3A00%3A00.000Z",
    },
    {
        name: "Wawona Campground",
        id: 232446,
        url: "https://www.recreation.gov/api/camps/availability/campground/232446/month?start_date=2023-05-01T00%3A00%3A00.000Z"
    },
    {
        name: "Upper Pines Campground",
        id: 232447,
        url: "https://www.recreation.gov/api/camps/availability/campground/232447/month?start_date=2023-05-01T00%3A00%3A00.000Z"
    }
];

// To tell discord this server is still running
const liveCheck = (interval = 5) => {
    const notifier = new Notifier(DISCORD_WEBHOOK)
    setInterval(() => {
        var date = new Date()
        const minutes = date.getMinutes();
        if (minutes % interval == 0) {
            notifier.heartbeat()
        }
    }, 10000)

}

const execute = () => {
    const checker = new Checker(
        TARGET_DATE,
        DISCORD_WEBHOOK
    );
    campgrounds.forEach(campgroundJson => {
        checker.checkCampground(campgroundJson)
    })
}

// App
const app = express()
app.get('/', (req, res) => {
    res.send('Hello World');
});

app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
    // first run
    execute()

    // send heatbeats
    liveCheck()

    // repeated run
    setInterval(execute, 20000)
});
