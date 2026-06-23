// Playwright cart automation for rec.gov campground reservations.
//
// Flow (validated 2026-06-22 against Upper Pines via probe scripts):
//   1. Open  /camping/campgrounds/{cgId}?startdate=X&enddate=Y   (Y = checkout)
//   2. Handle login modal if present (re-uses permit-bot helper).
//   3. Page renders a per-site grid showing ~10 days at a time.
//      Each cell is <button class="rec-availability-date">
//      with aria-label of the form
//        "<MonthAbbrev> <Day>, <Year> - Site <SiteNo> is available"   (avail)
//        "<MonthAbbrev> <Day>, <Year> - Site <SiteNo> is Reserved"    (taken)
//      Navigate forward via button[aria-label="Go Forward 5 Days"] until the
//      target cell is visible.
//   4. Click the cell. The page interprets startdate/enddate from the URL and
//      treats the cell click as "I'll take site <N> for this trip range." An
//      "Add to Cart" button appears immediately (verified single-click).
//   5. Click "Add to Cart". May prompt login if session expired; handle it.
//   6. Verify state at /cart. The cart page shows the site name + date range
//      with a 15-min countdown when the hold is real.
//
// `tryGrabCampsite` is the one-shot entry: it does steps 1-6 in dry-run or
// for-real mode and returns a result object the CLI logs / Discords.
import { chromium } from 'playwright'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { getAccount, handleLoginModalIfPresent } from '../permit-bot/CartBot.mjs'
import { resolveForChromium } from '../permit-bot/dnsBypass.mjs'

const VIEWPORT = { width: 1400, height: 1100 }
const HOSTS_TO_PIN = ['www.recreation.gov', 'recreation.gov']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function arialLabelForCell({ siteNo, date, status }) {
    const [y, m, d] = date.split('-').map(Number)
    return `${MONTH_NAMES[m - 1]} ${d}, ${y} - Site ${siteNo} is ${status}`
}

async function launchCampspotContext({ headless = false, accountIndex = 1 } = {}) {
    const acct = getAccount(accountIndex)
    // Reuses the permit-bot account directory so a single rec.gov login covers
    // both bots. permit-bot.mjs `login --account=N` is the canonical way to
    // establish a session.
    await mkdir(acct.profileDir, { recursive: true })

    const rules = []
    for (const host of HOSTS_TO_PIN) {
        try {
            const ip = await resolveForChromium(host)
            rules.push(`MAP ${host} ${ip}`)
        } catch { /* best-effort */ }
    }
    const args = [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=DnsOverHttps,AsyncDns',
    ]
    if (rules.length > 0) args.push(`--host-resolver-rules=${rules.join(',')}`)
    return chromium.launchPersistentContext(acct.profileDir, {
        headless,
        viewport: VIEWPORT,
        args,
    })
}

// Advance the calendar grid by clicking "Go Forward 5 Days" until the target
// date is one of the rendered columns. Returns true on success. Caps at
// `maxAdvances` to bound the walk (default 40 → 200 days from today).
export async function advanceCalendarTo(page, targetDate, { log = console, maxAdvances = 40 } = {}) {
    const fwd = page.locator('button[aria-label="Go Forward 5 Days"]').first()
    if (await fwd.count() === 0) {
        log.warn?.('No "Go Forward 5 Days" button — calendar widget missing or page not loaded')
        return false
    }
    const isVisible = async () => {
        // The grid renders header columns with aria-labels matching
        // "<MonthAbbrev> <Day>, <Year>" prefix on every cell for that day.
        const [y, m, d] = targetDate.split('-').map(Number)
        const prefix = `${MONTH_NAMES[m - 1]} ${d}, ${y}`
        const cell = page.locator(`[aria-label^="${prefix}"]`).first()
        return (await cell.count()) > 0
    }
    if (await isVisible()) return true
    for (let i = 0; i < maxAdvances; i++) {
        await fwd.click({ timeout: 2500 }).catch(() => {})
        await page.waitForTimeout(450)
        if (await isVisible()) return true
    }
    log.warn?.(`advanceCalendarTo: target ${targetDate} not visible after ${maxAdvances} advances`)
    return false
}

