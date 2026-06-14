// Smoke tests for the chart renderer. The visual output is hard to assert
// without screenshots, so these check the structural pieces: events are
// extracted from polls, null transitions create gaps, the SVG contains
// expected markers (release line, labels for transitions, peak in subtitle).

import { renderSvg, resolveDate, runChartCommand, stepSegments, buildChartConfig } from '../chart.mjs'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DATE = '2026-06-20'
const baseTs = (hhmmss) => `2026-06-13T${hhmmss}.000Z`

// 6:50-7:35 PT = 13:50-14:35 UTC on race day.
const window = {
    fromIso: '2026-06-13T13:50:00Z',
    toIso: '2026-06-13T14:35:00Z',
}

const poll = (utcHHMMSS, hi, gp) => ({
    event: 'poll',
    ts: baseTs(utcHHMMSS),
    byDate: { [DATE]: { hi, gp } },
})

describe('buildChartConfig (Chart.js config produced for the browser to render)', () => {
    const polls = [
        { event: 'poll', ts: '2026-06-13T13:55:00.000Z', byDate: { '2026-06-20': { hi: 0, gp: 0 } } },
        { event: 'poll', ts: '2026-06-13T13:59:30.421Z', byDate: { '2026-06-20': { hi: 10, gp: 4 } } },
        { event: 'poll', ts: '2026-06-13T14:00:11.000Z', byDate: { '2026-06-20': { hi: null, gp: null } } },
    ]
    const date = '2026-06-20'
    const fromIso = '2026-06-13T13:50:00Z'
    const toIso = '2026-06-13T14:35:00Z'

    test('returns a line-chart config with one HI and one GP dataset', () => {
        const cfg = buildChartConfig({ events: polls, date, fromIso, toIso })
        expect(cfg.type).toBe('line')
        expect(cfg.data.datasets.length).toBe(2)
        expect(cfg.data.datasets[0].label).toMatch(/Happy Isles/i)
        expect(cfg.data.datasets[1].label).toMatch(/Glacier Point/i)
    })

    test('datasets use stepped="before" — Chart.js step chart, no diagonals', () => {
        const cfg = buildChartConfig({ events: polls, date, fromIso, toIso })
        for (const ds of cfg.data.datasets) {
            expect(ds.stepped).toBe('before')
        }
    })

    test('null poll values appear as null in the dataset data (real gaps, not 0)', () => {
        const cfg = buildChartConfig({ events: polls, date, fromIso, toIso })
        const hi = cfg.data.datasets[0]
        // The third poll has hi=null — that point's y must be null.
        const nullPoint = hi.data.find(p => p.x === Date.parse('2026-06-13T14:00:11.000Z'))
        expect(nullPoint).toBeDefined()
        expect(nullPoint.y).toBeNull()
        expect(hi.spanGaps).toBe(false)
    })

    test('release-time marker rendered via annotations plugin', () => {
        const cfg = buildChartConfig({ events: polls, date, fromIso, toIso })
        const annotations = cfg.options?.plugins?.annotation?.annotations
        expect(annotations).toBeDefined()
        const releaseLine = Object.values(annotations).find(a => a.type === 'line')
        expect(releaseLine).toBeDefined()
        // Vertical at the 06:59:30 PT release time.
        const expectedTs = Date.parse('2026-06-13T13:59:30Z')
        expect(releaseLine.xMin).toBe(expectedTs)
        expect(releaseLine.xMax).toBe(expectedTs)
    })

    test('zero→positive transitions get highlighted points (pointRadius array)', () => {
        const cfg = buildChartConfig({ events: polls, date, fromIso, toIso })
        const hi = cfg.data.datasets[0]
        // Default pointRadius=0; the release transition gets a visible radius.
        expect(Array.isArray(hi.pointRadius)).toBe(true)
        const releaseIdx = hi.data.findIndex(p => p.x === Date.parse('2026-06-13T13:59:30.421Z'))
        expect(hi.pointRadius[releaseIdx]).toBeGreaterThan(0)
    })
})

