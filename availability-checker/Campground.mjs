class Campground {
    constructor(name, id, park = "") {
        this.name = name
        this.id = id
        this.park = park
    }

    getAvailabilityUrl(monthStart) {
        if (!monthStart) {
            throw new Error(
                `Campground.getAvailabilityUrl: monthStart is required (got ${monthStart}). ` +
                `Set MONTH_START in .env to an ISO 8601 first-of-month date, e.g. 2026-06-01T00:00:00.000Z`
            )
        }
        return `https://www.recreation.gov/api/camps/availability/campground/${this.id}/month?start_date=${encodeURIComponent(monthStart)}`
    }

    getBookingUrl(targetDateIso) {
        const base = `https://www.recreation.gov/camping/campgrounds/${this.id}`
        return Campground.__appendDateRange(base, targetDateIso)
    }

    static getCampsiteUrl(campsiteId, targetDateIso) {
        const base = `https://www.recreation.gov/camping/campsites/${campsiteId}`
        return Campground.__appendDateRange(base, targetDateIso)
    }

    // rec.gov's date picker hydrates from `startdate` + `enddate` query params
    // (YYYY-MM-DD, UTC). enddate is checkout, so a one-night stay starting on
    // `targetDateIso` ends the next calendar day.
    static toRecGovDateRange(targetDateIso) {
        if (!targetDateIso) return null
        const startdate = String(targetDateIso).slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startdate)) return null
        const nextMs = Date.parse(`${startdate}T00:00:00Z`) + 86400000
        if (!Number.isFinite(nextMs)) return null
        const enddate = new Date(nextMs).toISOString().slice(0, 10)
        return { startdate, enddate }
    }

    static __appendDateRange(baseUrl, targetDateIso) {
        const range = Campground.toRecGovDateRange(targetDateIso)
        return range ? `${baseUrl}?startdate=${range.startdate}&enddate=${range.enddate}` : baseUrl
    }

    toString() {
        let desc = ``
        if (this.park) {
            desc += `[${this.park}]`
        }

        if (this.name) {
            desc += `[${this.name}]`
        }

        desc += `[id:${this.id}]`
        return desc
    }
}

export default Campground;
