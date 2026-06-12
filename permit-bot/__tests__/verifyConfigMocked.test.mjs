// Mock-mode E2E for the verify-config flow.
//
// Uses Playwright's page.route() to serve the captured rec.gov fixture for
// detailed-availability requests, blocks every other URL (third-party JS/CSS,
// analytics, fonts) so React doesn't try to hydrate. This proves the full
// navigation → page-load → verify-flow integration works without ever hitting
// rec.gov over the network — CI can run it offline.
//
// Three scenarios:
//   1. Healthy page: both LYV targets resolve via tokens (verify-config OK)
//   2. Drift: rec.gov renames Happy Isles → our tokens stop matching
//   3. Partial drift: GP still ok, HI gone — errors lists only the broken one

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { verifyConfigOnPage } from '../CartBot.mjs'

const FIXTURE = path.resolve('./permit-bot/__tests__/fixtures/lyv-page-2026-06-12.html')
const REC_GOV_URL = 'https://www.recreation.gov/permits/445859/registration/detailed-availability?type=overnight-permit&date=2026-06-19'

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

const silentLog = { info: () => {}, warn: () => {}, error: () => {} }

let browser, fullHtml

beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    fullHtml = readFileSync(FIXTURE, 'utf-8')
}, 30000)

afterAll(async () => {
    await browser?.close().catch(() => {})
})

// Helper: serve a given HTML body for the rec.gov detailed-availability URL,
// block every other request. Returns a Page ready to be navigated.
async function setupMockedRecGovPage(html) {
    const context = await browser.newContext()
    await context.route('**/*', async (route) => {
        const url = route.request().url()
        if (url.includes('recreation.gov/permits/') && url.includes('detailed-availability')) {
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: html,
            })
        } else {
            // Block ALL other resources (JS, CSS, fonts, images, analytics).
            // Without JS no React hydration runs — the DOM stays exactly as
            // captured. That's the point of mock mode.
            await route.abort()
        }
    })
    const page = await context.newPage()
    return { context, page }
}

describe('verifyConfigOnPage against route-mocked rec.gov', () => {
    test('healthy page: both LYV targets resolve via tokens', async () => {
        const { context, page } = await setupMockedRecGovPage(fullHtml)
        try {
            await page.goto(REC_GOV_URL, { waitUntil: 'domcontentloaded' })
            const result = await verifyConfigOnPage(page, 7, [HI, GP], silentLog, {
                triggerWaitMs: 500,
                plusClickMs: 100,
                bodyContentMs: 2000,
            })

            expect(result.ok).toBe(true)
            expect(result.errors).toEqual([])
            expect(result.perTarget).toHaveLength(2)
            expect(result.perTarget[0]).toMatchObject({
                divisionId: '44585917',
                found: true,
                strategy: 'tokens',
            })
            expect(result.perTarget[1]).toMatchObject({
                divisionId: '44585913',
                found: true,
                strategy: 'tokens',
            })
        } finally {
            await context.close()
        }
    }, 30000)

    test('drift: HI button removed from page → verify reports MISSING for HI only', async () => {
        // Simulate rec.gov silently restructuring or hiding Happy Isles.
        // GP rows untouched → only HI should fail.
        const driftedHtml = fullHtml.replace(
            /<button[^>]*aria-label="[^"]*Happy Isles[^"]*"[^>]*>[\s\S]*?<\/button>/g,
            '<!-- removed -->',
        )
        const { context, page } = await setupMockedRecGovPage(driftedHtml)
        try {
            await page.goto(REC_GOV_URL, { waitUntil: 'domcontentloaded' })
            const result = await verifyConfigOnPage(page, 7, [HI, GP], silentLog, {
                triggerWaitMs: 500,
                plusClickMs: 100,
                bodyContentMs: 2000,
            })

            expect(result.ok).toBe(false)
            expect(result.errors).toHaveLength(1)
            expect(result.errors[0]).toContain('Happy Isles')
            expect(result.errors[0]).toContain('44585917')
            expect(result.perTarget[0].found).toBe(false)
            expect(result.perTarget[1].found).toBe(true)
        } finally {
            await context.close()
        }
    }, 30000)

    test('full drift: both rows missing → verify reports both errors', async () => {
        // Simulate a worst-case rec.gov rename: every LYV-suffixed trailhead
        // button is gone (e.g. the suffix changed from "Little Yosemite Valley"
        // to "LYV"). Both targets fail.
        const fullDrift = fullHtml.replace(
            /<button[^>]*aria-label="[^"]*Little Yosemite Valley[^"]*"[^>]*>[\s\S]*?<\/button>/g,
            '<!-- removed -->',
        )
        const { context, page } = await setupMockedRecGovPage(fullDrift)
        try {
            await page.goto(REC_GOV_URL, { waitUntil: 'domcontentloaded' })
            const result = await verifyConfigOnPage(page, 7, [HI, GP], silentLog, {
                triggerWaitMs: 500,
                plusClickMs: 100,
                bodyContentMs: 2000,
            })

            expect(result.ok).toBe(false)
            expect(result.errors).toHaveLength(2)
            expect(result.perTarget.every(t => t.found === false)).toBe(true)
        } finally {
            await context.close()
        }
    }, 30000)

    test('empty page (rec.gov returned a 500 or login wall): probe surfaces the failure', async () => {
        // Minimal HTML — no table, no buttons. Simulates a broken rec.gov
        // response or a hard auth gate.
        const broken = '<html><body><h1>Site Maintenance</h1></body></html>'
        const { context, page } = await setupMockedRecGovPage(broken)
        try {
            await page.goto(REC_GOV_URL, { waitUntil: 'domcontentloaded' })
            const result = await verifyConfigOnPage(page, 7, [HI, GP], silentLog, {
                triggerWaitMs: 500,
                plusClickMs: 100,
                bodyContentMs: 2000,
            })

            expect(result.ok).toBe(false)
            // Both targets missing.
            expect(result.perTarget.every(t => t.found === false)).toBe(true)
        } finally {
            await context.close()
        }
    }, 30000)
})
