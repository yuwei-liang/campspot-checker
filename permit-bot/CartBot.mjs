import { chromium } from 'playwright'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { resolveForChromium } from './dnsBypass.mjs'

const VIEWPORT = { width: 1400, height: 900 }
const HOSTS_TO_PIN = ['www.recreation.gov', 'recreation.gov']

// Account 1 keeps the legacy profile dir to preserve the existing login.
// Accounts 2..N get suffixed dirs. Credentials come from .env:
//   account 1: REC_EMAIL / REC_PASSWORD   (or REC_EMAIL_1 / REC_PASSWORD_1)
//   account N: REC_EMAIL_N / REC_PASSWORD_N
export function getAccount(accountIndex = 1) {
    const i = Number(accountIndex) || 1
    const profileDir = i === 1
        ? path.resolve('./permit-bot/.chromium-profile')
        : path.resolve(`./permit-bot/.chromium-profile-${i}`)
    const email = i === 1
        ? (process.env.REC_EMAIL_1 || process.env.REC_EMAIL)
        : process.env[`REC_EMAIL_${i}`]
    const password = i === 1
        ? (process.env.REC_PASSWORD_1 || process.env.REC_PASSWORD)
        : process.env[`REC_PASSWORD_${i}`]
    return { index: i, profileDir, email, password }
}

async function ensureDir(dir) {
    await mkdir(dir, { recursive: true })
}

// Find the trailhead row whose FIRST-cell text is exactly divisionName.
// hasText:substring would match a sibling row (e.g. "Cottonwood Creek" also
// matches a hypothetical "Cottonwood Creek (cross-country)" row); .first()
// then picks whichever sorts first in DOM order. Bug-magnet — verify exact.
async function findTrailheadRow(page, divisionName) {
    const rows = await page.locator('tr, [role="row"]').filter({ hasText: divisionName }).all()
    for (const r of rows) {
        // Take the row's first interactive cell or text node and exact-match.
        const firstButton = r.locator('button, [role="cell"], td').first()
        const txt = (await firstButton.innerText().catch(() => '')).trim()
        if (txt === divisionName) return r
    }
    // Fallback: previous behavior. Log the ambiguity so we notice if rec.gov
    // renames or adds a near-duplicate trailhead row.
    return null
}

// Build a persistent Chromium context for the given account. Headed so we can
// see what's happening and so the user can take over at any point. Each
// account gets its own profile dir so cookies/sessions don't collide.
async function launchContext({ headless = false, accountIndex = 1 } = {}) {
    const acct = getAccount(accountIndex)
    await ensureDir(acct.profileDir)

    // Pre-resolve recreation.gov via 1.1.1.1 / 8.8.8.8 and pin the IP into
    // Chromium with --host-resolver-rules. TLS SNI still uses the real hostname
    // so cert validation works. Without this, a flaky router DNS hands Chromium
    // ERR_NAME_NOT_RESOLVED even though direct upstream resolvers work fine.
    const rules = []
    for (const host of HOSTS_TO_PIN) {
        try {
            const ip = await resolveForChromium(host)
            rules.push(`MAP ${host} ${ip}`)
        } catch {
            // best-effort
        }
    }
    const args = [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=DnsOverHttps,AsyncDns',
    ]
    if (rules.length > 0) args.push(`--host-resolver-rules=${rules.join(',')}`)

    return chromium.launchPersistentContext(acct.profileDir, {
        headless,
        viewport: VIEWPORT,
        channel: undefined,
        args,
    })
}

