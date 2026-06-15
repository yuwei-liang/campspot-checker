// Playwright E2E for the stale-DOM cell-find recovery path (06-13 race-day fix).
//
// On 06-13 the rec.gov JSON availability API flipped to non-zero at 6:59:30 PDT
// but the warm SPA DOM still rendered every cell in the LYV row as "No online
// reservations available" for another ~10s. The bot fired, walked the warm DOM,
// found no clickable cell, gave up. This test pins the recovery: when the warm
// DOM has no bookable cell, reload once, re-look, and succeed if the fresh
// DOM has it.
//
// Test shape mirrors reloadRecovery.test.mjs:
//   1. Load a "stale" page whose SAT 20 cell aria-label says NR
//   2. Call findCellWithReloadRecovery; reloadAndResetup swaps in a "fresh" page
//      whose SAT 20 cell is clearly bookable
//   3. Assert: match returned, reload called exactly once

import { jest } from '@jest/globals'
import { chromium } from 'playwright'
import {
    findBookableCellInRow,
    findCellByPositionInRow,
    findCellWithReloadRecovery,
    findTrailheadRow,
} from '../CartBot.mjs'

const HI_TARGET = {
    divisionId: '44585917',
    name: 'Happy Isles->Little Yosemite Valley (No Donohue Pass)',
    nameTokens: ['Happy Isles', 'Little Yosemite Valley'],
}
const DATE = '2026-06-20' // SAT 20
const silentLog = { info: () => {}, warn: () => {} }

// Minimal HTML: a single <tr> row with a trailhead-name button (matched by
// findRowByTokens) plus ten day-cell buttons. Cell aria-labels follow the
// rec.gov production shape so the regex in findBookableCellInRow matches.
//
// staleCells: every SAT 20 button is "No online reservations available" / text NR
// freshCells: SAT 20 button is bookable, text "10"
const baseRow = (cells) => `<!doctype html><html><body>
<table>
  <tr aria-label="Availability by Sites and Dates">
    <td><button aria-label="Happy Isles-&gt;Little Yosemite Valley (No Donohue Pass)">Happy Isles-&gt;Little Yosemite Valley (No Donohue Pass)</button></td>
    ${cells}
  </tr>
</table>
</body></html>`

const staleHtml = baseRow(`
    <td><button aria-label="FRI 19\nNo online reservations available">NR</button></td>
    <td><button aria-label="SAT 20\nNo online reservations available">NR</button></td>
    <td><button aria-label="SUN 21\nNo online reservations available">NR</button></td>
`)

const freshHtml = baseRow(`
    <td><button aria-label="FRI 19\nNo online reservations available">NR</button></td>
    <td><button aria-label="SAT 20\nPeople: 10 out of 12">10</button></td>
    <td><button aria-label="SUN 21\nNo online reservations available">NR</button></td>
`)

let browser, page

beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
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

const refindRow = async () => {
    const r = await findTrailheadRow(page, HI_TARGET)
    return r.row
}

