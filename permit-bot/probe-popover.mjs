// Probe: open the Group Members popover at party=15 (already set), then
// re-open it and dump every visible button's selectors so we can pin the
// correct "-" / decrement button (the bot was wrongly clicking calendar nav).
import * as dotenv from 'dotenv'
dotenv.config()

import { chromium } from 'playwright'
import path from 'node:path'
import { resolveForChromium } from './dnsBypass.mjs'

const PROFILE = path.resolve('./permit-bot/.chromium-profile-2')
const URL = 'https://www.recreation.gov/permits/445859/registration/detailed-availability?type=overnight-permit&date=2026-06-19'

async function probe() {
    const ip = await resolveForChromium('www.recreation.gov').catch(() => null)
    const ctx = await chromium.launchPersistentContext(PROFILE, {
        headless: false,
        viewport: { width: 1400, height: 900 },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=DnsOverHttps,AsyncDns',
            ip ? `--host-resolver-rules=MAP www.recreation.gov ${ip}` : '',
        ].filter(Boolean),
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)

    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    // Setup: set party=15 the working way.
    const groupTrigger = page.getByText(/add group members/i).first()
    await groupTrigger.waitFor({ state: 'visible' })
    await groupTrigger.click()
    await page.waitForTimeout(400)

    // Dump while popover open the FIRST time.
    console.log('\n=== POPOVER OPEN (initial, party=0) — buttons + aria ===')
    const dump = async (label) => {
        const data = await page.evaluate(() => {
            return [...document.querySelectorAll('button')]
                .filter(b => {
                    const r = b.getBoundingClientRect()
                    return r.width > 0 && r.height > 0
                })
                .map(b => {
                    const r = b.getBoundingClientRect()
                    return {
                        text: (b.textContent || '').trim().slice(0, 30),
                        aria: b.getAttribute('aria-label'),
                        cls: (b.className || '').toString().slice(0, 70),
                        x: Math.round(r.x), y: Math.round(r.y),
                        w: Math.round(r.width), h: Math.round(r.height),
                        disabled: b.disabled,
                    }
                })
        })
        console.log(`--- ${label}: ${data.length} visible buttons ---`)
        data.forEach((b, i) => {
            const pos = `[${b.x},${b.y} ${b.w}x${b.h}]`
            console.log(`  [${i}] ${pos} text=${JSON.stringify(b.text)} aria=${JSON.stringify(b.aria)}`)
        })
    }
    await dump('initial popover')

    // Click "+" 15 times.
    const plusBtn = page.locator('button[aria-label*="increase" i], button[aria-label*="add" i]').first()
    for (let i = 0; i < 15; i++) {
        await plusBtn.click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(40)
    }
    console.log('\n=== AFTER +15 (party should be 15) ===')
    await dump('popover after +15')

    // Close, then re-open to simulate the T11 adjust flow.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)

    console.log('\n=== POPOVER CLOSED, calendar visible — what does the trigger look like now? ===')
    // Find anything in header area that contains group-related text/aria.
    const triggerCandidates = await page.evaluate(() => {
        return [...document.querySelectorAll('button, [role="button"], div, input')]
            .filter(b => {
                const r = b.getBoundingClientRect()
                if (r.width <= 0 || r.height <= 0) return false
                const txt = (b.textContent || '').toLowerCase()
                const aria = (b.getAttribute('aria-label') || '').toLowerCase()
                return txt.includes('group') || aria.includes('group') || txt.includes('member') || aria.includes('people')
            })
            .map(b => {
                const r = b.getBoundingClientRect()
                return {
                    tag: b.tagName,
                    text: (b.textContent || '').trim().slice(0, 60),
                    aria: b.getAttribute('aria-label'),
                    cls: (b.className || '').toString().slice(0, 70),
                    x: Math.round(r.x), y: Math.round(r.y),
                }
            })
            .slice(0, 15)
    })
    triggerCandidates.forEach((b, i) => console.log(`  [${i}] tag=${b.tag} text=${JSON.stringify(b.text)} aria=${JSON.stringify(b.aria)}`))

    // Re-open popover (try a more specific selector now that party=15 is set).
    console.log('\n=== Re-opening popover via group trigger ===')
    const reopen = page.locator('button:has-text("Group Member"), [aria-label*="group" i]').first()
    const count = await reopen.count()
    console.log(`reopen selector match count: ${count}`)
    if (count > 0) {
        await reopen.click()
        await page.waitForTimeout(500)
        await dump('popover re-opened')
    }

    console.log('\nHolding 8s for visual inspection.')
    await page.waitForTimeout(8000)
    await ctx.close().catch(() => {})
}
probe().catch(err => { console.error(err); process.exit(1) })