describe('stepSegments (regression: diagonal instead of step at value changes)', () => {
    // Identity scales so test asserts on raw input values.
    const idX = (t) => t
    const idY = (v) => v

    test('value change at point N produces vertical step at x_N, not diagonal', () => {
        // Polls: t=0 hi=0, t=10 hi=10. Step chart should produce a polyline
        // that touches (0,0) → (10,0) → (10,10) → ... — the line must go
        // STRAIGHT UP at x=10, then horizontally right. NOT diagonally from
        // (0,0) to (10,10) — that's what was rendering wrong in the chart.
        const points = [
            { ts: 0, hi: 0, gp: 0 },
            { ts: 10, hi: 10, gp: 0 },
        ]
        const segs = stepSegments(points, 'HI', idX, idY)
        expect(segs.length).toBe(1)
        const path = segs[0]
        // The path MUST contain the point (10, 0) — that's the corner of the
        // vertical step. Without it, the path goes diagonally (this was the bug).
        const hasCorner = path.some(p => p.x === 10 && p.y === 0)
        expect(hasCorner).toBe(true)
        // And it must reach (10, 10) so the dot at the new value sits on the line.
        const reachesNewValue = path.some(p => p.x === 10 && p.y === 10)
        expect(reachesNewValue).toBe(true)
    })

    test('drop in value: (10, 10) → (20, 4) produces vertical drop at x=20', () => {
        const points = [
            { ts: 10, hi: 10, gp: 0 },
            { ts: 20, hi: 4, gp: 0 },
        ]
        const segs = stepSegments(points, 'HI', idX, idY)
        const path = segs[0]
        // Corner (20, 10) before drop must exist.
        expect(path.some(p => p.x === 20 && p.y === 10)).toBe(true)
        // Bottom of drop (20, 4) must exist.
        expect(path.some(p => p.x === 20 && p.y === 4)).toBe(true)
    })

    test('three points 0→10→10: line must be vertical at x_release (NOT diagonal)', () => {
        // The real bug. With three points [(0, 0), (10, 10), (20, 10)],
        // the previous buggy implementation produced a path like
        //   (0,0) → (10,0) → (20,10)
        // — diagonally connecting (10,0) to (20,10) instead of stepping up at
        // x=10. Visually: the line starts climbing diagonally from the
        // zero baseline at the previous poll's x and reaches y=10 at the
        // NEXT poll's x, never sitting on the actual release dot at (10,10).
        const points = [
            { ts: 0, hi: 0, gp: 0 },
            { ts: 10, hi: 10, gp: 0 },
            { ts: 20, hi: 10, gp: 0 },
        ]
        const segs = stepSegments(points, 'HI', idX, idY)
        const path = segs[0]
        // The path must hit (10, 0) AND (10, 10) so the step is vertical at
        // x=10. Without the second point the line is diagonal — the bug.
        expect(path.some(p => p.x === 10 && p.y === 0)).toBe(true)
        expect(path.some(p => p.x === 10 && p.y === 10)).toBe(true)
        // And no path point should lie strictly between (10, 0) and (20, 10)
        // along the diagonal — i.e. no point with 10<x<20 unless y=10.
        for (const p of path) {
            if (p.x > 10 && p.x < 20) {
                expect(p.y).toBe(10)
            }
        }
    })

    test('null value splits into separate segments (existing behavior)', () => {
        const points = [
            { ts: 0, hi: 5, gp: 0 },
            { ts: 10, hi: null, gp: 0 },
            { ts: 20, hi: 5, gp: 0 },
        ]
        const segs = stepSegments(points, 'HI', idX, idY)
        expect(segs.length).toBe(2)
    })
})

