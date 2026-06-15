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

// Find the trailhead row in rec.gov's DOM.
//
// rec.gov layout (probed 2026-06-12):
//   div[role="row"][data-component="Row"] class="rec-grid-row"
//     div[role="gridcell"][data-component="GridCell"]
//       button[data-component="Button"][aria-label="<full trailhead name>"]
//         > the name button (text shown to user in column 1)
//     div[role="gridcell"] (one per date)
//       button[aria-label="<weekday> <day>, ..."]
//         > the availability cell
//
// The 2026-06-12 race-day failure: we matched by full-string substring on the
// row's innerText. Config had "Happy Isles -> Little Yosemite Valley (No
// Donohue)" but the page has "Happy Isles->Little Yosemite Valley (No Donohue
// Pass)" — different whitespace + missing word. hasText filter returned 0
// rows. Fix: token-based aria-label match. Robust to whitespace, extra words,
// and most copy edits as long as the tokens stay anchor concepts.
//
// Token strategy: pass nameTokens like ["Happy Isles", "Little Yosemite
// Valley"]. We find buttons whose aria-label contains ALL tokens, then walk
// up to the row. Specific enough to distinguish from sibling rows (e.g.
// "Happy Isles->Illilouette" lacks "Little Yosemite Valley" → no match).
export async function findRowByTokens(page, nameTokens) {
    if (!Array.isArray(nameTokens) || nameTokens.length === 0) return null
    // Build a button selector requiring every token in aria-label.
    const ariaSel = nameTokens
        .map(t => `[aria-label*="${t.replace(/"/g, '\\"')}"]`)
        .join('')
    const button = page.locator(`button${ariaSel}`).first()
    if (await button.count() === 0) return null
    // Walk up to the enclosing row.
    const row = button.locator('xpath=ancestor::*[@role="row"][1]')
    if (await row.count() === 0) return null
    return row
}

// Structured inventory of every trailhead name visible on the page right now.
// rec.gov uses <button data-component="Button" aria-label="<full name>"> for
// each trailhead row. We dedupe (a name may appear multiple times in the DOM
// from nested re-renders) and return a sorted list.
//
// Logged at warm-time. If a future race fails with row_not_visible, the
// session log holds a snapshot of EXACTLY what was on the page — no need to
// re-derive from screenshots.
export async function getTrailheadInventory(page) {
    try {
        return await page.evaluate(() => {
            const names = new Set()
            for (const b of document.querySelectorAll('button[aria-label]')) {
                const label = b.getAttribute('aria-label') || ''
                // Filter to trailhead-row buttons. Excludes date cells (which
                // have labels like "FRI 19, People: 12 out of 12") and the
                // group-size popover buttons.
                if (
                    label.length > 8 &&
                    !/^(FRI|SAT|SUN|MON|TUE|WED|THU)\s+\d/i.test(label) &&
                    !/no online reservations/i.test(label) &&
                    !/not yet released/i.test(label) &&
                    !/add|remove|group|peoples|next|prev/i.test(label)
                ) {
                    names.add(label)
                }
            }
            return [...names].sort()
        })
    } catch {
        return []
    }
}

// Per-target presence check (warm-time sanity check). For each target,
// asks findTrailheadRow whether the row exists; returns
// [{divisionId, name, ok, strategy}, ...]. Caller logs/alerts on `ok:false`.
// Extracted from warmCart for direct testability.
export async function checkExpectedRows(page, targets, log = console) {
    const results = []
    for (const t of targets) {
        const { row, strategy } = await findTrailheadRow(page, t)
        const ok = !!row
        results.push({
            divisionId: t.divisionId,
            name: t.name,
            ok,
            strategy: strategy || 'none',
        })
        log.info?.(`row-check ${t.name}: ${ok ? `OK (${strategy})` : 'MISSING'}`)
    }
    return results
}