// rec.gov has no dedicated /sign-in page — login is a modal triggered by a
// "Sign Up / Log In" button in the global header. This flow opens the homepage,
// auto-clicks that button to pop the modal, then watches for the button to
// disappear (which only happens after a successful login swaps the header to a
// user-menu). User just fills in email + password in the open modal.
export async function login({ log = console, accountIndex = 1 } = {}) {
    const acct = getAccount(accountIndex)
    log.info(`Opening browser for account ${accountIndex} (${acct.email || '<no email in env>'}) at ${acct.profileDir} ...`)
    const ctx = await launchContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    await page.goto('https://www.recreation.gov/', { waitUntil: 'domcontentloaded' })

    const loginButton = page.getByRole('button', { name: /sign up\s*\/\s*log in|log in/i }).first()
    try {
        await loginButton.waitFor({ state: 'visible', timeout: 15000 })
        await loginButton.click()
    } catch {
        log.warn('Could not auto-click the login button. Click it yourself in the open window.')
    }

    // If creds are in env, auto-fill + submit. Otherwise user types it.
    const { email, password } = acct
    if (email && password) {
        try {
            const emailInput = page.locator('input[type="email"], input[name*="email" i]').first()
            await emailInput.waitFor({ state: 'visible', timeout: 10000 })
            await emailInput.fill(email)
            const pwInput = page.locator('input[type="password"]').first()
            await pwInput.fill(password)
            const submit = page.getByRole('button', { name: /^log in$/i }).first()
            await submit.click()
            log.info('Auto-filled credentials and clicked Log In.')
        } catch (err) {
            log.warn(`Auto-fill failed (${err.message}). Complete the form manually.`)
        }
    } else {
        log.info(`No credentials in .env for account ${accountIndex} — fill the form manually.`)
    }

    log.info('Waiting up to 5 min for login to complete (button must disappear) ...')
    try {
        await page.waitForFunction(
            () => {
                const btns = [...document.querySelectorAll('button, a')]
                return !btns.some(b => /sign up\s*\/\s*log in/i.test((b.textContent || '').trim()))
            },
            null,
            { timeout: 5 * 60_000, polling: 1000 },
        )
        log.info('Login detected. Session saved to disk.')
    } catch {
        log.error('Timed out. If you actually finished login, the session is still saved — try check-session.')
    }
    await page.waitForTimeout(2000)
    await ctx.close()
}

// rec.gov sometimes pops the same login modal mid-flow (session expired, or
// the booking page requires a re-auth). Detect and auto-handle: if the modal
// is visible, fill creds + submit, wait for it to dismiss. Returns true if we
// handled a modal, false if there wasn't one.
export async function handleLoginModalIfPresent(page, { log = console, accountIndex = 1 } = {}) {
    const { email, password } = getAccount(accountIndex)
    if (!email || !password) return false

    // Telltale: modal heading "Log In to Recreation.gov" + password input.
    const heading = page.getByText(/log in to recreation\.gov/i).first()
    let visible = false
    try {
        visible = await heading.isVisible({ timeout: 1000 })
    } catch { visible = false }
    if (!visible) return false

    log.info('Login modal detected mid-flow — auto-filling creds.')
    try {
        const emailInput = page.locator('input[type="email"], input[name*="email" i]').first()
        await emailInput.waitFor({ state: 'visible', timeout: 5000 })
        await emailInput.fill(email)
        const pwInput = page.locator('input[type="password"]').first()
        await pwInput.fill(password)
        const submit = page.getByRole('button', { name: /^log in$/i }).first()
        await submit.click()
        // Wait for the modal heading to disappear.
        await page.waitForFunction(
            () => {
                const heads = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')]
                return !heads.some(h => /log in to recreation\.gov/i.test(h.textContent || ''))
            },
            null,
            { timeout: 15000, polling: 300 },
        )
        log.info('Login modal dismissed — back to flow.')
        return true
    } catch (err) {
        log.warn(`Auto-handle login modal failed: ${err.message}`)
        return false
    }
}

// Quick session check — loads the homepage and looks for the "Sign Up / Log In"
// button in the header. Present => not logged in. Absent => logged in.
export async function isLoggedIn({ log = console, accountIndex = 1 } = {}) {
    const ctx = await launchContext({ headless: true, accountIndex })
    try {
        const page = await ctx.newPage()
        await page.goto('https://www.recreation.gov/', {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
        })
        await page.waitForTimeout(2000)
        const hasLoginButton = await page.evaluate(() => {
            const els = [...document.querySelectorAll('button, a')]
            return els.some(b => /sign up\s*\/\s*log in/i.test((b.textContent || '').trim()))
        })
        return !hasLoginButton
    } catch (err) {
        log.error(`isLoggedIn check failed: ${err.message}`)
        return false
    } finally {
        await ctx.close()
    }
}