describe('renderSvg', () => {
    test('basic structural elements', () => {
        const polls = [
            poll('13:55:00', 0, 0),
            poll('13:59:30', 10, 4), // release
            poll('14:00:11', null, null),
            poll('14:00:49', 4, 0),
            poll('14:01:04', null, null),
        ]
        const svg = renderSvg({ polls, date: DATE, ...window })
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg).toContain('</svg>')
        // Release marker rendered
        expect(svg).toContain('06:59:30 release')
        // Title with date
        expect(svg).toContain('2026-06-20')
        // Peak subtitle
        expect(svg).toContain('peak hi+gp=14')
    })

    test('null values create line gaps (no segment spans nulls)', () => {
        // Two non-null islands separated by nulls. Should yield 2 HI segments.
        const polls = [
            poll('13:59:30', 5, 0),
            poll('13:59:31', 5, 0),
            poll('13:59:32', null, null),
            poll('13:59:33', null, null),
            poll('14:00:00', 3, 0),
            poll('14:00:01', 3, 0),
        ]
        const svg = renderSvg({ polls, date: DATE, ...window })
        // Each polyline element = one continuous segment. With two HI islands
        // we expect at least 2 polyline elements (HI). Plus GP segments
        // (GP=0 the whole time, one segment).
        const polylineCount = (svg.match(/<polyline /g) || []).length
        expect(polylineCount).toBeGreaterThanOrEqual(2)
    })

    test('zero→positive transitions become labeled events', () => {
        const polls = [
            poll('13:59:30', 0, 0),
            poll('13:59:31', 10, 4),   // both transition
            poll('13:59:32', 10, 4),
            poll('13:59:33', 0, 0),
            poll('14:00:00', 0, 0),
            poll('14:00:01', 7, 0),    // HI transition again
        ]
        const svg = renderSvg({ polls, date: DATE, ...window })
        expect(svg).toContain('HI=10')
        expect(svg).toContain('GP=4')
        expect(svg).toContain('HI=7')
    })

    test('out-of-window polls are filtered', () => {
        const polls = [
            poll('05:00:00', 10, 10), // way before window
            poll('13:59:30', 5, 5),   // inside
            poll('20:00:00', 10, 10), // way after
        ]
        const svg = renderSvg({ polls, date: DATE, ...window })
        // Subtitle counts polls in window — should be 1, not 3.
        expect(svg).toContain('1 polls')
    })

    test('empty window renders no-stock subtitle gracefully', () => {
        const polls = [
            poll('13:55:00', 0, 0),
            poll('14:00:00', 0, 0),
            poll('14:10:00', 0, 0),
        ]
        const svg = renderSvg({ polls, date: DATE, ...window })
        expect(svg).toContain('no concurrent stock')
        expect(svg).toContain('</svg>')
    })

    test('only renders the requested date (ignores other dates in byDate)', () => {
        // Add a SECOND date with massive stock — should be ignored.
        const polls = [
            { event: 'poll', ts: baseTs('13:59:30'), byDate: {
                [DATE]: { hi: 2, gp: 0 },
                '2026-06-21': { hi: 99, gp: 99 },
            }},
        ]
        const svg = renderSvg({ polls, date: DATE, ...window })
        expect(svg).toContain('peak hi+gp=2')
        expect(svg).not.toContain('hi+gp=198')
    })
})