// Find the Available cell for (siteNo, date). Returns the Playwright Locator
// or null. Tolerates rec.gov's mixed-case ("is available" lowercase verified
// 2026-06-22, but defensive). Site number is matched exactly — rec.gov shows
// "Site 046" with leading zeros, so caller must pass the padded form.
export async function findAvailableCell(page, { siteNo, date }) {
    const label = arialLabelForCell({ siteNo, date, status: 'available' })
    const cell = page.locator(`[aria-label="${label}" i]`).first()
    return (await cell.count()) > 0 ? cell : null
}

// Step back one calendar day from endDate (the checkout) to get the last
// NIGHT's date. Multi-night range selection clicks both the first-night cell
// and the last-night cell.
export function lastNightOf(startDate, endDate) {
    const sMs = Date.parse(`${startDate}T00:00:00Z`)
    const eMs = Date.parse(`${endDate}T00:00:00Z`)
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) return null
    const lastNightMs = eMs - 86400000
    return new Date(lastNightMs).toISOString().slice(0, 10)
}

function humanDate(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split('-').map(Number)
    return `${MONTH_NAMES[m - 1]} ${d}, ${y}`
}

// One-shot: navigate to /cart in a fresh tab and read the body text to verify
// the hold. Returns { state, cartText, cartShot, observed }.
//
// rec.gov cart format (verified 2026-06-22 by a real auto-grab):
//   "003, Upper Pines STANDARD NONELECTRIC"
//   "Check-In Date: Thu Jun 25, 2026"
//   "Check-Out Date: Fri Jun 26, 2026"
//
// States:
//   'held'        → cart has site + correct check-in AND check-out
//   'wrong_trip'  → cart has site + correct check-in but wrong check-out
//                   (the multi-night bug from 2026-06-22: rec.gov gave us 1
//                    night instead of N because we only clicked one cell).
//                   Caller should release this hold immediately so it doesn't
//                   squat on the user's account.
//   'has_items_but_not_target' → cart has SOMETHING but not our site/date
//   'empty'       → empty cart
//   'unknown'     → couldn't parse
async function verifyCartHold(ctx, { siteNo, startDate, endDate, screenshotPath }) {
    const cartPage = await ctx.newPage()
    let cartShot = null
    let state = 'unknown'
    let cartText = ''
    const observed = { checkIn: null, checkOut: null }
    try {
        await cartPage.goto('https://www.recreation.gov/cart', { waitUntil: 'domcontentloaded', timeout: 20000 })
        await cartPage.waitForTimeout(2500)
        cartShot = screenshotPath('cart')
        await cartPage.screenshot({ path: cartShot, fullPage: true })
        cartText = await cartPage.evaluate(() => document.body.innerText)

        // Pull the literal check-in / check-out lines so we can report what we
        // actually got, not just true/false. Pattern: "Check-In Date: Thu Jun 25, 2026".
        const ciMatch = cartText.match(/Check-In Date:\s*\w+\s+(\w+)\s+(\d+),\s+(\d{4})/i)
        const coMatch = cartText.match(/Check-Out Date:\s*\w+\s+(\w+)\s+(\d+),\s+(\d{4})/i)
        if (ciMatch) observed.checkIn = `${ciMatch[1]} ${ciMatch[2]}, ${ciMatch[3]}`
        if (coMatch) observed.checkOut = `${coMatch[1]} ${coMatch[2]}, ${coMatch[3]}`

        const startHuman = humanDate(startDate)
        const endHuman = humanDate(endDate)
        const sitePattern = new RegExp(`(?:^|\\W)${siteNo.replace(/^0+/, '0*')}(?:,|\\s)`, 'i')
        const siteOk = sitePattern.test(cartText)
        const startOk = observed.checkIn?.toLowerCase() === startHuman.toLowerCase()
        const endOk = observed.checkOut?.toLowerCase() === endHuman.toLowerCase()

        if (/your cart is empty/i.test(cartText)) state = 'empty'
        else if (siteOk && startOk && endOk) state = 'held'
        else if (siteOk && startOk && !endOk) state = 'wrong_trip'
        else if (/cart/i.test(cartText)) state = 'has_items_but_not_target'
    } finally {
        await cartPage.close().catch(() => {})
    }
    return { state, cartText, cartShot, observed }
}