// Find a trailhead row; if it isn't in the DOM, call `reloadAndResetup`
// (which should reload the page + redo group-size) and try once more,
// then poll-fallback for up to 5s for any final SPA re-render lag.
//
// This is the 2026-06-12 race-day fix: the warm browser's DOM was stale
// (the SPA didn't re-fetch when backend availability flipped 0→non-zero),
// and the old code just polled the SAME stale DOM for 5 seconds. Now we
// FORCE a fresh fetch on first miss.
//
// Returns { row: Locator|null, strategy, didReload }.
//
// Extracted from warmCart.hot() for direct testability.
export async function findRowWithReloadRecovery(page, target, reloadAndResetup, log = console) {
    let didReload = false
    let result = await findTrailheadRow(page, target)
    if (!result.row) {
        log.warn?.('hot: row not in DOM, reloading page to refresh SPA state ...')
        try {
            await reloadAndResetup()
            didReload = true
            result = await findTrailheadRow(page, target)
        } catch (err) {
            log.warn?.(`hot: reload path failed: ${err.message}`)
        }
    }
    if (!result.row) {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline && !result.row) {
            await page.waitForTimeout(300)
            result = await findTrailheadRow(page, target)
        }
    }
    return { ...result, didReload }
}

// Position-based cell finder for the OPTIMISTIC CLICK strategy (06-14 fix).
// When the API says stock is open but every visible cell shows NR (stale
// DOM or race-too-fast), we still need a clickable button at the right
// column. This function anchors on any sibling cell whose aria-label still
// carries the weekday+day pair, computes the target's column index, and
// returns that button's handle regardless of label or text. Caller is
// expected to click optimistically — backend POST is the source of truth.
export async function findCellByPositionInRow(row, date) {
    const [, , d] = date.split('-').map(Number)
    const cells = await row.locator('button').all()
    // Find an anchor: any cell whose aria-label still carries weekday+day.
    // Start at i=1 to skip the trailhead-name button at index 0.
    let anchorIdx = -1
    let anchorDay = -1
    for (let i = 1; i < cells.length; i++) {
        const lbl = (await cells[i].getAttribute('aria-label')) || ''
        const m = lbl.match(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})\b/)
        if (m) { anchorIdx = i; anchorDay = Number(m[1]); break }
    }
    if (anchorIdx < 0) return null
    // Same-month assumption: visible window is ~10 days; column offset = day delta.
    const targetIdx = anchorIdx + (d - anchorDay)
    if (targetIdx < 1 || targetIdx >= cells.length) return null
    const c = cells[targetIdx]
    const lbl = (await c.getAttribute('aria-label')) || ''
    const txt = (await c.innerText().catch(() => '')).trim()
    return { handle: c, label: lbl, txt, idx: targetIdx }
}

// Pure DOM cell-finder. Locates the bookable cell in `row` for `date`. Returns
// { handle, label, txt } or null. Exported so the reload-recovery wrapper can
// be tested without dragging in the whole hot() closure.
export async function findBookableCellInRow(row, date) {
    const [y, m, d] = date.split('-').map(Number)
    const weekday = new Date(Date.UTC(y, m - 1, d))
        .toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })
        .toUpperCase()
    const datePattern = new RegExp(`\\b${weekday}\\s+${d}\\b`)
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

// 06-13 fix: when the API says stock opened but the warm DOM still shows every
// cell as "No online reservations" (rec.gov's SPA didn't repaint after the 7am
// flip), reload once and re-look. `refindRow` is called after the reload to
// rebind the row locator against the fresh DOM.
//
// Returns { match, didReload, row } where `row` is the post-reload row when we
// reloaded (caller may want to rebind), else the original row.
export async function findCellWithReloadRecovery({
    page,
    row,
    date,
    reloadAndResetup,
    refindRow,
    log = console,
}) {
    let match = await findBookableCellInRow(row, date)
    if (match) return { match, didReload: false, row }
    log.warn?.('hot: no bookable cell on warm DOM — reloading once (stale-DOM recovery)')
    try {
        await reloadAndResetup()
    } catch (err) {
        log.warn?.(`hot: stale-DOM reload threw: ${err.message}`)
        return { match: null, didReload: false, row }
    }
    const freshRow = await refindRow()
    if (!freshRow) {
        log.warn?.('hot: row not found after stale-DOM reload')
        return { match: null, didReload: true, row: null }
    }
    match = await findBookableCellInRow(freshRow, date)
    return { match, didReload: true, row: freshRow }
}

