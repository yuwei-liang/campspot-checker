// Playwright E2E for the page.reload() recovery path in hot().
//
// This is the 2026-06-12 race-day fix: when the warm browser's DOM is stale
// (rec.gov hides 0-availability trailheads, then doesn't auto-refresh on
// backend flip), hot() must force a fresh fetch instead of polling the same
// stale DOM for 5 seconds and giving up.
//
// We simulate the stale-DOM scenario by:
//   1. Loading a "stale" version of the page (HTML stripped of LYV rows)
//   2. Calling findRowWithReloadRecovery with a fake reloadAndResetup that
//      swaps in the full fixture (= "rec.gov returned fresh data after reload")
//   3. Asserting the row is found AND reloadAndResetup was called

import { jest } from '@jest/globals'
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { findRowWithReloadRecovery } from '../CartBot.mjs'

const FIXTURE = path.resolve('./permit-bot/__tests__/fixtures/lyv-page-2026-06-12.html')

const HI_TARGET = {
    divisionId: '44585917',
    name: 'Happy Isles->Little Yosemite Valley (No Donohue Pass)',
    nameTokens: ['Happy Isles', 'Little Yosemite Valley'],
}

const silentLog = { info: () => {}, warn: () => {} }

let browser, page, fullHtml, staleHtml

beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    fullHtml = readFileSync(FIXTURE, 'utf-8')
    // "Stale" = remove every <button> with aria-label containing "Happy Isles"
    // — simulating the row being filtered out (the actual 06-12 failure mode).
    staleHtml = fullHtml.replace(
        /<button[^>]*aria-label="[^"]*Happy Isles[^"]*"[^>]*>[\s\S]*?<\/button>/g,
        '<!-- Happy Isles button stripped (stale-DOM simulation) -->',
    )
}, 30000)

beforeEach(async () => {
    page = await browser.newPage()
})

afterEach(async () => {
    await page.close().catch(() => {})
})

afterAll(async () => {
    await browser?.close().catch(() => {})
})

describe('findRowWithReloadRecovery', () => {
    test('happy path: row in DOM → returns immediately, reload NOT called', async () => {
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' })
        const reloadSpy = jest.fn().mockResolvedValue(undefined)

        const result = await findRowWithReloadRecovery(page, HI_TARGET, reloadSpy, silentLog)

        expect(result.row).not.toBeNull()
        expect(result.strategy).toBe('tokens')
        expect(result.didReload).toBe(false)
        expect(reloadSpy).not.toHaveBeenCalled()
    })

    test('stale DOM → reload swaps in fresh page → row found', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        // Sanity: stale page does NOT have Happy Isles.
        const staleText = await page.evaluate(() => document.body.innerText)
        expect(staleText).not.toMatch(/Happy Isles/)

        const reloadAndResetup = jest.fn(async () => {
            // Simulate rec.gov returning fresh page after reload.
            await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' })
        })

        const result = await findRowWithReloadRecovery(page, HI_TARGET, reloadAndResetup, silentLog)

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        expect(result.didReload).toBe(true)
        expect(result.row).not.toBeNull()
        expect(result.strategy).toBe('tokens')
    })

    test('row still missing after reload → polls 5s, then returns null', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const reloadAndResetup = jest.fn(async () => {
            // Reload also yields a stale page — simulates rec.gov persistently
            // hiding the row (e.g. trailhead truly sold out, not just stale).
            await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        })

        const start = Date.now()
        const result = await findRowWithReloadRecovery(page, HI_TARGET, reloadAndResetup, silentLog)
        const elapsed = Date.now() - start

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        expect(result.didReload).toBe(true)
        expect(result.row).toBeNull()
        expect(result.strategy).toBeNull()
        // Polling fallback should have spent ~5s.
        expect(elapsed).toBeGreaterThanOrEqual(4500)
        expect(elapsed).toBeLessThanOrEqual(7500)
    }, 15000)

    test('reload throws → falls through to polling, returns null gracefully (no crash)', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const reloadAndResetup = jest.fn(async () => {
            throw new Error('simulated network failure during reload')
        })

        const result = await findRowWithReloadRecovery(page, HI_TARGET, reloadAndResetup, silentLog)

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        // didReload stays false because the reload threw before completing.
        expect(result.didReload).toBe(false)
        expect(result.row).toBeNull()
    }, 15000)

    test('first attempt finds Glacier Point (separate target) → no reload', async () => {
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' })
        const reloadSpy = jest.fn()
        const gpTarget = {
            divisionId: '44585913',
            name: 'Glacier Point->Little Yosemite Valley',
            nameTokens: ['Glacier Point', 'Little Yosemite Valley'],
        }

        const result = await findRowWithReloadRecovery(page, gpTarget, reloadSpy, silentLog)

        expect(result.row).not.toBeNull()
        expect(result.didReload).toBe(false)
        expect(reloadSpy).not.toHaveBeenCalled()
    })
})
