import axios from 'axios'

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000  // refresh once per day

/**
 * Convert a target date to a "source date" we'll query against the archive API:
 * the same month/day in the previous year. The archive lags real-time by ~5 days
 * so any past full year is safely in the dataset.
 */
const sourceDateForTarget = (targetDateIso) => {
    const d = new Date(targetDateIso)
    const y = d.getUTCFullYear() - 1
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

/**
 * Group target dates by (lat, lon) and fetch each location's archive data in
 * one request spanning all the dates we care about.
 */
export const refreshWeather = async ({ repos, campgrounds, targetDates, fetchFn = axios.get }) => {
    const locations = new Map() // key: "lat,lon" -> { lat, lon, sourceDates: Set<string>, targetDates: Set<string> }
    for (const cg of campgrounds) {
        if (cg.lat == null || cg.lon == null) continue
        const key = `${cg.lat},${cg.lon}`
        if (!locations.has(key)) {
            locations.set(key, { lat: cg.lat, lon: cg.lon, sourceToTargets: new Map() })
        }
        const loc = locations.get(key)
        for (const tgt of targetDates) {
            const src = sourceDateForTarget(tgt)
            if (!loc.sourceToTargets.has(src)) loc.sourceToTargets.set(src, new Set())
            loc.sourceToTargets.get(src).add(tgt)
        }
    }

    let fetched = 0
    let errors = 0
    for (const { lat, lon, sourceToTargets } of locations.values()) {
        const sourceDates = [...sourceToTargets.keys()].sort()
        if (sourceDates.length === 0) continue
        const startDate = sourceDates[0]
        const endDate = sourceDates[sourceDates.length - 1]
        try {
            const res = await fetchFn(ARCHIVE_URL, {
                params: {
                    latitude: lat,
                    longitude: lon,
                    start_date: startDate,
                    end_date: endDate,
                    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code',
                    temperature_unit: 'fahrenheit',
                    timezone: 'America/Los_Angeles',
                },
                timeout: 20_000,
            })
            const daily = res.data?.daily
            if (!daily?.time) {
                errors += 1
                continue
            }
            const rows = []
            for (let i = 0; i < daily.time.length; i++) {
                const sourceDate = daily.time[i]
                const targets = sourceToTargets.get(sourceDate) || new Set()
                for (const targetDate of targets) {
                    rows.push({
                        lat, lon,
                        targetDate,
                        sourceDate,
                        tminF: daily.temperature_2m_min?.[i] ?? null,
                        tmaxF: daily.temperature_2m_max?.[i] ?? null,
                        precipMm: daily.precipitation_sum?.[i] ?? null,
                        snowfallCm: daily.snowfall_sum?.[i] ?? null,
                        weatherCode: daily.weather_code?.[i] ?? null,
                    })
                }
            }
            repos.weather.upsertMany(rows)
            fetched += rows.length
        } catch (err) {
            errors += 1
        }
    }
    return { fetched, errors, locations: locations.size }
}

/**
 * Wrap refreshWeather in a daily scheduler. Runs once at startup and then every 24h.
 * Returns the timer handle so caller can clearInterval if needed.
 */
export const scheduleWeatherRefresh = ({ repos, getCampgrounds, getTargetDates, log = console }) => {
    const fire = async () => {
        try {
            const result = await refreshWeather({
                repos,
                campgrounds: getCampgrounds(),
                targetDates: getTargetDates(),
            })
            log.info(`weather refresh: ${result.fetched} rows across ${result.locations} location(s), ${result.errors} error(s)`)
        } catch (err) {
            log.error(`weather refresh failed: ${err.message}`)
        }
    }
    fire()
    return setInterval(fire, REFRESH_INTERVAL_MS)
}

export const __test = { sourceDateForTarget }