// Shared booking flow used by both `tryGrabCampsite` (cold launch path,
// CLI / one-shot) and `warmCampspotWindow.hot` (warm path, watch loop).
// Caller is responsible for opening the page at the campground URL with
// startdate/enddate query params — this function picks up from there.
//
// Returns the same shape as the public entry points so they can pass it
// straight through.
async function performBookingFlow(ctx, page, {
    campgroundId,
    siteNo,
    startDate,
    endDate,
    dryRun = false,
    accountIndex = 1,
    screenshotPath,
    log = console,
}) {
    // Step 1: advance calendar to startDate.
    log.info('Step 1: advance calendar grid to target date')
    const advanced = await advanceCalendarTo(page, startDate, { log, maxAdvances: 60 })
    if (!advanced) {
        await page.screenshot({ path: screenshotPath('err-no-date'), fullPage: true }).catch(() => {})
        return { ok: false, reason: 'date_not_in_grid', ctx, page }
    }

    // Step 2: find the available cell for site + start date.
    log.info(`Step 2: find available cell for site ${siteNo}`)
    const cell = await findAvailableCell(page, { siteNo, date: startDate })
    if (!cell) {
        log.warn(`No Available cell for site ${siteNo} on ${startDate} — slot likely just got taken`)
        await page.screenshot({ path: screenshotPath('err-no-avail'), fullPage: true }).catch(() => {})
        return { ok: false, reason: 'cell_not_available', ctx, page }
    }
    await cell.scrollIntoViewIfNeeded().catch(() => {})

    if (dryRun) {
        log.info('[dry-run] Cell located, NOT clicking.')
        await page.screenshot({ path: screenshotPath('dryrun-located'), fullPage: true }).catch(() => {})
        return { ok: true, dryRun: true, ctx, page }
    }

    // Step 3a: click the start cell — this picks the first night.
    log.info('Step 3a: click start cell (first night)')
    await cell.click()
    await page.waitForTimeout(1200)

    // Step 3b: for multi-night stays, ALSO click the last-night cell.
    // (A single click on the start cell is interpreted as a 1-night stay
    // regardless of URL `enddate`. To get N nights, click both endpoints —
    // rec.gov range-selects the span between.)
    const lastNight = lastNightOf(startDate, endDate)
    if (lastNight && lastNight !== startDate) {
        log.info(`Step 3b: click last-night cell (${lastNight}) for range select`)
        await advanceCalendarTo(page, lastNight, { log, maxAdvances: 6 })
        const endCell = await findAvailableCell(page, { siteNo, date: lastNight })
        if (!endCell) {
            log.warn(`No Available cell for last-night ${lastNight} on site ${siteNo} — slot likely partially taken`)
            await page.screenshot({ path: screenshotPath('err-no-end-cell'), fullPage: true }).catch(() => {})
            return { ok: false, reason: 'last_night_cell_missing', ctx, page }
        }
        await endCell.scrollIntoViewIfNeeded().catch(() => {})
        await endCell.click()
        await page.waitForTimeout(1200)
    }
    await page.screenshot({ path: screenshotPath('02-after-cell-click'), fullPage: true }).catch(() => {})

    // Step 4: click "Add to Cart".
    log.info('Step 4: click Add to Cart')
    const addBtn = page.locator(
        'button:has-text("Add to Cart"), #add-cart-campsite, button[aria-label*="Add to Cart" i]'
    ).first()
    await addBtn.waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForFunction(
        () => {
            const btns = [...document.querySelectorAll('button')]
            const b = btns.find(x => /add to cart/i.test(x.textContent?.trim() || ''))
            return b && !b.disabled && !/true/i.test(b.getAttribute('aria-disabled') || '')
        },
        null,
        { timeout: 8000, polling: 200 },
    ).catch(() => log.warn('Add to Cart did not become enabled; clicking anyway'))
    await addBtn.click()
    log.info('Clicked Add to Cart')
    await page.waitForTimeout(3500)
    await handleLoginModalIfPresent(page, { log, accountIndex })
    await page.waitForTimeout(2500)
    const postClickUrl = page.url()
    const postClickShot = screenshotPath('03-after-add')
    await page.screenshot({ path: postClickShot, fullPage: true }).catch(() => {})
    log.info(`Post-Add URL: ${postClickUrl}`)

    // Step 5: verify the hold by visiting /cart in a fresh tab.
    log.info('Step 5: verify cart')
    const { state: cartState, cartText, cartShot, observed } = await verifyCartHold(ctx, {
        siteNo, startDate, endDate, screenshotPath,
    })
    log.info(`Cart state: ${cartState} (observed checkIn=${observed.checkIn}, checkOut=${observed.checkOut})`)

    // Step 6: auto-release wrong_trip holds so they don't squat for 15 min.
    if (cartState === 'wrong_trip') {
        log.warn(`wrong_trip detected — releasing hold (wanted ${startDate}→${endDate}, got checkOut=${observed.checkOut})`)
        try {
            const r = await releaseCampspotCart({ accountIndex, log })
            log.info(`released stale wrong_trip hold: removed=${r.removed} state=${r.state}`)
        } catch (err) {
            log.warn(`auto-release after wrong_trip failed: ${err.message}`)
        }
    }

    return {
        ok: true, ctx, page,
        postClickUrl, postClickShot,
        cartState, cartShot,
        cartText: cartText.slice(0, 1500),
        observed,
    }
}

