import Checker from "./Checker.mjs"

class Campground {
    url = ""
    constructor(name, id, url) {
        this.name = name
        this.id = id
        this.url = url
    }
    // report() {
    //     console.log("[%s]reporting...", this.name)
    //     let checker = new Checker();
    //     checker.check(this.url);
    // }
}

export default Campground;