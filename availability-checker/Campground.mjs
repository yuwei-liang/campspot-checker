import Checker from "./Checker.mjs"

class Campground {
    constructor(name, id, park = "") {
        this.name = name
        this.id = id
        this.park = park
    }

    // @TODO: supports month slection
    getAvailabilityUrl() {
        const url = `https://www.recreation.gov/api/camps/availability/campground/${this.id}/month?start_date=2023-05-01T00%3A00%3A00.000Z`
        return url;
    }

    toString() {
        let desc = ``
        if (this.park) {
            desc += `[${this.park}]`
        }

        if (this.name) {
            desc += `[${this.name}]`
        }

        desc += `[${this.getAvailabilityUrl()}]`
        return desc
    }
}

export default Campground;