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

    getBookingUrl() {
        return `https://www.recreation.gov/camping/campgrounds/${this.id}`
    }

    static getCampsiteUrl(campsiteId) {
        return `https://www.recreation.gov/camping/campsites/${campsiteId}`
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
