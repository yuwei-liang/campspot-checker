import { openDatabase } from '../db/db.mjs'
import { createWeatherRepo } from '../db/weatherRepo.mjs'
import { createCampgroundsRepo } from '../db/campgroundsRepo.mjs'
import { refreshWeather, __test } from '../weatherService.mjs'

describe('weatherService.sourceDateForTarget', () => {
    test('shifts the year back by 1, preserving month/day', () => {
        expect(__test.sourceDateForTarget('2026-06-27T00:00:00Z')).toBe('2025-06-27')
        expect(__test.sourceDateForTarget('2026-09-03T00:00:00Z')).toBe('2025-09-03')
    })
})

describe('refreshWeather', () => {
    test('fetches once per (lat,lon) and upserts a row per (location, target_date)', async () => {
        const db = openDatabase(':memory:')
        const weather = createWeatherRepo(db)
        const campgrounds = createCampgroundsRepo(db)
        campgrounds.upsertMany([
            { id: 1, name: 'A', lat: 37.74, lon: -119.57 },
            { id: 2, name: 'B', lat: 37.74, lon: -119.57 },  // same lat/lon
            { id: 3, name: 'C', lat: 37.87, lon: -119.34 },
            { id: 4, name: 'No coords', lat: null, lon: null },  // skipped
        ])

        const fetchCalls = []
        const fakeFetch = async (url, { params }) => {
            fetchCalls.push(params)
            return {
                data: {
                    daily: {
                        time: [params.start_date, params.end_date],
                        temperature_2m_max: [80, 82],
                        temperature_2m_min: [50, 52],
                        precipitation_sum: [0, 0],
                        snowfall_sum: [0, 0],
                        weather_code: [0, 1],
                    },
                },
            }
        }

        const targetDates = ['2026-06-26T00:00:00Z', '2026-06-27T00:00:00Z']
        const result = await refreshWeather({
            repos: { weather },
            campgrounds: campgrounds.all(),
            targetDates,
            fetchFn: fakeFetch,
        })

        // Two unique lat/lon pairs; one HTTP call each
        expect(fetchCalls).toHaveLength(2)
        // No coords row was skipped
        expect(result.locations).toBe(2)
        // 2 targets × 2 locations = 4 rows total
        expect(result.fetched).toBe(4)

        const w = weather.get(37.74, -119.57, '2026-06-27T00:00:00Z')
        expect(w.tmaxF).toBe(82)
        expect(w.tminF).toBe(52)
        expect(w.sourceDate).toBe('2025-06-27')
    })

    test('errors on one location do not abort others', async () => {
        const db = openDatabase(':memory:')
        const weather = createWeatherRepo(db)
        const campgrounds = createCampgroundsRepo(db)
        campgrounds.upsertMany([
            { id: 1, name: 'A', lat: 1, lon: 1 },
            { id: 2, name: 'B', lat: 2, lon: 2 },
        ])

        const fakeFetch = async (url, { params }) => {
            if (params.latitude === 1) throw new Error('boom')
            return { data: { daily: { time: ['2025-06-27'], temperature_2m_max: [70], temperature_2m_min: [50],
                precipitation_sum: [0], snowfall_sum: [0], weather_code: [0] } } }
        }

        const result = await refreshWeather({
            repos: { weather },
            campgrounds: campgrounds.all(),
            targetDates: ['2026-06-27T00:00:00Z'],
            fetchFn: fakeFetch,
        })
        expect(result.errors).toBe(1)
        expect(result.fetched).toBe(1)
        expect(weather.get(2, 2, '2026-06-27T00:00:00Z')).not.toBeNull()
    })
})