// The actual cart-grab flow. Opens the date-prefilled detail page, drives as
// much of the wizard as we can with stable-looking selectors, and STOPS at the
// cart hold (no payment). On any selector miss it pauses and leaves the page
// open for the user to take over.
export async function tryGrab({
    permitId,
    divisionId,
    divisionName,
    date,
    partySize,
    dryRun = false,
    accountIndex = 1,
    log = console,
}) {
    const url = `https://www.recreation.gov/permits/${permitId}/registration/detailed-availability` +
        `?type=overnight-permit&date=${date}`
    const acct = getAccount(accountIndex)
    log.info(`tryGrab: ${divisionName} on ${date} (party ${partySize}) account=${accountIndex}(${acct.email}) -> ${url}`)

    const ctx = await launchContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)

    const screenshotPath = (label) =>
        path.resolve(`./permit-bot/.screenshots/${Date.now()}-${label}.png`)
    await mkdir(path.resolve('./permit-bot/.screenshots'), { recursive: true })

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        log.info('Page goto returned; waiting 2s for hydration.')
        await page.waitForTimeout(2000)
        await handleLoginModalIfPresent(page, { log, accountIndex })
        await page.screenshot({ path: screenshotPath('01-after-load'), fullPage: true })
        log.info(`Title: "${await page.title()}" URL: ${page.url()}`)

        // Step 1: set group size. "Add Group Members" opens a popover with a
        // People stepper (- 0 +). Try multiple selector strategies because rec.gov
        // renders this as a custom button, not a native <select>.
        log.info('Step 1: locate group-members trigger')
        const groupTrigger = page.locator(
            'button:has-text("Add Group Members"), [placeholder*="Add Group" i], [aria-label*="Group" i]'
        ).first()
        await groupTrigger.waitFor({ state: 'visible', timeout: 15000 })
        log.info('Step 1a: click trigger')
        await groupTrigger.click()
        await page.screenshot({ path: screenshotPath('02-after-trigger-click'), fullPage: false })

        log.info('Step 1b: wait for stepper input (2s cap; rec.gov stepper is not a fillable input — fallback is normal)')
        const stepperInput = page.locator('input[type="number"], input[role="spinbutton"]').first()
        await stepperInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})

        let setOk = false
        if (await stepperInput.count() > 0) {
            try {
                log.info('Step 1c: fill stepper')
                await stepperInput.click({ clickCount: 3 }).catch(() => {})
                await stepperInput.fill(String(partySize))
                await stepperInput.press('Tab')
                setOk = true
            } catch (e) {
                log.warn(`Stepper fill failed: ${e.message}`)
            }
        }
        if (!setOk) {
            log.info('Step 1d: click + N times')
            // Exact aria-label — broad "add" matches "Add to Cart" etc.
            const plusBtn = page.locator('button[aria-label="Add Peoples"]').first()
            for (let i = 0; i < partySize; i++) {
                await plusBtn.click({ timeout: 2000 }).catch(() => {})
                await page.waitForTimeout(80)
            }
        }
        await page.screenshot({ path: screenshotPath('03-after-stepper'), fullPage: false })

        log.info('Step 1e: close popover')
        const closeBtn = page.getByRole('button', { name: /^(close|done|apply)$/i }).first()
        if (await closeBtn.count() > 0) {
            await closeBtn.click().catch(() => {})
        } else {
            await page.keyboard.press('Escape')
        }
        // Give the table a moment to repopulate after group size is set.
        await page.waitForTimeout(1500)
        log.info(`Set group size to ${partySize}.`)

        // Step 2: wait for the entry-points table to populate, then exact-match
        // the row. Substring-match is a bug magnet for sibling trailhead names.
        let row = null
        const rowDeadline = Date.now() + 20000
        while (Date.now() < rowDeadline && !row) {
            row = await findTrailheadRow(page, divisionName)
            if (!row) await page.waitForTimeout(500)
        }
        if (!row) {
            log.warn(`Row not found by exact match: ${divisionName}. Falling back to substring + first.`)
            row = page.locator('tr, [role="row"]').filter({ hasText: divisionName }).first()
            await row.waitFor({ state: 'visible', timeout: 5000 })
        }
        log.info(`Row visible: ${divisionName}`)

        // Step 3: find the cell for our SPECIFIC date. rec.gov's cell buttons
        // carry aria-labels like "FRI 19\nPeople:  12 out of 12" when bookable,
        // or "No online reservations available" when not. Match the
        // "<WEEKDAY-ABBREV> <DAY>" prefix and require the visible count > 0.
        const [y, m, d] = date.split('-').map(Number)
        const weekday = new Date(Date.UTC(y, m - 1, d))
            .toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })
            .toUpperCase() // e.g. "FRI"
        const datePattern = new RegExp(`\\b${weekday}\\s+${d}\\b`)
        log.info(`Step 3: looking for cell matching /${datePattern.source}/`)

        const findMatchingCell = async () => {
            const cells = await row.locator('button').all()
            for (const c of cells) {
                const label = (await c.getAttribute('aria-label')) || ''
                if (!datePattern.test(label)) continue
                if (/no online reservations/i.test(label)) continue
                const txt = (await c.innerText().catch(() => '')).trim()
                if (txt === '0' || txt === '') continue
                return { handle: c, label, txt }
            }
            return null
        }

        let match = await findMatchingCell()
        let advances = 0
        while (!match && advances < 6) {
            const nextBtn = page.getByRole('button', { name: /next 5 days/i }).first()
            if (await nextBtn.count() === 0) break
            log.info(`Step 3a: target date not visible, clicking "Next 5 Days" (${advances + 1}/6)`)
            await nextBtn.click()
            await page.waitForTimeout(800)
            advances++
            match = await findMatchingCell()
        }

        if (!match) {
            log.warn('No bookable cell for target date. Screenshotting + leaving page open.')
            await page.screenshot({ path: screenshotPath('no-matching-cell'), fullPage: true })
            return { ok: false, reason: 'no_matching_cell', page, ctx }
        }
        const dateCell = match.handle
        log.info(`Step 3b: matched cell aria-label=${JSON.stringify(match.label)} text=${JSON.stringify(match.txt)}`)

        if (dryRun) {
            log.info('[dry-run] Group + row + cell all located. Not clicking.')
            await page.screenshot({ path: screenshotPath('dryrun-located'), fullPage: true })
            return { ok: true, dryRun: true, page, ctx }
        }

        await dateCell.click()
        log.info('Clicked Available cell.')

        // Step 4: click "Book Now" at bottom — becomes enabled after a cell is selected.
        const bookButton = page.getByRole('button', { name: /^book now$/i }).first()
        await bookButton.waitFor({ state: 'visible', timeout: 10000 })
        // The button starts disabled (grey). Wait for it to become enabled.
        await page.waitForFunction(
            () => {
                const btns = [...document.querySelectorAll('button')]
                const b = btns.find(x => /^book now$/i.test(x.textContent?.trim() || ''))
                return b && !b.disabled && !b.getAttribute('aria-disabled')?.match(/true/i)
            },
            null,
            { timeout: 10000, polling: 250 },
        ).catch(() => log.warn('Book Now did not become enabled in time, clicking anyway.'))
        await bookButton.click()
        log.info('Clicked Book Now — wizard is yours now.')
        // Give the page time to navigate or open the wizard.
        await page.waitForTimeout(3500)
        // rec.gov frequently demands a re-auth at this checkpoint; handle it.
        await handleLoginModalIfPresent(page, { log, accountIndex })
        await page.waitForTimeout(2500)
        const postClickUrl = page.url()
        log.info(`Post-Book-Now URL: ${postClickUrl}`)
        const postClickShot = screenshotPath('04-post-book-click')
        await page.screenshot({ path: postClickShot, fullPage: true })

        // Independently check the cart in a separate tab. If the slot is held,
        // /cart will show the trailhead + date with a countdown.
        let cartState = 'unknown'
        let cartShot = null
        let cartItems = []
        try {
            const cartPage = await ctx.newPage()
            await cartPage.goto('https://www.recreation.gov/cart', {
                waitUntil: 'domcontentloaded',
                timeout: 20000,
            })
            await cartPage.waitForTimeout(2500)
            cartShot = screenshotPath('05-cart')
            await cartPage.screenshot({ path: cartShot, fullPage: true })
            const cartText = await cartPage.evaluate(() => document.body.innerText)
            if (/your cart is empty/i.test(cartText)) {
                cartState = 'empty'
            } else if (cartText.toLowerCase().includes(divisionName.toLowerCase())) {
                cartState = 'held'
                cartItems = [divisionName]
            } else if (/cart/i.test(cartText)) {
                cartState = 'has_items_but_not_target'
            }
            log.info(`Cart state: ${cartState}`)
        } catch (err) {
            log.warn(`Cart check failed: ${err.message}`)
        }

        return {
            ok: true,
            page,
            ctx,
            postClickUrl,
            postClickShot,
            cartState,
            cartShot,
            cartItems,
        }
    } catch (err) {
        log.error(`tryGrab error: ${err.message}`)
        try { await page.screenshot({ path: screenshotPath('error'), fullPage: true }) } catch {}
        return { ok: false, reason: err.message, page, ctx }
    }
}