describe('findBookableCellInRow', () => {
    test('returns null when every matching cell is NR', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        expect(row).not.toBeNull()
        const match = await findBookableCellInRow(row, DATE)
        expect(match).toBeNull()
    })

    test('returns the bookable cell when DOM has stock', async () => {
        await page.setContent(freshHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const match = await findBookableCellInRow(row, DATE)
        expect(match).not.toBeNull()
        expect(match.label).toMatch(/SAT 20/)
        expect(match.txt).toBe('10')
    })

    test('skips cells for the wrong day even when bookable', async () => {
        // FRI 19 is bookable, but we want SAT 20 — must skip the wrong day.
        const html = baseRow(`
            <td><button aria-label="FRI 19\nPeople: 5 out of 12">5</button></td>
            <td><button aria-label="SAT 20\nNo online reservations available">NR</button></td>
        `)
        await page.setContent(html, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const match = await findBookableCellInRow(row, DATE)
        expect(match).toBeNull()
    })
})

describe('findCellByPositionInRow (06-14 fix: optimistic-click target finder)', () => {
    // Powers the new optimistic-click strategy: when the API says stock is
    // open but every visible cell in the row is rendered NR (stale DOM or
    // race-too-fast), we still need a clickable button at the right column.
    // findCellByPositionInRow returns that button by computing its column
    // index from any sibling cell whose aria-label still carries the
    // weekday+day pair — independent of NR labeling.

    test('returns the target-date cell even when every cell is NR-labeled', async () => {
        // All cells say "No online reservations", but one of them is the
        // SAT 20 column. Position math should find it regardless of labels.
        const html = baseRow(`
            <td><button aria-label="FRI 19\nNo online reservations available">NR</button></td>
            <td><button aria-label="SAT 20\nNo online reservations available">NR</button></td>
            <td><button aria-label="SUN 21\nNo online reservations available">NR</button></td>
        `)
        await page.setContent(html, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const match = await findCellByPositionInRow(row, DATE)
        expect(match).not.toBeNull()
        // SAT 20 is the second day-cell in the row (anchor=FRI 19 at idx, +1).
        expect(match.label).toMatch(/SAT 20/)
        // Handle must be clickable — verify it's the right button.
        const labelOnHandle = await match.handle.getAttribute('aria-label')
        expect(labelOnHandle).toMatch(/SAT 20/)
    })

    test('uses any visible weekday+day cell as anchor (works when SAT 20 itself is missing label)', async () => {
        // SAT 20 cell present but with mangled label (rec.gov re-renders mid-flip
        // can leave a button without weekday/day). FRI 19 is the anchor; SAT 20
        // is anchorIdx+1.
        const html = baseRow(`
            <td><button aria-label="FRI 19\nNo online reservations available">NR</button></td>
            <td><button aria-label="">??</button></td>
            <td><button aria-label="SUN 21\nNo online reservations available">NR</button></td>
        `)
        await page.setContent(html, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const match = await findCellByPositionInRow(row, DATE)
        expect(match).not.toBeNull()
        // The match is the cell at anchorIdx + (20 - 19) = anchorIdx + 1, the
        // unlabeled one. We just confirm a handle came back — caller will
        // optimistically click it.
        expect(match.idx).toBeGreaterThan(0)
    })

    test('returns null when no anchor cell exists (row is completely broken)', async () => {
        const html = baseRow(`
            <td><button aria-label="">??</button></td>
            <td><button aria-label="">??</button></td>
        `)
        await page.setContent(html, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const match = await findCellByPositionInRow(row, DATE)
        expect(match).toBeNull()
    })

    test('returns null when computed index is out of range (target date past visible window)', async () => {
        // Anchor MON 8 with target SAT 20 → offset 12, exceeds visible cells.
        const html = baseRow(`
            <td><button aria-label="MON 8\nNo online reservations available">NR</button></td>
            <td><button aria-label="TUE 9\nNo online reservations available">NR</button></td>
        `)
        await page.setContent(html, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const match = await findCellByPositionInRow(row, DATE)
        expect(match).toBeNull()
    })
})

describe('findCellWithReloadRecovery', () => {
    test('fresh DOM on first try → no reload', async () => {
        await page.setContent(freshHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const reloadSpy = jest.fn().mockResolvedValue(undefined)

        const result = await findCellWithReloadRecovery({
            page, row, date: DATE,
            reloadAndResetup: reloadSpy,
            refindRow,
            log: silentLog,
        })

        expect(result.match).not.toBeNull()
        expect(result.didReload).toBe(false)
        expect(reloadSpy).not.toHaveBeenCalled()
    })

    test('stale DOM → reload swaps in fresh page → cell found', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const reloadAndResetup = jest.fn(async () => {
            await page.setContent(freshHtml, { waitUntil: 'domcontentloaded' })
        })

        const result = await findCellWithReloadRecovery({
            page, row, date: DATE,
            reloadAndResetup,
            refindRow,
            log: silentLog,
        })

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        expect(result.didReload).toBe(true)
        expect(result.match).not.toBeNull()
        expect(result.match.label).toMatch(/SAT 20/)
        expect(result.match.txt).toBe('10')
    })

    test('stale DOM persists after reload → returns null match (graceful)', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const reloadAndResetup = jest.fn(async () => {
            await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        })

        const result = await findCellWithReloadRecovery({
            page, row, date: DATE,
            reloadAndResetup,
            refindRow,
            log: silentLog,
        })

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        expect(result.didReload).toBe(true)
        expect(result.match).toBeNull()
        // Row should still be rebound to the post-reload locator so caller can
        // continue (e.g. for screenshot / trace).
        expect(result.row).not.toBeNull()
    })

    test('reload throws → returns null match (no crash)', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const reloadAndResetup = jest.fn(async () => {
            throw new Error('simulated reload failure')
        })

        const result = await findCellWithReloadRecovery({
            page, row, date: DATE,
            reloadAndResetup,
            refindRow,
            log: silentLog,
        })

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        expect(result.didReload).toBe(false)
        expect(result.match).toBeNull()
    })

    test('row gone after reload → null match, row=null', async () => {
        await page.setContent(staleHtml, { waitUntil: 'domcontentloaded' })
        const row = await refindRow()
        const reloadAndResetup = jest.fn(async () => {
            // Empty page — refindRow will return null.
            await page.setContent('<html><body></body></html>', { waitUntil: 'domcontentloaded' })
        })

        const result = await findCellWithReloadRecovery({
            page, row, date: DATE,
            reloadAndResetup,
            refindRow,
            log: silentLog,
        })

        expect(reloadAndResetup).toHaveBeenCalledTimes(1)
        expect(result.didReload).toBe(true)
        expect(result.match).toBeNull()
        expect(result.row).toBeNull()
    })
})