// Add a single (campsiteId, siteNo, startDate, endDate) stay to the cart.
// Cold-launch path — opens a fresh browser per call. Use from the CLI; the
// watch loop should prefer warmCampspotWindow for sub-second fires.
export async function tryGrabCampsite({
    campgroundId,
    campsiteId,         // numeric — used in screenshots / logs
    siteNo,             // e.g. "068" — what the rec.gov aria-label says
    startDate,          // YYYY-MM-DD (first night)
    endDate,            // YYYY-MM-DD (checkout)
    dryRun = true,
    accountIndex = 1,
    log = console,
} = {}) {
    const acct = getAccount(accountIndex)
    const url = `https://www.recreation.gov/camping/campgrounds/${campgroundId}?startdate=${startDate}&enddate=${endDate}`
    log.info(`tryGrabCampsite: cg=${campgroundId} site=${siteNo} (${startDate} → ${endDate}) dryRun=${dryRun} acct=${accountIndex}(${acct.email})`)

    const shotsDir = path.resolve('./campspot-bot/.screenshots')
    await mkdir(shotsDir, { recursive: true })
    const screenshotPath = (label) =>
        path.resolve(`${shotsDir}/${Date.now()}-cg${campgroundId}-site${siteNo}-${label}.png`)

    const ctx = await launchCampspotContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3500)
        await handleLoginModalIfPresent(page, { log, accountIndex })
        await page.screenshot({ path: screenshotPath('01-loaded'), fullPage: true }).catch(() => {})
        return await performBookingFlow(ctx, page, {
            campgroundId, siteNo, startDate, endDate,
            dryRun, accountIndex, screenshotPath, log,
        })
    } catch (err) {
        log.error(`tryGrabCampsite error: ${err.message}`)
        try { await page.screenshot({ path: screenshotPath('err'), fullPage: true }) } catch {}
        return { ok: false, reason: err.message, ctx, page }
    }
}