// Visits /cart for the given account and clicks every Remove button. Used to
// clean up test cart holds so we can re-run tests against the same slot.
// IMPORTANT: only ever call this from explicit test paths — NEVER from watch
// mode, where releasing a hold could throw away the slot the user just won.
export async function releaseCart({ accountIndex = 1, log = console } = {}) {
    const acct = getAccount(accountIndex)
    const tag = `[release acct${accountIndex}]`
    log.info(`${tag} opening cart for ${acct.email}`)
    const ctx = await launchContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    let removed = 0
    let state = 'unknown'
    try {
        await page.goto('https://www.recreation.gov/cart', {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
        })
        await page.waitForTimeout(2500)
        await handleLoginModalIfPresent(page, { log, accountIndex })

        // rec.gov cart shows "Modify" inline; the actual remove is typically a
        // small "X" / trash icon, OR inside a Modify→cancel flow. We try
        // multiple selectors in order: explicit Remove text, trash/x aria, then
        // Modify-then-cancel.
        const trySelectors = [
            { role: 'button', name: /^remove$/i },
            { css: '[aria-label*="remove" i]' },
            { css: '[aria-label*="delete" i]' },
            { css: '[aria-label*="trash" i]' },
            { css: 'button:has-text("Remove")' },
        ]
        for (let pass = 0; pass < 5; pass++) {
            let clicked = false
            for (const sel of trySelectors) {
                const loc = sel.role
                    ? page.getByRole(sel.role, { name: sel.name }).first()
                    : page.locator(sel.css).first()
                if (await loc.count() === 0) continue
                try {
                    await loc.click({ timeout: 2000 })
                    clicked = true
                    removed++
                    log.info(`${tag} clicked remove via ${JSON.stringify(sel)}`)
                    await page.waitForTimeout(800)
                    const confirmBtn = page.getByRole('button', { name: /^(remove|yes|confirm)$/i }).first()
                    if (await confirmBtn.count() > 0) {
                        await confirmBtn.click().catch(() => {})
                        await page.waitForTimeout(800)
                    }
                    break
                } catch {}
            }
            if (!clicked) {
                // Fallback: dump button text for debugging the first time only.
                if (pass === 0) {
                    const btnTexts = await page.evaluate(() => {
                        return [...document.querySelectorAll('button, a')]
                            .map(b => ({
                                text: (b.textContent || '').trim().slice(0, 40),
                                aria: b.getAttribute('aria-label'),
                            }))
                            .filter(x => x.text || x.aria)
                            .slice(0, 30)
                    })
                    log.info(`${tag} no remove button found. Visible buttons: ${JSON.stringify(btnTexts).slice(0, 800)}`)
                    await page.screenshot({
                        path: path.resolve(`./permit-bot/.screenshots/${Date.now()}-acct${accountIndex}-cart-debug.png`),
                        fullPage: true,
                    }).catch(() => {})
                }
                break
            }
        }
        await page.waitForTimeout(1000)
        const txt = await page.evaluate(() => document.body.innerText)
        state = /your cart is empty/i.test(txt) ? 'empty' : 'has_items'
        log.info(`${tag} done — removed=${removed} final=${state}`)
    } catch (err) {
        log.error(`${tag} releaseCart failed: ${err.message}`)
    } finally {
        await ctx.close().catch(() => {})
    }
    return { removed, state, accountIndex, email: acct.email }
}

