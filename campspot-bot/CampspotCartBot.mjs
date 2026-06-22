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

// One-shot: navigate to /cart in a fresh tab and read the body text to verify
// the hold. Returns { state: 'held' | 'empty' | 'has_items_but_not_target' |
// 'unknown', cartText, cartShot }.
//
// rec.gov cart format (verified 2026-06-22 by a real auto-grab):
//   "192, Upper Pines RV NONELECTRIC"
//   "Check-In Date: Sun Sep 13, 2026"
// So we match site number + a human-formatted date ("Sep 13") rather than the
// ISO start date. Two-signal AND-match avoids false-positives from a stale
// prior hold for a different (site, date).
async function verifyCartHold(ctx, { siteNo, startDate, endDate, screenshotPath }) {
    const cartPage = await ctx.newPage()
    let cartShot = null
    let state = 'unknown'
    let cartText = ''
    try {
        await cartPage.goto('https://www.recreation.gov/cart', { waitUntil: 'domcontentloaded', timeout: 20000 })
        await cartPage.waitForTimeout(2500)
        cartShot = screenshotPath('cart')
        await cartPage.screenshot({ path: cartShot, fullPage: true })
        cartText = await cartPage.evaluate(() => document.body.innerText)
        const lower = cartText.toLowerCase()
        const [sy, sm, sd] = startDate.split('-').map(Number)
        const humanDate = `${MONTH_NAMES[sm - 1]} ${sd}, ${sy}`.toLowerCase()
        const sitePattern = new RegExp(`(?:^|\\W)${siteNo.replace(/^0+/, '0*')}(?:,|\\s)`, 'i')
        if (/your cart is empty/i.test(cartText)) state = 'empty'
        else if (sitePattern.test(cartText) && lower.includes(humanDate)) state = 'held'
        else if (/cart/i.test(cartText)) state = 'has_items_but_not_target'
    } finally {
        await cartPage.close().catch(() => {})
    }
    return { state, cartText, cartShot }
}

// Add a single (campsiteId, siteNo, startDate, endDate) stay to the cart.
// `dryRun` stops just before clicking "Add to Cart" — useful for selector
// validation against arbitrary dates without polluting the user's cart.
// `endDate` is the checkout date (one day after the last night).
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
        await page.screenshot({ path: screenshotPath('01-loaded'), fullPage: true })

        // Step 1: advance calendar to startDate (the grid shows ~10 days, so a
        // Sept date may need 12+ next-clicks from today).
        log.info('Step 1: advance calendar grid to target date')
        const advanced = await advanceCalendarTo(page, startDate, { log, maxAdvances: 60 })
        if (!advanced) {
            await page.screenshot({ path: screenshotPath('err-no-date'), fullPage: true })
            return { ok: false, reason: 'date_not_in_grid', ctx, page }
        }

        // Step 2: find the available cell for site + start date.
        log.info(`Step 2: find available cell for site ${siteNo}`)
        const cell = await findAvailableCell(page, { siteNo, date: startDate })
        if (!cell) {
            log.warn(`No Available cell for site ${siteNo} on ${startDate} — slot likely just got taken`)
            await page.screenshot({ path: screenshotPath('err-no-avail'), fullPage: true })
            return { ok: false, reason: 'cell_not_available', ctx, page }
        }
        await cell.scrollIntoViewIfNeeded().catch(() => {})

        if (dryRun) {
            log.info('[dry-run] Cell located, NOT clicking.')
            await page.screenshot({ path: screenshotPath('dryrun-located'), fullPage: true })
            return { ok: true, dryRun: true, ctx, page }
        }

        // Step 3: click the start cell to select the site for this trip range.
        log.info('Step 3: click Available cell')
        await cell.click()
        await page.waitForTimeout(1500)
        await page.screenshot({ path: screenshotPath('02-after-cell-click'), fullPage: true })

        // Step 4: click "Add to Cart". The button appears after the cell click
        // and may briefly be disabled while the page settles.
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
        await page.screenshot({ path: postClickShot, fullPage: true })
        log.info(`Post-Add URL: ${postClickUrl}`)

        // Step 5: verify the hold by visiting /cart in a fresh tab.
        log.info('Step 5: verify cart')
        const { state: cartState, cartText, cartShot } = await verifyCartHold(ctx, {
            siteNo,
            startDate,
            endDate,
            screenshotPath,
        })
        log.info(`Cart state: ${cartState}`)

        return {
            ok: true,
            ctx,
            page,
            postClickUrl,
            postClickShot,
            cartState,
            cartShot,
            cartText: cartText.slice(0, 1500),
        }
    } catch (err) {
        log.error(`tryGrabCampsite error: ${err.message}`)
        try { await page.screenshot({ path: screenshotPath('err'), fullPage: true }) } catch {}
        return { ok: false, reason: err.message, ctx, page }
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
