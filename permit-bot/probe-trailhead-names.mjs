#!/usr/bin/env node
// Find the anchor rec.gov uses to identify trailhead rows. Try harder.
//
// Run: node permit-bot/probe-trailhead-names.mjs

import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const config = JSON.parse(readFileSync('./permit-bot/config.json', 'utf-8'))
const profileDir = path.resolve('./permit-bot/.chromium-profile')
const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
})
const page = await ctx.newPage()
const url = `https://www.recreation.gov/permits/${config.permitId}/registration/detailed-availability?type=overnight-permit&date=${config.targetDates[0]}`
console.log(`Loading ${url}`)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2000)

// Mirror warmCart: rec.gov filters trailhead rows by party-size availability.
// Without setting it, the table won't fully render. Open the popover, click
// "+" partySize times, close. Verified selectors (CartBot.mjs:541).
console.log(`Setting group size to ${config.partySize} ...`)
const trigger = page.locator(
    'button:has-text("Add Group Members"), [placeholder*="Add Group" i], [aria-label*="Group" i]'
).first()
await trigger.waitFor({ state: 'visible', timeout: 15000 })
await trigger.click()
await page.waitForTimeout(500)
const plus = page.locator('button[aria-label="Add Peoples"]').first()
for (let i = 0; i < config.partySize; i++) {
    await plus.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(60)
}
const closeBtn = page.getByRole('button', { name: /^(close|done|apply)$/i }).first()
if (await closeBtn.count() > 0) await closeBtn.click().catch(() => {})
else await page.keyboard.press('Escape')
await page.waitForTimeout(1500)

console.log('Waiting up to 20s for "Happy Isles" to appear in DOM after party set ...')
try {
    await page.waitForFunction(
        () => (document.body.innerText || '').includes('Happy Isles'),
        null,
        { timeout: 20000, polling: 500 },
    )
    console.log('  ✓ found')
} catch {
    console.log('  ✗ never appeared (even after group=' + config.partySize + ')')
}

// Save full HTML for fixture (will use this for tests later)
const html = await page.content()
writeFileSync('./permit-bot/.last-page-snapshot.html', html)
console.log(`Saved HTML snapshot: ${html.length} bytes → permit-bot/.last-page-snapshot.html`)

for (const target of config.targets) {
    const namePrefix = target.name.split(' (')[0].split(' -> ')[0]
    console.log(`\n=== probing "${namePrefix}" (id=${target.divisionId}) ===`)
    const result = await page.evaluate(({ id, namePrefix }) => {
        // Any attr with the id?
        const els = [...document.querySelectorAll('*')]
        const idMatches = []
        for (const el of els) {
            for (const a of el.attributes) {
                if (a.value.includes(id)) {
                    idMatches.push({ tag: el.tagName, attr: a.name, value: a.value.slice(0, 250) })
                    if (idMatches.length >= 5) break
                }
            }
            if (idMatches.length >= 5) break
        }

        // Leaf containing the name prefix
        const leaf = els.find(e => e.children.length === 0 && (e.textContent || '').includes(namePrefix))
        let chain = null
        if (leaf) {
            let node = leaf
            chain = []
            for (let i = 0; i < 8 && node; i++) {
                chain.push({
                    tag: node.tagName,
                    classes: node.className?.slice?.(0, 100) || '',
                    text_first_100: (node.textContent || '').slice(0, 100).trim(),
                    attrs: Object.fromEntries(
                        [...(node.attributes || [])]
                            .filter(a => a.value.length < 200)
                            .map(a => [a.name, a.value])
                    ),
                })
                node = node.parentElement
            }
        }

        // hrefs near the leaf
        let nearbyHrefs = []
        if (leaf) {
            let node = leaf
            for (let i = 0; i < 5 && node; i++) {
                if (node.parentElement) {
                    const anchors = node.parentElement.querySelectorAll('a[href]')
                    for (const a of anchors) {
                        nearbyHrefs.push(a.getAttribute('href'))
                    }
                }
                node = node.parentElement
            }
            nearbyHrefs = [...new Set(nearbyHrefs)].slice(0, 5)
        }

        return { idMatches, chain, nearbyHrefs }
    }, { id: target.divisionId, namePrefix })

    if (result.idMatches.length) {
        console.log('  id matches in attrs:')
        for (const m of result.idMatches) console.log(`    <${m.tag} ${m.attr}="${m.value}">`)
    } else {
        console.log('  ✗ no attribute contains the divisionId')
    }

    if (result.chain) {
        console.log('  ancestor chain:')
        for (const c of result.chain.slice(0, 5)) console.log(`    ${JSON.stringify(c)}`)
    } else {
        console.log('  ✗ name-prefix leaf not found in DOM')
    }

    if (result.nearbyHrefs.length) {
        console.log('  nearby hrefs:')
        for (const h of result.nearbyHrefs) console.log(`    ${h}`)
    }
}

// Also dump the EXACT text for both LYV rows so we can update config.json.
console.log('\n=== EXACT row text for both LYV targets ===')
for (const target of config.targets) {
    const namePrefix = target.name.split(' (')[0].split(' -> ')[0]
    const rowText = await page.evaluate((namePrefix) => {
        const els = [...document.querySelectorAll('*')]
        // Look for any leaf containing namePrefix AND "Little Yosemite Valley" (skip non-LYV like "Pohono Trail (Glacier Point)")
        const candidates = els.filter(e =>
            e.children.length === 0 &&
            (e.textContent || '').includes(namePrefix) &&
            (e.textContent || '').includes('Little Yosemite Valley')
        )
        return candidates.map(c => (c.textContent || '').trim())
    }, namePrefix)
    console.log(`  ${namePrefix}: ${JSON.stringify(rowText)}`)
}

await page.waitForTimeout(2000)
await ctx.close()