// Warm-cart mode: pay the slow setup (browser launch, page load, group size
// click) UP FRONT, then return a `hot()` function that does only the fast
// path on demand. Hot path is essentially: click cell + click Book Now.
// Returns { ctx, page, hot(divisionName, date) }. Caller must close ctx.
export async function warmCart({
    permitId,
    date,
    partySize,
    accountIndex = 1,
    log = console,
}) {
    const url = `https://www.recreation.gov/permits/${permitId}/registration/detailed-availability` +
        `?type=overnight-permit&date=${date}`
    const acct = getAccount(accountIndex)
    const tag = `[warm acct${accountIndex}]`
    log.info(`${tag} launching warm cart: ${acct.email} -> ${url}`)

    const ctx = await launchContext({ headless: false, accountIndex })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)
    await mkdir(path.resolve('./permit-bot/.screenshots'), { recursive: true })

    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await handleLoginModalIfPresent(page, { log, accountIndex })

    // Set group size (same approach as tryGrab — rec.gov's input is not fillable
    // so we click "+" partySize times).
    const groupTrigger = page.locator(
        'button:has-text("Add Group Members"), [placeholder*="Add Group" i], [aria-label*="Group" i]'
    ).first()
    await groupTrigger.waitFor({ state: 'visible', timeout: 15000 })
    await groupTrigger.click()
    await page.waitForTimeout(500)
    // rec.gov's popover stepper buttons are aria-label="Add Peoples" / "Remove Peoples".
    // (Verified 2026-06-11 via probe-popover.mjs.) The "input" between them is a
    // text display, not an editable field — buttons are the only mechanism.
    const plusBtn = page.locator('button[aria-label="Add Peoples"]').first()
    for (let i = 0; i < partySize; i++) {
        await plusBtn.click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(60)
    }
    const closeBtn = page.getByRole('button', { name: /^(close|done|apply)$/i }).first()
    if (await closeBtn.count() > 0) await closeBtn.click().catch(() => {})
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
    log.info(`${tag} warm setup complete: group=${partySize}, idle on page.`)

    // currentParty is mutable: when a hot() call detects overcap (cell exists
    // but slot count < currentParty), we DOWNGRADE on the fly via the popover,
    // grab whatever's available, and report back the actual party size we got.
    // The soldier on the field decides — no waiting for HQ's next poll cycle.
    let currentParty = partySize

    // Open the group popover, click "-" decrement times, close. Used to drop
    // currentParty when a target date has fewer slots than we asked for.
    const adjustPartyTo = async (newParty) => {
        const decrement = currentParty - newParty
        if (decrement <= 0) return false
        log.info(`${tag} adjusting party ${currentParty} → ${newParty}`)
        // After setup, the trigger text changes from "Add Group Members" to
        // the count summary. Match a few possible forms; if first() picks
        // anything else, the click is harmless (popover's already-closed
        // anyway). Verified safe selectors: "Group Members" text, group-related
        // aria-label, or the "People" pill that displays the count.
        const trigger = page.locator(
            'button:has-text("Group Member"), button:has-text("Group Members"), button:has-text("People"), [aria-label*="Group Member" i]'
        ).first()
        try {
            await trigger.waitFor({ state: 'visible', timeout: 3000 })
            await trigger.click()
        } catch {
            log.warn(`${tag} couldn't reopen group popover`)
            return false
        }
        await page.waitForTimeout(300)
        // EXACT aria-label match — the broad "decrease/decrement/subtract"
        // selector wrongly hit the "Prev 5 Days" calendar button and shifted
        // the date instead of dropping the party. The popover button is
        // aria-label="Remove Peoples". (verified via probe-popover.mjs)
        const minusBtn = page.locator('button[aria-label="Remove Peoples"]').first()
        for (let i = 0; i < decrement; i++) {
            await minusBtn.click({ timeout: 1500 }).catch(() => {})
            await page.waitForTimeout(40)
        }
        const close = page.getByRole('button', { name: /^(close|done|apply)$/i }).first()
        if (await close.count() > 0) await close.click().catch(() => {})
        else await page.keyboard.press('Escape')
        await page.waitForTimeout(700) // table re-renders cells against new party
        currentParty = newParty
        return true
    }

    // The hot path — to be called the instant a slot is detected open.
    const hot = async (divisionName, date) => {
        const t0 = Date.now()
        const screenshotPath = (label) =>
            path.resolve(`./permit-bot/.screenshots/${Date.now()}-acct${accountIndex}-${label}.png`)
        const baseMeta = { accountIndex, email: acct.email }

        // Exact-match row (same defensive pattern as cold tryGrab).
        let row = await findTrailheadRow(page, divisionName)
        if (!row) {
            // Fallback only if exact-match doesn't find anything within 5s.
            const fallbackDeadline = Date.now() + 5000
            while (Date.now() < fallbackDeadline && !row) {
                await page.waitForTimeout(300)
                row = await findTrailheadRow(page, divisionName)
            }
        }
        if (!row) {
            await page.screenshot({ path: screenshotPath('hot-fail-no-row'), fullPage: true }).catch(() => {})
            return { ok: false, reason: 'row_not_visible', latencyMs: Date.now() - t0, ...baseMeta }
        }

        const [y, m, d] = date.split('-').map(Number)
        const weekday = new Date(Date.UTC(y, m - 1, d))
            .toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })
            .toUpperCase()
        const datePattern = new RegExp(`\\b${weekday}\\s+${d}\\b`)

        const findCell = async () => {
            const cells = await row.locator('button').all()
            for (const c of cells) {
                const label = (await c.getAttribute('aria-label')) || ''
                if (!datePattern.test(label)) continue
                if (/no online reservations/i.test(label)) continue
                const txt = (await c.innerText().catch(() => '')).trim()
                if (txt === '0' || txt === '') continue
                return { handle: c, label, txt }
            }
            return null
        }
        // findCellByPosition: when the page filter has disabled the target cell
        // (party > available), the cell aria-label flips to "No online
        // reservations available" but the visible text still shows the actual
        // remaining count. We need a way to locate the FRI 19 cell anyway. Use
        // an "anchor" cell — any cell in the row still showing its weekday/day
        // — to map column index to date and compute the target index.
        const findCellByPosition = async () => {
            const cells = await row.locator('button').all()
            // Find an anchor: any cell whose aria-label still carries weekday+day.
            let anchorIdx = -1
            let anchorDay = -1
            for (let i = 1; i < cells.length; i++) {
                const lbl = (await cells[i].getAttribute('aria-label')) || ''
                const m = lbl.match(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})\b/)
                if (m) { anchorIdx = i; anchorDay = Number(m[1]); break }
            }
            if (anchorIdx < 0) return null
            // Assume same month (visible window is ~10 days). Compute offset.
            const targetIdx = anchorIdx + (d - anchorDay)
            if (targetIdx < 1 || targetIdx >= cells.length) return null
            const c = cells[targetIdx]
            const lbl = (await c.getAttribute('aria-label')) || ''
            const txt = (await c.innerText().catch(() => '')).trim()
            return { handle: c, label: lbl, txt, idx: targetIdx }
        }

        // OVERCAP CHECK: when findCell() fails, the slot might still EXIST but
        // be hidden behind a party-size filter. Read the actual cell's text; if
        // > 0, downgrade party on the fly and retry. This is the "autonomous
        // soldier" path — grab whatever we can without waiting for HQ.
        const tryOvercapAdjust = async () => {
            const target = await findCellByPosition()
            if (!target) return false
            const remaining = Number.parseInt(target.txt, 10)
            if (!Number.isFinite(remaining) || remaining <= 0) return false
            if (!/no online reservations/i.test(target.label)) return false
            log.info(`${tag} OVERCAP detected at cell[${target.idx}]: txt="${target.txt}" → adjusting party ${currentParty} → ${remaining}`)
            const ok = await adjustPartyTo(Math.min(remaining, currentParty))
            return ok
        }

        let match = await findCell()
        if (!match && await tryOvercapAdjust()) {
            match = await findCell()
            if (match) log.info(`${tag} OVERCAP recovered: matched ${JSON.stringify(match.label)} at party=${currentParty}`)
        }
        let advances = 0
        while (!match && advances < 6) {
            const next = page.getByRole('button', { name: /next 5 days/i }).first()
            if (await next.count() === 0) break
            await next.click()
            await page.waitForTimeout(400)
            advances++
            match = await findCell()
            if (!match && await tryOvercapAdjust()) match = await findCell()
        }
        if (!match) {
            await page.screenshot({ path: screenshotPath('hot-fail-no-cell'), fullPage: true }).catch(() => {})
            return { ok: false, reason: 'no_matching_cell', latencyMs: Date.now() - t0, ...baseMeta }
        }
        log.info(`${tag} matched cell ${JSON.stringify(match.label)} at currentParty=${currentParty}`)

        await match.handle.click()
        const book = page.getByRole('button', { name: /^book now$/i }).first()
        await book.waitFor({ state: 'visible', timeout: 5000 })
        await page.waitForFunction(
            () => {
                const btns = [...document.querySelectorAll('button')]
                const b = btns.find(x => /^book now$/i.test(x.textContent?.trim() || ''))
                return b && !b.disabled && !b.getAttribute('aria-disabled')?.match(/true/i)
            },
            null,
            { timeout: 5000, polling: 100 },
        ).catch(() => {})
        await book.click()
        const tBook = Date.now() - t0
        log.info(`${tag} clicked Book Now at +${tBook}ms`)

        // Post-click flow (modal handling, cart check) — still inside the hot
        // path so the timing reflects "click to confirmed".
        await page.waitForTimeout(2500)
        await handleLoginModalIfPresent(page, { log, accountIndex })
        await page.waitForTimeout(2000)
        const postClickUrl = page.url()
        const postShot = screenshotPath('hot-post-book')
        await page.screenshot({ path: postShot, fullPage: true }).catch(() => {})

        let cartState = 'unknown'
        let cartShot = null
        try {
            const cartPage = await ctx.newPage()
            await cartPage.goto('https://www.recreation.gov/cart', {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
            })
            await cartPage.waitForTimeout(2000)
            cartShot = screenshotPath('hot-cart')
            await cartPage.screenshot({ path: cartShot, fullPage: true }).catch(() => {})
            const cartText = await cartPage.evaluate(() => document.body.innerText)
            if (/your cart is empty/i.test(cartText)) cartState = 'empty'
            else if (cartText.toLowerCase().includes(divisionName.toLowerCase())) cartState = 'held'
            else if (/cart/i.test(cartText)) cartState = 'has_items_but_not_target'
            await cartPage.close().catch(() => {})
        } catch (err) {
            log.warn(`${tag} cart check failed: ${err.message}`)
        }

        const totalMs = Date.now() - t0
        return {
            ok: true,
            cartState,
            postClickUrl,
            postShot,
            cartShot,
            latencyMs: { bookClick: tBook, total: totalMs },
            accountIndex,
            email: acct.email,
            // Actual party committed (after any overcap downgrade). May be <
            // the originally-requested partySize. Caller should use this for
            // partyAcquired arithmetic, not the planned shot.party.
            actualParty: currentParty,
            originalParty: partySize,
        }
    }

    return { ctx, page, hot, accountIndex, email: acct.email }
}
