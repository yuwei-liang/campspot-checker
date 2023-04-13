import Checker from "../Checker"
describe(
    "Checker",
    () => {
        test(
            "should run through all passed-in campgrounds",
            () => {
                const checker = new Checker()
                checker.executeCheck()
            }
        )
    }
)