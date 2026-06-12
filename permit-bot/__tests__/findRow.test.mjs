// Regression test for the 2026-06-12 race-day failure.
//
// Bug: config had "Happy Isles -> Little Yosemite Valley (No Donohue)" but the
// rec.gov DOM has "Happy Isles->Little Yosemite Valley (No Donohue Pass)" —
// different whitespace AND a missing word. Substring `hasText` filter returned
// 0 rows; both shots failed with row_not_visible at fire moment.
//
// Fix: token-based aria-label matching. This test loads the actual page HTML
// captured during the post-mortem and asserts both LYV targets resolve to a
// row via findRowByTokens, and that an unrelated nonsense token-set does not.
//
// Test runs Playwright headless against page.setContent — no network.

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { findRowByTokens } from '../CartBot.mjs'

const FIXTURE = path.resolve('./permit-bot/__tests__/fixtures/lyv-page-2026-06-12.html')

let browser
let context
let page

beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
    page = await context.newPage()
    const html = readFileSync(FIXTURE, 'utf-8')
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
}, 30000)

afterAll(async () => {
    await browser?.close().catch(() => {})
})

describe('findRowByTokens (against captured rec.gov DOM)', () => {
    test('resolves Happy Isles -> LYV row from anchor tokens', async () => {
        const row = await findRowByTokens(page, ['Happy Isles', 'Little Yosemite Valley'])
        expect(row).not.toBeNull()
        const text = await row.innerText()
        // Page text on 2026-06-12 was "Happy Isles->Little Yosemite Valley (No Donohue Pass)"
        // Older config had "(No Donohue)" without "Pass". Token match tolerates both.
        expect(text).toMatch(/Happy Isles/)
        expect(text).toMatch(/Little Yosemite Valley/)
        expect(text).toMatch(/Donohue/)
    })

    test('resolves Glacier Point -> LYV row from anchor tokens', async () => {
        const row = await findRowByTokens(page, ['Glacier Point', 'Little Yosemite Valley'])
        expect(row).not.toBeNull()
        const text = await row.innerText()
        expect(text).toMatch(/Glacier Point/)
        expect(text).toMatch(/Little Yosemite Valley/)
    })

    test('distinguishes Glacier Point -> Illilouette from Glacier Point -> LYV', async () => {
        // "Glacier Point->Illilouette" exists on the page too. The token
        // ["Glacier Point", "Illilouette"] should match THAT row, not LYV.
        const lyv = await findRowByTokens(page, ['Glacier Point', 'Little Yosemite Valley'])
        const illilouette = await findRowByTokens(page, ['Glacier Point', 'Illilouette'])
        expect(lyv).not.toBeNull()
        expect(illilouette).not.toBeNull()
        const lyvText = await lyv.innerText()
        const illText = await illilouette.innerText()
        expect(lyvText).toMatch(/Little Yosemite Valley/)
        expect(lyvText).not.toMatch(/Illilouette/)
        expect(illText).toMatch(/Illilouette/)
    })

    test('returns null for a token set that matches nothing', async () => {
        const row = await findRowByTokens(page, ['DOES_NOT_EXIST', 'Little Yosemite Valley'])
        expect(row).toBeNull()
    })

    test('returns null for empty or missing tokens (defensive)', async () => {
        expect(await findRowByTokens(page, [])).toBeNull()
        expect(await findRowByTokens(page, null)).toBeNull()
        expect(await findRowByTokens(page, undefined)).toBeNull()
    })

    test('regression: the old config string (with spaces + missing "Pass") would NOT have matched as a substring', async () => {
        // Sanity-check that we couldn't have just kept the old approach. The
        // old findTrailheadRowByName used hasText substring matching; the old
        // config string is not a substring of the actual page text.
        const oldConfigString = 'Happy Isles -> Little Yosemite Valley (No Donohue)' // note spaces + missing "Pass"
        const pageText = await page.evaluate(() => document.body.innerText)
        // Page DOES contain "Happy Isles" and "Little Yosemite Valley" but not
        // the old config string as a substring.
        expect(pageText).toMatch(/Happy Isles/)
        expect(pageText).not.toContain(oldConfigString)
        // Token-based match still finds it. That's the whole point.
        const row = await findRowByTokens(page, ['Happy Isles', 'Little Yosemite Valley'])
        expect(row).not.toBeNull()
    })
})
