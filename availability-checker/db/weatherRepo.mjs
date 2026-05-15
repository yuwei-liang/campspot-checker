const fromRow = (r) => r && ({
    lat: r.lat,
    lon: r.lon,
    targetDate: r.target_date,
    sourceDate: r.source_date,
    tminF: r.tmin_f,
    tmaxF: r.tmax_f,
    precipMm: r.precip_mm,
    snowfallCm: r.snowfall_cm,
    weatherCode: r.weather_code,
    fetchedAt: r.fetched_at,
})

export const createWeatherRepo = (db) => {
    const upsert = db.prepare(`
        INSERT INTO weather_forecasts (
            lat, lon, target_date, source_date, tmin_f, tmax_f, precip_mm, snowfall_cm, weather_code, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(lat, lon, target_date) DO UPDATE SET
            source_date = excluded.source_date,
            tmin_f = excluded.tmin_f,
            tmax_f = excluded.tmax_f,
            precip_mm = excluded.precip_mm,
            snowfall_cm = excluded.snowfall_cm,
            weather_code = excluded.weather_code,
            fetched_at = excluded.fetched_at
    `)
    const selectOne = db.prepare(`
        SELECT * FROM weather_forecasts
        WHERE lat = ? AND lon = ? AND target_date = ?
    `)
    const oldestFetchedAt = db.prepare(`
        SELECT MIN(fetched_at) AS oldest FROM weather_forecasts
    `)

    return {
        get(lat, lon, targetDate) {
            return fromRow(selectOne.get(lat, lon, targetDate))
        },
        upsertMany(rows) {
            const tx = db.transaction(() => {
                for (const r of rows) {
                    upsert.run(r.lat, r.lon, r.targetDate, r.sourceDate,
                        r.tminF, r.tmaxF, r.precipMm, r.snowfallCm, r.weatherCode)
                }
            })
            tx()
        },
        oldestFetchedAt() {
            return oldestFetchedAt.get().oldest
        },
    }
}
