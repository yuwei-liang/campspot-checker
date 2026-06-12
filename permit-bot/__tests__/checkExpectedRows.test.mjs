// Playwright E2E for the warm-time row sanity check.
//
// Drives `checkExpectedRows` against the captured rec.gov DOM the same way
// warmCart does it in production. The bug it guards against (06-12 race-day):
// warm setup completes cleanly but the target rows aren't in the DOM, so the
// hot path will fail with row_not_visible. We want this checker to surface
// the missing row at warm time, not at fire time.

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { checkExpectedRows } from '../CartBot.mjs'

const FIXTURE = path.resolve('./permit-bot/__tests__/fixtures/lyv-page-2026-06-12.html')

let browser, page

beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    await page.setContent(readFileSync(FIXTURE, 'utf-8'), { waitUntil: 'domcontentloaded' })
}, 30000)

afterAll(async () => {
    await browser?.close().catch(() => {})
})

const HI = {
    divisionId: '44585917',
    name: 'Happy Isles->Little Yosemite Valley (No Donohue Pass)',
    nameTokens: ['Happy Isles', 'Little Yosemite Valley'],
}
const GP = {
    divisionId: '44585913',
    name: 'Glacier Point->Little Yosemite Valley',
    nameTokens: ['Glacier Point', 'Little Yosemite Valley'],
}
const BAD = {
    divisionId: '99999999',
    name: 'Definitely Not A Real Trailhead',
    nameTokens: ['Definitely Not A Real', 'Trailhead'],
}

describe('checkExpectedRows', () => {
    test('reports both LYV targets as ok (tokens strategy)', async () => {
        const results = await checkExpectedRows(page, [HI, GP], { info: () => {} })
        expect(results).toHaveLength(2)
        expect(results[0]).toMatchObject({ divisionId: '44585917', ok: true, strategy: 'tokens' })
        expect(results[1]).toMatchObject({ divisionId: '44585913', ok: true, strategy: 'tokens' })
    })

    test('flags a target with bad tokens as missing — this is the warm-time alarm', async () => {
        const results = await checkExpectedRows(page, [HI, BAD], { info: () => {} })
        expect(results).toHaveLength(2)
        expect(results[0].ok).toBe(true)
        expect(results[1].ok).toBe(false)
        expect(results[1].strategy).toBe('none')
        expect(results[1].divisionId).toBe('99999999')
    })

    test('handles empty targets list (no-op)', async () => {
        const results = await checkExpectedRows(page, [], { info: () => {} })
        expect(results).toEqual([])
    })

    test('handles a target with only name (no tokens) — falls back to name strategy', async () => {
        // Page has the exact text "Happy Isles->Little Yosemite Valley (No
        // Donohue Pass)" — exact-name match should work.
        const exactNameTarget = {
            divisionId: '44585917',
            name: 'Happy Isles->Little Yosemite Valley (No Donohue Pass)',
        }
        const results = await checkExpectedRows(page, [exactNameTarget], { info: () => {} })
        expect(results[0].ok).toBe(true)
        expect(results[0].strategy).toBe('name')
    })

    test('regression: a target with the OLD (wrong) config name fails outright', async () => {
        // This is what shipped on 06-12. Reproduces the actual production failure
        // mode. checkExpectedRows reports missing → warmCart Discord-alerts.
        const oldBrokenTarget = {
            divisionId: '44585917',
            name: 'Happy Isles -> Little Yosemite Valley (No Donohue)', // spaces, no "Pass"
            // No nameTokens at all — pre-fix config didn't have them.
        }
        const results = await checkExpectedRows(page, [oldBrokenTarget], { info: () => {} })
        expect(results[0].ok).toBe(false)
        expect(results[0].strategy).toBe('none')
    })
})
