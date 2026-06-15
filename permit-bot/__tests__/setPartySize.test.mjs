// 06-14: the party-size popover has a directly editable number input — we
// were burning ~1.3s per adjustment clicking +/− buttons N times when we
// could just .fill() the input. setPartySize tries the input path first
// and falls back to button-clicks when the input isn't present (cold-load
// states where rec.gov hasn't fully rendered the popover yet).

import { chromium } from 'playwright'
import { setPartySize } from '../CartBot.mjs'

const silentLog = { info: () => {}, warn: () => {} }

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

// Fixture: popover with a number input bound to a visible counter. Lets
// the test verify the final value regardless of method.
const inputOnlyFixture = (initial = 1) => `<!doctype html><html><body>
<div class="popover">
    <input type="number" aria-label="Number of People" id="party" min="1" max="15" value="${initial}">
    <span id="counter">${initial}</span>
</div>
<script>
    const inp = document.getElementById('party');
    const cnt = document.getElementById('counter');
    inp.addEventListener('input', () => { cnt.textContent = inp.value; });
    inp.addEventListener('change', () => { cnt.textContent = inp.value; });
</script>
</body></html>`

const buttonsOnlyFixture = (initial = 1) => `<!doctype html><html><body>
<div class="popover">
    <button aria-label="Remove Peoples" id="minus">−</button>
    <span id="counter">${initial}</span>
    <button aria-label="Add Peoples" id="plus">+</button>
</div>
<script>
    let n = ${initial};
    const cnt = document.getElementById('counter');
    document.getElementById('plus').onclick = () => { n++; cnt.textContent = n; };
    document.getElementById('minus').onclick = () => { n--; cnt.textContent = n; };
</script>
</body></html>`

const bothFixture = (initial = 1) => `<!doctype html><html><body>
<div class="popover">
    <button aria-label="Remove Peoples" id="minus">−</button>
    <input type="number" aria-label="Number of People" id="party" value="${initial}">
    <span id="counter">${initial}</span>
    <button aria-label="Add Peoples" id="plus">+</button>
</div>
<script>
    const inp = document.getElementById('party');
    const cnt = document.getElementById('counter');
    let clickCount = 0;
    window.__clickCount = () => clickCount;
    inp.addEventListener('input', () => { cnt.textContent = inp.value; });
    document.getElementById('plus').onclick = () => { clickCount++; const n = Number(inp.value) + 1; inp.value = n; cnt.textContent = n; };
    document.getElementById('minus').onclick = () => { clickCount++; const n = Number(inp.value) - 1; inp.value = n; cnt.textContent = n; };
</script>
</body></html>`

const counter = () => page.locator('#counter').innerText()

describe('setPartySize', () => {
    test('uses the number input when present (single fill, no button clicks)', async () => {
        await page.setContent(bothFixture(1), { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 7, 1, { log: silentLog })
        expect(result.ok).toBe(true)
        expect(result.method).toBe('input')
        expect(await counter()).toBe('7')
        // Critical: did NOT touch the +/− buttons.
        const buttonClicks = await page.evaluate(() => window.__clickCount())
        expect(buttonClicks).toBe(0)
    })

    test('handles decrement via input fill (overcap downgrade path)', async () => {
        await page.setContent(bothFixture(7), { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 4, 7, { log: silentLog })
        expect(result.ok).toBe(true)
        expect(result.method).toBe('input')
        expect(await counter()).toBe('4')
        const buttonClicks = await page.evaluate(() => window.__clickCount())
        expect(buttonClicks).toBe(0)
    })

    test('no-op when current already matches target', async () => {
        await page.setContent(bothFixture(5), { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 5, 5, { log: silentLog })
        expect(result.ok).toBe(true)
        expect(result.method).toBe('noop')
        expect(await counter()).toBe('5')
    })

    test('falls back to clicking + buttons when only stepper buttons are present', async () => {
        await page.setContent(buttonsOnlyFixture(1), { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 4, 1, { log: silentLog })
        expect(result.ok).toBe(true)
        expect(result.method).toBe('buttons')
        expect(await counter()).toBe('4')
    })

    test('falls back to clicking − buttons when only stepper buttons are present', async () => {
        await page.setContent(buttonsOnlyFixture(7), { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 3, 7, { log: silentLog })
        expect(result.ok).toBe(true)
        expect(result.method).toBe('buttons')
        expect(await counter()).toBe('3')
    })

    test('returns ok=false when neither input nor buttons are present', async () => {
        await page.setContent('<html><body><div>no controls</div></body></html>', { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 5, 1, { log: silentLog })
        expect(result.ok).toBe(false)
    })

    test('input-fill path with bare input (no buttons) still works', async () => {
        await page.setContent(inputOnlyFixture(1), { waitUntil: 'domcontentloaded' })
        const result = await setPartySize(page, 6, 1, { log: silentLog })
        expect(result.ok).toBe(true)
        expect(result.method).toBe('input')
        expect(await counter()).toBe('6')
    })
})
