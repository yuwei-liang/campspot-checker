// One-off probe: set party=15 on Cottonwood Creek (which has 12 remaining for
// FRI 19) and dump what the cell aria-label + state becomes. Tells us
// definitively how rec.gov UI handles "party > available". Uses account 2's
// profile so we don't disturb the running pre-warmed acct1.
import * as dotenv from 'dotenv'
dotenv.config()

import { chromium } from 'playwright'
import path from 'node:path'
import { resolveForChromium } from './dnsBypass.mjs'

const PROFILE = path.resolve('./permit-bot/.chromium-profile-2')
const URL = 'https://www.recreation.gov/permits/445859/registration/detailed-availability?type=overnight-permit&date=2026-06-19'

async function probe(partySize) {
    const hi = await resolveForChromium('www.recreation.gov').catch(() => null)
    const ctx = await chromium.launchPersistentContext(PROFILE, {
        headless: false,
        viewport: { width: 1400, height: 900 },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=DnsOverHttps,AsyncDns',
            hi ? `--host-resolver-rules=MAP www.recreation.gov ${hi}` : '',
        ].filter(Boolean),
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)

    console.log(`probe: setting party=${partySize} on Cottonwood Creek 6/19`)
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    // Set group size via the +N click pattern.
    const groupTrigger = page.getByText(/add group members/i).first()
    await groupTrigger.waitFor({ state: 'visible' })
    await groupTrigger.click()
    const plus = page.locator('button[aria-label*="increase" i], button[aria-label*="add" i]').first()
    for (let i = 0; i < partySize; i++) {
        await plus.click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(60)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(2500)

    // Find Cottonwood Creek row + dump FRI 19 cell state.
    const row = page.locator('tr, [role="row"]').filter({ hasText: 'Cottonwood Creek' }).first()
    await row.waitFor({ state: 'visible' })
    const cells = await row.locator('button').all()
    console.log(`\n=== Row "Cottonwood Creek" cells with party=${partySize} ===`)
    for (let i = 0; i < Math.min(cells.length, 14); i++) {
        const c = cells[i]
        const label = await c.getAttribute('aria-label')
        const txt = (await c.innerText().catch(() => '')).trim().replace(/\n/g, ' | ')
        const disabled = await c.getAttribute('disabled')
        const ariaDisabled = await c.getAttribute('aria-disabled')
        const cls = (await c.getAttribute('class') || '').slice(0, 60)
        console.log(`  cell[${i}]: aria="${label}" txt="${txt}" disabled=${disabled} aria-disabled=${ariaDisabled} class="${cls}"`)
    }

    // Try clicking FRI 19 to see what happens. Take a screenshot before + after.
    console.log('\nAttempting click on FRI 19...')
    const friCell = cells.find(async () => false) // placeholder to suppress lint
    let target = null
    for (const c of cells) {
        const label = (await c.getAttribute('aria-label')) || ''
        if (/FRI\s+19/.test(label)) {
            target = c
            console.log(`Found FRI 19 candidate with aria="${label}"`)
            break
        }
    }
    await page.screenshot({ path: `/tmp/overcap-party${partySize}-before.png`, fullPage: false })
    if (target) {
        try {
            await target.click({ timeout: 3000 })
            await page.waitForTimeout(1500)
            await page.screenshot({ path: `/tmp/overcap-party${partySize}-after-click.png`, fullPage: false })
            // Check if Book Now is enabled now.
            const book = page.getByRole('button', { name: /^book now$/i }).first()
            const bookEnabled = await page.evaluate(() => {
                const b = [...document.querySelectorAll('button')].find(x => /^book now$/i.test(x.textContent?.trim() || ''))
                return b ? { exists: true, disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') } : { exists: false }
            })
            console.log(`Book Now state after click: ${JSON.stringify(bookEnabled)}`)
        } catch (err) {
            console.log(`Click failed: ${err.message}`)
        }
    } else {
        console.log('No FRI 19 cell found by aria-label')
    }

    console.log('\nHolding 8s for visual inspection, then closing.')
    await page.waitForTimeout(8000)
    await ctx.close().catch(() => {})
}

const partySize = Number(process.argv[2] || 15)
probe(partySize).catch(err => { console.error(err); process.exit(1) })