// Legacy name-based finder. Kept as a SECOND-CHANCE fallback only — robust
// matching now lives in findRowByTokens. Callers should prefer tokens.
async function findTrailheadRowByName(page, divisionName) {
    const rows = await page.locator('tr, [role="row"]').filter({ hasText: divisionName }).all()
    for (const r of rows) {
        const firstButton = r.locator('button, [role="cell"], td').first()
        const txt = (await firstButton.innerText().catch(() => '')).trim()
        if (txt === divisionName) return r
    }
    return null
}

// Unified finder: tokens first (preferred), then name fallback. Returns
// { row, strategy } where strategy is 'tokens' | 'name' | null. The strategy
// is logged so we notice if we silently fell back to the fragile path.
export async function findTrailheadRow(page, target) {
    // Back-compat: original callers passed a bare string for divisionName.
    if (typeof target === 'string') {
        const row = await findTrailheadRowByName(page, target)
        return row ? { row, strategy: 'name' } : { row: null, strategy: null }
    }
    if (target?.nameTokens?.length) {
        const row = await findRowByTokens(page, target.nameTokens)
        if (row) return { row, strategy: 'tokens' }
    }
    if (target?.name) {
        const row = await findTrailheadRowByName(page, target.name)
        if (row) return { row, strategy: 'name' }
    }
    return { row: null, strategy: null }
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

// Drive an already-loaded rec.gov page through the verify flow: set party
// size (best-effort — handlers may already be detached in static fixtures),
// wait for content to settle, then row-check each target via findTrailheadRow.
//
// Extracted from verifyConfigOnce so tests can drive it against route-mocked
// pages without paying for a full BrowserContext / saved profile.
//
// `timeouts` allows tests to shrink the popover/content waits since static
// fixtures never satisfy them and a 12s real-world timeout becomes 12s of
// dead-air per test. Defaults match production.
export async function verifyConfigOnPage(page, partySize, targets, log = console, timeouts = {}) {
    const { triggerWaitMs = 12000, plusClickMs = 1500, bodyContentMs = 15000 } = timeouts
    const errors = []
    const perTarget = []
    try {
        // Best-effort group-size setup. rec.gov filters trailheads by
        // party-size availability — without this the table may not fully
        // render. In test/mock mode the popover JS isn't attached, so clicks
        // are no-ops; we tolerate that and proceed to the row check.
        const trigger = page.locator(
            'button:has-text("Add Group Members"), [aria-label*="Group" i]'
        ).first()
        try {
            await trigger.waitFor({ state: 'visible', timeout: triggerWaitMs })
            await trigger.click()
            await page.waitForTimeout(400)
            const plus = page.locator('button[aria-label="Add Peoples"]').first()
            for (let i = 0; i < partySize; i++) {
                await plus.click({ timeout: plusClickMs }).catch(() => {})
                await page.waitForTimeout(50)
            }
            await page.keyboard.press('Escape')
            await page.waitForTimeout(1200)
        } catch {
            // Static fixture / mocked page — popover trigger may not be
            // present or clickable. The row check still works if rows are
            // already in the DOM.
        }
        await page.waitForFunction(
            () => (document.body.innerText || '').length > 5000,
            null,
            { timeout: bodyContentMs, polling: 500 },
        ).catch(() => {})
        for (const t of targets) {
            const { row, strategy } = await findTrailheadRow(page, t)
            const found = !!row
            perTarget.push({
                divisionId: t.divisionId,
                name: t.name,
                nameTokens: t.nameTokens,
                found,
                strategy: strategy || 'none',
            })
            log.info?.(`verify-config ${t.name}: ${found ? `OK (${strategy})` : 'MISSING'}`)
            if (!found) errors.push(`${t.name} (id=${t.divisionId}) not found via tokens [${t.nameTokens?.join(', ')}]`)
        }
    } catch (err) {
        errors.push(`probe failed: ${err.message}`)
    }
    return { ok: errors.length === 0, perTarget, errors }
}

// Pre-flight: hit the live detailed-availability page, set the party size,
// and confirm each target's row is reachable via findRowByTokens. Used by
// the `verify-config` subcommand AND by watch-auto's heartbeat to catch
// rec.gov copy edits before race day. Headless + uses acct1's saved profile
// (any logged-in profile works; we use acct1 because it always exists).
//
// Returns { ok, perTarget: [{ divisionId, name, nameTokens, found, strategy }], errors }.
export async function verifyConfigOnce({ permitId, date, partySize, targets, log = console }) {
    const ctx = await launchContext({ headless: true, accountIndex: 1 })
    const url = `https://www.recreation.gov/permits/${permitId}/registration/detailed-availability` +
        `?type=overnight-permit&date=${date}`
    try {
        const page = await ctx.newPage()
        page.setDefaultTimeout(15000)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
        await page.waitForTimeout(2000)
        return await verifyConfigOnPage(page, partySize, targets, log)
    } catch (err) {
        return { ok: false, perTarget: [], errors: [`probe failed: ${err.message}`] }
    } finally {
        await ctx.close().catch(() => {})
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
    divisionTokens = null,
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
    // Token-based matching is preferred. Fall back to the legacy name string
    // only when no tokens are configured (older test scripts).
    const target = divisionTokens?.length
        ? { name: divisionName, nameTokens: divisionTokens, divisionId }
        : { name: divisionName, divisionId }

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

        // Step 2: wait for the entry-points table to populate, then find our
        // row. Token-based matching (aria-label contains-all-tokens) is the
        // primary path; legacy exact-text matching is the fallback.
        let rowResult = { row: null, strategy: null }
        const rowDeadline = Date.now() + 20000
        while (Date.now() < rowDeadline && !rowResult.row) {
            rowResult = await findTrailheadRow(page, target)
            if (!rowResult.row) await page.waitForTimeout(500)
        }
        let row = rowResult.row
        if (!row) {
            log.warn(`Row not found by tokens or name: ${divisionName}. Last-resort substring + first.`)
            row = page.locator('tr, [role="row"]').filter({ hasText: divisionName }).first()
            await row.waitFor({ state: 'visible', timeout: 5000 })
            rowResult.strategy = 'substring-fallback'
        }
        log.info(`Row found via ${rowResult.strategy}: ${divisionName}`)

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
    // expectedTargets: array of {divisionId, name, nameTokens} this warmer
    // intends to potentially fire on. After group-size setup we verify each
    // row is present and return a checkedRows summary; if any are MISSING
    // the caller should alert loudly (today's bug class).
    expectedTargets = [],
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
    await mkdir(path.resolve('./permit-bot/.traces'), { recursive: true })

    // Industry-standard browser-automation observability: Playwright Trace
    // Recording captures every action, network call, DOM snapshot, and
    // console message. On a fire failure we save the trace as a .zip; open
    // it in https://trace.playwright.dev for click-through post-mortem.
    // Replay shows the exact moment selectors stopped matching.
    try {
        await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false })
    } catch (err) {
        log.warn(`${tag} tracing start failed: ${err.message}`)
    }

    // Capture browser console + page errors. React errors and CSP violations
    // become silent in production unless we listen — the warm browser may
    // be throwing exceptions for hours without us knowing.
    page.on('console', (msg) => {
        if (['error', 'warning'].includes(msg.type())) {
            log.info(`${tag} console.${msg.type()}: ${msg.text().slice(0, 200)}`)
        }
    })
    page.on('pageerror', (err) => {
        log.warn(`${tag} pageerror: ${err.message.slice(0, 200)}`)
    })

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

    // Warm-time row sanity check via the exported checkExpectedRows helper.
    // Same code path as the tests; bugs in this assertion will reproduce
    // identically in CI.
    const checkedRows = await checkExpectedRows(page, expectedTargets, {
        info: (m) => log.info(`${tag} ${m}`),
    })

    // Structured DOM inventory. Logged once at warm time; the session log holds
    // a snapshot of EXACTLY which trailheads were visible. If something fails
    // later we don't have to re-derive from screenshots.
    const domInventory = await getTrailheadInventory(page)
    log.info(`${tag} dom inventory: ${domInventory.length} trailheads visible`)

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
    // `target` is the trailhead descriptor: { divisionId, name, nameTokens }.
    // Back-compat: if called with a bare string for divisionName it falls
    // through to the legacy name-only finder (slow + fragile, but still works).
    const hot = async (target, date, opts = {}) => {
        const t0 = Date.now()
        // apiSignalAt: timestamp (ms epoch) of the API poll that triggered
        // this fire. If provided, latencyMs.apiSignalToBookClickMs surfaces
        // the user's actual KPI ("from poll → click Book Now").
        const apiSignalAt = opts.apiSignalAt ?? null
        // Phase-level latency capture. Each phase records the ms elapsed
        // since the previous milestone; the session log gets a precise
        // breakdown of "where the 5 seconds went" instead of just a total.
        const phases = {}
        let lastMark = t0
        const mark = (name) => {
            const now = Date.now()
            phases[name] = now - lastMark
            lastMark = now
        }
        const screenshotPath = (label) =>
            path.resolve(`./permit-bot/.screenshots/${Date.now()}-acct${accountIndex}-${label}.png`)
        const baseMeta = { accountIndex, email: acct.email }
        const divisionName = typeof target === 'string' ? target : target?.name

        // Token-first row lookup via the exported reload-recovery helper.
        // If the warmer's snapshot is stale (rows missing because a filter
        // hid 0-availability trailheads), reloadAndResetup forces the SPA
        // to re-fetch. Same code path the tests exercise.
        const reloadAndResetup = async () => {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 })
            await page.waitForTimeout(1500)
            const groupTriggerR = page.locator(
                'button:has-text("Add Group Members"), button:has-text("Group Member"), button:has-text("People"), [aria-label*="Group" i]'
            ).first()
            if (await groupTriggerR.count() > 0) {
                await groupTriggerR.click().catch(() => {})
                await page.waitForTimeout(300)
                const plusBtnR = page.locator('button[aria-label="Add Peoples"]').first()
                for (let i = 0; i < currentParty; i++) {
                    await plusBtnR.click({ timeout: 1500 }).catch(() => {})
                    await page.waitForTimeout(40)
                }
                await page.keyboard.press('Escape')
                await page.waitForTimeout(700)
            }
        }
        const rowResult = await findRowWithReloadRecovery(
            page, target, reloadAndResetup,
            { info: (m) => log.info?.(`${tag} ${m}`), warn: (m) => log.warn?.(`${tag} ${m}`) },
        )
        mark('row_lookup')
        let row = rowResult.row
        if (!row) {
            await page.screenshot({ path: screenshotPath('hot-fail-no-row'), fullPage: true }).catch(() => {})
            const tracePath = path.resolve(`./permit-bot/.traces/hot-fail-${Date.now()}-acct${accountIndex}-no-row.zip`)
            await ctx.tracing.stop({ path: tracePath }).catch(() => {})
            log.warn(`${tag} hot failed (row_not_visible). Trace saved: ${tracePath}`)
            return {
                ok: false, reason: 'row_not_visible',
                latencyMs: { total: Date.now() - t0, phases, didReload: rowResult.didReload },
                tracePath,
                ...baseMeta,
            }
        }
        log.info(`${tag} hot: row found via ${rowResult.strategy}${rowResult.didReload ? ' (after reload)' : ''}`)

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
        // findCellByPositionInRow exported from this module — same logic, but
        // bound to (row, date) here for the closure. Reused by tryOvercapAdjust
        // (read-only inspect) AND the optimistic-click fallback (click target).
        const findCellByPosition = () => findCellByPositionInRow(row, date)

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

        // cellMatchMode records HOW we got the cell handle, surfaced in
        // fire_results so post-mortems can tell normal fires from optimistic
        // clicks. Values: 'normal' | 'overcap' | 'optimistic' | null (no match).
        let cellMatchMode = null
        let reloadOutcome = null
        let match = await findCell()
        if (match) cellMatchMode = 'normal'
        if (!match && await tryOvercapAdjust()) {
            match = await findCell()
            if (match) {
                cellMatchMode = 'overcap'
                log.info(`${tag} OVERCAP recovered: matched ${JSON.stringify(match.label)} at party=${currentParty}`)
            }
        }
        // OPTIMISTIC CLICK (06-14 race): findCell looks for a cell with a
        // bookable aria-label. When the API says stock is open but every
        // cell still renders NR (race-too-fast: stock drained between API
        // poll and our click), we skip the stale-DOM reload (~5s, too slow)
        // and just click the cell at the target column index regardless of
        // label. The cell click + book-now POST is the source of truth: if
        // truly gone, rec.gov rejects and we log the truthful failure ~1s
        // later. Worth the bet — the cost of being wrong is one bad POST.
        if (!match) {
            const positionMatch = await findCellByPositionInRow(row, date)
            if (positionMatch) {
                match = positionMatch
                cellMatchMode = 'optimistic'
                log.info(`${tag} OPTIMISTIC CLICK on position-matched cell[${positionMatch.idx}] label=${JSON.stringify(positionMatch.label)} txt=${JSON.stringify(positionMatch.txt)}`)
            }
        }
        if (!match) {
            await page.screenshot({ path: screenshotPath('hot-fail-no-cell'), fullPage: true }).catch(() => {})
            const tracePath = path.resolve(`./permit-bot/.traces/hot-fail-${Date.now()}-acct${accountIndex}-no-cell.zip`)
            await ctx.tracing.stop({ path: tracePath }).catch(() => {})
            log.warn(`${tag} hot failed (no_matching_cell). Trace saved: ${tracePath}`)
            return {
                ok: false, reason: 'no_matching_cell',
                latencyMs: { total: Date.now() - t0, phases, didReload: rowResult.didReload, reloadOutcome, cellMatchMode },
                tracePath,
                ...baseMeta,
            }
        }
        mark('cell_find')
        log.info(`${tag} matched cell ${JSON.stringify(match.label)} at currentParty=${currentParty}`)

        await match.handle.click()
        mark('cell_click')
        const book = page.getByRole('button', { name: /^book now$/i }).first()
        // In optimistic mode, clicking an NR-labeled cell often won't trigger
        // Book-Now activation — fail fast (1.5s) rather than burning 10s on
        // a button that won't enable. Normal/overcap mode keeps the 5s grace
        // since rec.gov can take a beat to render the wizard.
        const bookTimeout = cellMatchMode === 'optimistic' ? 1500 : 5000
        await book.waitFor({ state: 'visible', timeout: bookTimeout }).catch(() => {})
        await page.waitForFunction(
            () => {
                const btns = [...document.querySelectorAll('button')]
                const b = btns.find(x => /^book now$/i.test(x.textContent?.trim() || ''))
                return b && !b.disabled && !b.getAttribute('aria-disabled')?.match(/true/i)
            },
            null,
            { timeout: bookTimeout, polling: 100 },
        ).catch(() => {})
        mark('book_button_ready')
        await book.click()
        mark('book_click')
        const tBook = Date.now() - t0
        log.info(`${tag} clicked Book Now at +${tBook}ms`)

        // Post-click flow (modal handling, cart check) — still inside the hot
        // path so the timing reflects "click to confirmed".
        await page.waitForTimeout(2500)
        await handleLoginModalIfPresent(page, { log, accountIndex })
        await page.waitForTimeout(2000)
        mark('post_click_wait')
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
        mark('cart_check')

        const totalMs = Date.now() - t0
        // apiSignalToBookClickMs is the user's actual KPI for race timing.
        // tBook is "ms inside hot()" — adding (t0 - apiSignalAt) covers the
        // dispatch hop from the poll loop to this warmer's hot path.
        const apiSignalToBookClickMs = apiSignalAt != null
            ? (t0 - apiSignalAt) + tBook
            : null
        return {
            ok: true,
            cartState,
            postClickUrl,
            postShot,
            cartShot,
            // Phases let post-mortems answer "where did the 5 seconds go?"
            // without re-running. Common pattern: row_lookup spikes when
            // reload fires; book_button_ready spikes when rec.gov is slow.
            latencyMs: {
                bookClick: tBook,
                total: totalMs,
                apiSignalToBookClickMs,
                phases,
                didReload: rowResult.didReload,
                reloadOutcome,
                cellMatchMode,
                strategy: rowResult.strategy,
            },
            accountIndex,
            email: acct.email,
            // Actual party committed (after any overcap downgrade). May be <
            // the originally-requested partySize. Caller should use this for
            // partyAcquired arithmetic, not the planned shot.party.
            actualParty: currentParty,
            originalParty: partySize,
        }
    }

    return { ctx, page, hot, accountIndex, email: acct.email, checkedRows, domInventory }
}