describe('runChartCommand window selection (regression: empty chart bug)', () => {
    // 06-13 race-day session ran on 2026-06-13 PT morning, targeting the
    // 2026-06-20 trailhead date. First version of the chart command built the
    // plot window using the target date — so 06:50 PT on 06-20 had no polls
    // and the chart rendered empty. Fix: use the session's PT calendar day.

    let tmp
    beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), 'chart-test-')) })
    afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

    const writeFixtureSession = (events) => {
        const p = path.join(tmp, 'session.jsonl')
        writeFileSync(p, events.map(JSON.stringify).join('\n') + '\n')
        return p
    }

    test('session day != target date — chart still contains polls (regression)', async () => {
        // Session ran morning of 2026-06-13 PT (13:50–14:30 UTC), targeting
        // the 2026-06-20 trailhead date.
        const session = writeFixtureSession([
            { event: 'startup', ts: '2026-06-13T13:50:00.000Z', targets: ['2026-06-20'] },
            { event: 'poll', ts: '2026-06-13T13:55:00.000Z', byDate: { '2026-06-20': { hi: 0, gp: 0 } } },
            { event: 'poll', ts: '2026-06-13T13:59:30.421Z', byDate: { '2026-06-20': { hi: 10, gp: 4 } } },
            { event: 'poll', ts: '2026-06-13T14:00:11.000Z', byDate: { '2026-06-20': { hi: null, gp: null } } },
        ])
        const { reportPath } = await runChartCommand({
            sessionPath: session,
            outDir: tmp,
        })
        const html = readFileSync(reportPath, 'utf-8')
        // The chart subtitle reports poll count IN window. If the window
        // was built from the target date, it'd say "0 polls". Fix should
        // put 3 polls in the 06:50–07:35 PT window.
        expect(html).not.toContain('0 polls · no concurrent stock')
        expect(html).toContain('3 polls')
        // And the release transition should be labeled.
        expect(html).toContain('HI=10')
        expect(html).toContain('GP=4')
    })

    test('long-running session across midnight: window day comes from the FIRE, not startup (regression)', async () => {
        // Real case from 06-14: a session started 06-13 afternoon PT and was
        // still running for the 06-14 morning race. Old code anchored the
        // window day on startup (06-13), so the 06-14 06:59:30 fire and polls
        // fell outside the 06-13 06:50–07:35 window and the chart was empty.
        // Fix: prefer the first fire/decision event's PT day as the window
        // anchor. CLI flag --window-day overrides.
        const session = writeFixtureSession([
            { event: 'startup', ts: '2026-06-13T15:32:27.000Z', targets: ['2026-06-21'] }, // PT 08:32 on 06-13
            { event: 'poll', ts: '2026-06-13T20:00:00.000Z', byDate: { '2026-06-21': { hi: 0, gp: 0 } } },
            { event: 'poll', ts: '2026-06-14T13:59:22.000Z', byDate: { '2026-06-21': { hi: 8, gp: 4 } } },
            { event: 'decision', ts: '2026-06-14T13:59:22.880Z', fireId: 'x', date: '2026-06-21', plan: { kind: 'solo', partySize: 7, shots: [] } },
            { event: 'fire_results', ts: '2026-06-14T13:59:30.000Z', fireId: 'x', date: '2026-06-21', allFailed: true, results: [] },
        ])
        const { reportPath } = await runChartCommand({
            sessionPath: session,
            outDir: tmp,
        })
        const html = readFileSync(reportPath, 'utf-8')
        // The fire happened on 06-14, so the window should cover 06-14
        // 06:50-07:35 PT and INCLUDE the 06-14 13:59:22 poll showing HI=8.
        expect(html).toContain('"HI=8"')
        // Window min should be 06-14 06:50 PT = 06-14 13:50Z, not 06-13.
        expect(html).toContain(String(Date.parse('2026-06-14T06:50:00-07:00')))
    })

    test('--window-day CLI override pins the window even when sessions span days', async () => {
        const session = writeFixtureSession([
            { event: 'startup', ts: '2026-06-13T15:32:27.000Z', targets: ['2026-06-21'] },
            { event: 'poll', ts: '2026-06-14T13:59:30.000Z', byDate: { '2026-06-21': { hi: 5, gp: 0 } } },
        ])
        const { reportPath } = await runChartCommand({
            sessionPath: session,
            windowDay: '2026-06-14',
            outDir: tmp,
        })
        const html = readFileSync(reportPath, 'utf-8')
        expect(html).toContain('"HI=5"')
        expect(html).toContain(String(Date.parse('2026-06-14T06:50:00-07:00')))
    })

    test('multi-session same-day: load all logs from session day (echoes after restart)', async () => {
        // Race day reality: the bot may restart mid-morning (e.g. after a failed
        // fire). Echoes happen in session 2 but the chart loads session 1. Fix:
        // when `--all-sessions` is passed, runChartCommand combines events from
        // every same-PT-day log in the parent directory.
        const sessionA = path.join(tmp, 'watch-auto-2026-06-13T08-00-00-000Z.jsonl')
        writeFileSync(sessionA, [
            { event: 'startup', ts: '2026-06-13T13:55:00.000Z', targets: ['2026-06-20'] },
            { event: 'poll', ts: '2026-06-13T13:59:30.000Z', byDate: { '2026-06-20': { hi: 10, gp: 4 } } },
            // session 1 dies after failed fire
        ].map(JSON.stringify).join('\n') + '\n')

        const sessionB = path.join(tmp, 'watch-auto-2026-06-13T14-00-00-000Z.jsonl')
        writeFileSync(sessionB, [
            { event: 'startup', ts: '2026-06-13T14:00:39.000Z', targets: ['2026-06-20'] },
            { event: 'poll', ts: '2026-06-13T14:00:49.000Z', byDate: { '2026-06-20': { hi: 4, gp: 0 } } }, // ECHO 1
            { event: 'poll', ts: '2026-06-13T14:04:04.000Z', byDate: { '2026-06-20': { hi: 0, gp: 2 } } }, // ECHO 2
        ].map(JSON.stringify).join('\n') + '\n')

        const { reportPath } = await runChartCommand({
            sessionPath: sessionA,
            allSameDay: true,
            outDir: tmp,
        })
        const html = readFileSync(reportPath, 'utf-8')
        // Events from BOTH sessions should appear as transition annotations in
        // the embedded Chart.js config JSON.
        expect(html).toContain('"HI=10"') // session A
        expect(html).toContain('"GP=4"')  // session A
        expect(html).toContain('"HI=4"')  // session B echo at 07:00:49
        expect(html).toContain('"GP=2"')  // session B echo at 07:04:04
        // And the annotation xValue must match the echo timestamps (epoch ms).
        expect(html).toContain(String(Date.parse('2026-06-13T14:00:49.000Z'))) // HI=4 echo
        expect(html).toContain(String(Date.parse('2026-06-13T14:04:04.000Z'))) // GP=2 echo
    })

    test('session and target same day still works (sanity)', async () => {
        // Edge case: same-day session (rare but possible in test/sim runs).
        const session = writeFixtureSession([
            { event: 'startup', ts: '2026-06-20T13:55:00.000Z', targets: ['2026-06-20'] },
            { event: 'poll', ts: '2026-06-20T13:59:30.421Z', byDate: { '2026-06-20': { hi: 5, gp: 0 } } },
        ])
        const { reportPath } = await runChartCommand({
            sessionPath: session,
            outDir: tmp,
        })
        const html = readFileSync(reportPath, 'utf-8')
        expect(html).toContain('1 polls')
        expect(html).toContain('HI=5')
    })
})

describe('resolveDate', () => {
    test('returns override when provided', () => {
        expect(resolveDate([], '2026-07-01')).toBe('2026-07-01')
    })

    test('reads from startup.targets', () => {
        const events = [
            { event: 'startup', ts: 'x', targets: ['2026-06-20', '2026-06-21'] },
        ]
        expect(resolveDate(events)).toBe('2026-06-20')
    })

    test('falls back to first date in any poll byDate', () => {
        const events = [
            { event: 'poll', ts: 'x', byDate: { '2026-06-25': { hi: 0, gp: 0 } } },
        ]
        expect(resolveDate(events)).toBe('2026-06-25')
    })

    test('throws when no signal anywhere', () => {
        expect(() => resolveDate([{ event: 'heartbeat' }])).toThrow(/Could not infer/)
    })
})