// Warm window: pay the slow setup (browser launch, page load, login modal,
// session-cookie warming) ONCE up front and return a `hot()` function that
// reuses the same context for every fire. Saves ~6s per attempt vs cold
// launch — for a 15-min cart hold window where races are decided in seconds,
// this is the difference between getting the slot and watching it disappear.
//
// Caller must `close()` when done. `refresh()` reloads the campground page
// to keep the session warm during long idle periods.
//
// Returns { ctx, page, hot(stay), refresh(), close(), accountIndex, email }.
//   hot(stay) — stay = { siteNo, startDate, endDate, nights, ... }.
//                Returns the same shape as tryGrabCampsite.
export async function warmCampspotWindow({
    campgroundId,
    accountIndex = 1,
    log = console,
} = {}) {
    const acct = getAccount(accountIndex)
    const baseUrl = `https://www.recreation.gov/camping/campgrounds/${campgroundId}`
    const tag = `[warm acct${accountIndex}]`
    log.info(`${tag} launching warm window: ${acct.email} -> ${baseUrl}`)

    const ctx = await launchCampspotContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)
    const shotsDir = path.resolve('./campspot-bot/.screenshots')
    await mkdir(shotsDir, { recursive: true })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await handleLoginModalIfPresent(page, { log, accountIndex })
    await page.waitForTimeout(1000)

    // Confirm login state. If the header still shows "Sign Up / Log In" the
    // saved profile cookie expired — caller should run permit-bot login. We
    // don't bail (Add to Cart will trigger the modal handler), but we surface
    // the warning so the user can address it before race time.
    const hasLoginBtn = await page.evaluate(() => {
        const els = [...document.querySelectorAll('button, a')]
        return els.some(b => /sign up\s*\/\s*log in/i.test((b.textContent || '').trim()))
    })
    if (hasLoginBtn) {
        log.warn(`${tag} session NOT logged in — Add to Cart will trigger the rec.gov modal. Run "node permit-bot/permit-bot.mjs login" to refresh.`)
    } else {
        log.info(`${tag} logged-in session confirmed; warm window idling`)
    }

    const hot = async ({ siteNo, startDate, endDate }) => {
        const t0 = Date.now()
        const screenshotPath = (label) =>
            path.resolve(`${shotsDir}/${Date.now()}-cg${campgroundId}-site${siteNo}-warm-${label}.png`)
        const url = `${baseUrl}?startdate=${startDate}&enddate=${endDate}`
        log.info(`${tag} hot: ${siteNo} ${startDate}→${endDate}`)
        // Navigate the existing page — much faster than a cold launch because
        // cookies, DNS, and HTTP/2 connections all stay warm.
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
        } catch (err) {
            log.warn(`${tag} hot goto failed: ${err.message} — trying once more`)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
        }
        await page.waitForTimeout(1500)
        await handleLoginModalIfPresent(page, { log, accountIndex })
        const r = await performBookingFlow(ctx, page, {
            campgroundId, siteNo, startDate, endDate,
            dryRun: false, accountIndex, screenshotPath, log,
        })
        r.latencyMs = { total: Date.now() - t0 }
        log.info(`${tag} hot done in ${r.latencyMs.total}ms (state=${r.cartState ?? r.reason})`)
        return r
    }

    const refresh = async () => {
        log.info(`${tag} refresh: reloading campground page to keep session warm`)
        try {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            await page.waitForTimeout(1500)
            await handleLoginModalIfPresent(page, { log, accountIndex })
        } catch (err) {
            log.warn(`${tag} refresh failed: ${err.message}`)
        }
    }

    return {
        ctx, page, hot, refresh,
        close: () => ctx.close().catch(() => {}),
        accountIndex, email: acct.email,
        loggedIn: !hasLoginBtn,
    }
}

// Clear all holds for the given account. Used by tests so we can re-run
// against the same slot. Same hard rule as permit-bot: NEVER from watch mode.
export async function releaseCampspotCart({ accountIndex = 1, log = console } = {}) {
    const acct = getAccount(accountIndex)
    const ctx = await launchCampspotContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    let removed = 0
    let state = 'unknown'
    try {
        await page.goto('https://www.recreation.gov/cart', { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForTimeout(2500)
        await handleLoginModalIfPresent(page, { log, accountIndex })

        const selectors = [
            { role: 'button', name: /^remove$/i },
            { css: '[aria-label*="remove" i]' },
            { css: 'button:has-text("Remove")' },
        ]
        for (let pass = 0; pass < 5; pass++) {
            let clicked = false
            for (const sel of selectors) {
                const loc = sel.role
                    ? page.getByRole(sel.role, { name: sel.name }).first()
                    : page.locator(sel.css).first()
                if ((await loc.count()) === 0) continue
                try {
                    await loc.click({ timeout: 2000 })
                    clicked = true
                    removed++
                    await page.waitForTimeout(800)
                    const confirm = page.getByRole('button', { name: /^(remove|yes|confirm)$/i }).first()
                    if ((await confirm.count()) > 0) {
                        await confirm.click().catch(() => {})
                        await page.waitForTimeout(800)
                    }
                    break
                } catch {}
            }
            if (!clicked) break
        }
        const txt = await page.evaluate(() => document.body.innerText)
        state = /your cart is empty/i.test(txt) ? 'empty' : 'has_items'
        log.info(`releaseCampspotCart acct${accountIndex}: removed=${removed} state=${state}`)
    } catch (err) {
        log.error(`releaseCampspotCart failed: ${err.message}`)
    } finally {
        await ctx.close().catch(() => {})
    }
    return { removed, state, accountIndex, email: acct.email }
}
