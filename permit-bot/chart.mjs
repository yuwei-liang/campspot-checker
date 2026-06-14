// SVG/HTML chart rendering for session logs. The 06-13 morning post-mortem
// proved that a single line-chart of API tick history (HI/GP remaining vs.
// time, with null gaps and labeled transitions) makes patterns instantly
// readable that text summaries hide. This module turns a JSONL session log
// into a self-contained SVG + HTML report.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const PT_OFFSET_SEC = -7 * 3600

function formatPT(epochSec) {
    const d = new Date((epochSec + PT_OFFSET_SEC) * 1000)
    return d.toISOString().slice(11, 19) // HH:MM:SS
}

function stateOf(v) {
    if (v == null) return 'null'
    if (v === 0) return 'zero'
    return 'pos'
}

// Build {ts, hi, gp} tuples + a list of zero/null → positive transitions
// worth labeling. Takes the full event stream (not just polls) so that
// `startup` events can RESET the prev tracker — a session restart represents
// a gap we don't have data for, so the first poll of a new session should
// count as a fresh transition if it shows stock.
function extractTrack(allEvents, date) {
    const points = []
    const events = []
    let prevHi = null, prevGp = null
    for (const ev of allEvents) {
        if (ev.event === 'startup') {
            // New session = unknown state in between. Reset so the next
            // poll's non-zero state counts as a transition.
            prevHi = null
            prevGp = null
            continue
        }
        if (ev.event !== 'poll') continue
        const b = ev.byDate?.[date]
        if (!b) continue
        const ts = Date.parse(ev.ts) / 1000
        const hi = b.hi
        const gp = b.gp
        points.push({ ts, hi, gp })
        if ((prevHi == null || prevHi === 0) && hi != null && hi > 0) {
            events.push({ kind: 'HI', ts, v: hi })
        }
        if ((prevGp == null || prevGp === 0) && gp != null && gp > 0) {
            events.push({ kind: 'GP', ts, v: gp })
        }
        prevHi = hi
        prevGp = gp
    }
    return { points, events }
}

// Step path with explicit null breaks. Returns array of polyline segments,
// each a list of {x, y} pairs. Exported for testing.
//
// Step-before convention: when value changes from v_prev to v_curr between
// polls at x_prev and x_curr, the line stays flat at v_prev until x_curr,
// then steps VERTICALLY to v_curr at x_curr. This requires both (x_curr,
// v_prev) and (x_curr, v_curr) in the path. Without the second point the
// line is diagonal — the bug visible at the 06:59:30 release.
export function stepSegments(points, kind, scaleX, scaleY) {
    const segments = []
    let cur = null
    let prevY = null
    for (let i = 0; i < points.length; i++) {
        const v = kind === 'HI' ? points[i].hi : points[i].gp
        if (v == null) { cur = null; prevY = null; continue }
        const x = scaleX(points[i].ts)
        const y = scaleY(v)
        const nextTs = i + 1 < points.length ? points[i + 1].ts : points[i].ts
        const nextX = scaleX(nextTs)
        if (cur == null) {
            cur = [{ x, y }]
            segments.push(cur)
        } else if (y !== prevY) {
            // Value changed — insert the vertical step at this poll's x.
            cur.push({ x, y })
        }
        // Hold the value flat until the next poll's x.
        cur.push({ x: nextX, y })
        prevY = y
    }
    return segments
}

// Compute peak hi+gp across the window with timestamp.
function peakTotal(points) {
    let peak = { v: 0, ts: null }
    for (const p of points) {
        const t = (p.hi ?? 0) + (p.gp ?? 0)
        if (t > peak.v) peak = { v: t, ts: p.ts }
    }
    return peak
}

const HI_COLOR = '#1976d2'
const GP_COLOR = '#2e7d32'
const HI_LABEL = 'Happy Isles→LYV remaining'
const GP_LABEL = 'Glacier Point→LYV remaining'

// Build a Chart.js v4 config for the API tick history. Step chart, real null
// gaps, annotated release line, and pointRadius arrays so transitions stand
// out as labeled dots while normal polls render as invisible vertices. The
// browser renders it — no more hand-rolled SVG / step-chart bugs.
export function buildChartConfig({ events, date, fromIso, toIso, releaseTimeIso = null }) {
    const fromMs = typeof fromIso === 'number' ? fromIso : Date.parse(fromIso)
    const toMs = typeof toIso === 'number' ? toIso : Date.parse(toIso)
    const inWindow = events.filter(ev => {
        const t = Date.parse(ev.ts)
        return t >= fromMs && t <= toMs
    })
    const { points, events: transitions } = extractTrack(inWindow, date)

    // Build {x: epochMs, y: value|null} arrays + per-point radius arrays.
    // Transitions get a visible dot; everything else hides at radius 0.
    const transitionSet = new Set(transitions.map(t => `${t.kind}|${t.ts}`))
    const buildSeries = (kind) => {
        const data = []
        const radii = []
        const colors = []
        for (const p of points) {
            const v = kind === 'HI' ? p.hi : p.gp
            data.push({ x: p.ts * 1000, y: v ?? null })
            const isTransition = transitionSet.has(`${kind}|${p.ts}`)
            radii.push(isTransition ? 5 : 0)
            colors.push(isTransition ? (kind === 'HI' ? HI_COLOR : GP_COLOR) : 'transparent')
        }
        return { data, radii, colors }
    }
    const hi = buildSeries('HI')
    const gp = buildSeries('GP')

    // Default release marker: 06:59:30 PT on the session day (= fromMs's
    // PT calendar date). Caller can override via releaseTimeIso.
    let releaseMs = null
    if (releaseTimeIso) {
        releaseMs = Date.parse(releaseTimeIso)
    } else if (fromMs) {
        const ptDate = ptCalendarDate(new Date(fromMs).toISOString())
        releaseMs = Date.parse(`${ptDate}T06:59:30-07:00`)
    }
    const annotations = {}
    if (releaseMs != null) {
        annotations.releaseLine = {
            type: 'line',
            xMin: releaseMs,
            xMax: releaseMs,
            borderColor: '#d32f2f',
            borderWidth: 1.5,
            borderDash: [4, 4],
            label: {
                display: true,
                content: 'release',
                position: 'start',
                color: '#d32f2f',
                backgroundColor: 'rgba(255,255,255,0.9)',
                font: { weight: 'bold', size: 11 },
            },
        }
    }
    // Annotate each transition with a small label box pointing at the dot.
    for (const t of transitions) {
        annotations[`label_${t.kind}_${t.ts}`] = {
            type: 'label',
            xValue: t.ts * 1000,
            yValue: t.v,
            content: [`${t.kind}=${t.v}`],
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderColor: t.kind === 'HI' ? HI_COLOR : GP_COLOR,
            borderWidth: 1,
            borderRadius: 3,
            color: t.kind === 'HI' ? HI_COLOR : GP_COLOR,
            font: { size: 10, weight: 500 },
            padding: { top: 2, bottom: 2, left: 6, right: 6 },
            yAdjust: -22,
        }
    }

    const peak = peakTotal(points)

    return {
        type: 'line',
        data: {
            datasets: [
                {
                    label: HI_LABEL,
                    data: hi.data,
                    borderColor: HI_COLOR,
                    backgroundColor: HI_COLOR,
                    stepped: 'before',
                    spanGaps: false,
                    pointRadius: hi.radii,
                    pointBackgroundColor: hi.colors,
                    pointBorderColor: hi.colors,
                    borderWidth: 2,
                    tension: 0,
                },
                {
                    label: GP_LABEL,
                    data: gp.data,
                    borderColor: GP_COLOR,
                    backgroundColor: GP_COLOR,
                    stepped: 'before',
                    spanGaps: false,
                    pointRadius: gp.radii,
                    pointBackgroundColor: gp.colors,
                    pointBorderColor: gp.colors,
                    borderWidth: 2,
                    tension: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false, axis: 'x' },
            scales: {
                x: {
                    type: 'time',
                    min: fromMs,
                    max: toMs,
                    time: {
                        unit: 'minute',
                        stepSize: 5,
                        displayFormats: { minute: 'HH:mm' },
                        tooltipFormat: 'HH:mm:ss',
                    },
                    adapters: { date: { zone: 'America/Los_Angeles' } },
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: Math.max(11, peak.v + 1),
                    title: { display: true, text: 'remaining' },
                },
            },
            plugins: {
                title: {
                    display: true,
                    text: `rec.gov API tick history — ${date} LYV`,
                    font: { size: 16 },
                },
                subtitle: {
                    display: true,
                    text: peak.v > 0
                        ? `${points.length} polls · peak hi+gp=${peak.v} · gaps = API returned null (— in heartbeat)`
                        : `${points.length} polls · no concurrent stock · gaps = API returned null (— in heartbeat)`,
                    font: { size: 11 },
                    color: '#666',
                    padding: { bottom: 12 },
                },
                legend: { position: 'top' },
                tooltip: { mode: 'nearest', intersect: false },
                annotation: { annotations },
            },
        },
        _peak: peak,
        _pollsCount: points.length,
    }
}

// Render a step-line chart of HI + GP for `date` across the [fromTs, toTs]
// window. `events` is the raw session event stream — extractTrack uses
// startup events as session boundaries (resets prev tracking), so passing
// only polls works for single-session charts and passing the full stream
// (including startups) works for multi-session merges.
export function renderSvg({
    events: rawEvents,
    polls,             // legacy alias — callers passing polls only still work
    date,
    fromIso,           // ISO string "2026-06-13T06:50:00-07:00" or epoch ms
    toIso,
    title = null,
    yMax = 11,
    width = 1400,
    height = 620,
    releaseTimePT = '06:59:30', // dashed vertical marker
}) {
    const fromTs = typeof fromIso === 'number' ? fromIso / 1000 : Date.parse(fromIso) / 1000
    const toTs = typeof toIso === 'number' ? toIso / 1000 : Date.parse(toIso) / 1000

    const padL = 60, padR = 30, padT = 200, padB = 70
    const pw = width - padL - padR
    const ph = height - padT - padB

    const scaleX = (t) => padL + ((t - fromTs) / (toTs - fromTs)) * pw
    const scaleY = (v) => padT + ph - (v / yMax) * ph

    const source = rawEvents || polls || []
    const inWindow = source.filter(ev => {
        const t = Date.parse(ev.ts) / 1000
        return t >= fromTs && t <= toTs
    })
    const { points, events } = extractTrack(inWindow, date)
    const peak = peakTotal(points)
    events.sort((a, b) => a.ts - b.ts)

    const HI = '#1976d2'
    const GP = '#2e7d32'
    const out = []
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="-apple-system, sans-serif" font-size="12">`)
    out.push(`<rect width="${width}" height="${height}" fill="#fafafa"/>`)

    // Y gridlines + labels
    for (let v = 0; v <= yMax; v += 2) {
        const y = scaleY(v)
        out.push(`<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e0e0e0"/>`)
        out.push(`<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#666">${v}</text>`)
    }

    // X gridlines every 5 min
    for (let t = fromTs; t <= toTs; t += 300) {
        const x = scaleX(t)
        out.push(`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + ph}" stroke="#e0e0e0"/>`)
        out.push(`<text x="${x}" y="${padT + ph + 18}" text-anchor="middle" fill="#666">${formatPT(t).slice(0, 5)}</text>`)
    }

    // Axes
    out.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ph}" stroke="#333"/>`)
    out.push(`<line x1="${padL}" y1="${padT + ph}" x2="${width - padR}" y2="${padT + ph}" stroke="#333"/>`)

    // Release marker
    if (releaseTimePT) {
        const [hh, mm, ss] = releaseTimePT.split(':').map(Number)
        // Build epoch ts by anchoring to the same day as fromTs
        const fromDate = new Date(fromTs * 1000)
        const utcReleaseHour = hh - PT_OFFSET_SEC / 3600
        const releaseTs = Math.floor(
            Date.UTC(
                fromDate.getUTCFullYear(),
                fromDate.getUTCMonth(),
                fromDate.getUTCDate(),
                utcReleaseHour, mm, ss
            ) / 1000
        )
        if (releaseTs >= fromTs && releaseTs <= toTs) {
            const rx = scaleX(releaseTs)
            out.push(`<line x1="${rx}" y1="${padT}" x2="${rx}" y2="${padT + ph}" stroke="#d32f2f" stroke-width="1" stroke-dasharray="4 4"/>`)
            out.push(`<text x="${rx + 4}" y="${padT + 12}" fill="#d32f2f" font-weight="bold">${releaseTimePT} release</text>`)
        }
    }

    // Step-lines
    const hiSegs = stepSegments(points, 'HI', scaleX, scaleY)
    const gpSegs = stepSegments(points, 'GP', scaleX, scaleY)
    for (const seg of hiSegs) {
        if (seg.length < 2) continue
        out.push(`<polyline points="${seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${HI}" stroke-width="2"/>`)
    }
    for (const seg of gpSegs) {
        if (seg.length < 2) continue
        out.push(`<polyline points="${seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${GP}" stroke-width="2"/>`)
    }

    // Event labels in a 6-row staggered band above the chart, each with a
    // dashed leader line to its dot.
    const labelRows = [70, 95, 120, 145, 170, 195]
    events.forEach((e, i) => {
        const x = scaleX(e.ts)
        const y = scaleY(e.v)
        const color = e.kind === 'HI' ? HI : GP
        const labelY = labelRows[i % labelRows.length]
        out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}"/>`)
        out.push(`<line x1="${x.toFixed(1)}" y1="${(labelY + 6).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 4).toFixed(1)}" stroke="${color}" stroke-width="0.6" stroke-dasharray="3 2" opacity="0.7"/>`)
        const text = `${e.kind}=${e.v} @ ${formatPT(e.ts)}`
        const textW = text.length * 6.2 + 8
        out.push(`<rect x="${(x - textW / 2).toFixed(1)}" y="${(labelY - 10).toFixed(1)}" width="${textW.toFixed(1)}" height="15" fill="white" stroke="${color}" stroke-width="0.7" rx="3"/>`)
        out.push(`<text x="${x.toFixed(1)}" y="${(labelY + 1).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="10" font-weight="500">${text}</text>`)
    })

    // Title + subtitle
    const titleText = title || `rec.gov API tick history — ${date} LYV (${formatPT(fromTs).slice(0, 5)}–${formatPT(toTs).slice(0, 5)} PT)`
    const peakLine = peak.v > 0
        ? `${inWindow.length} polls · peak hi+gp=${peak.v} at ${formatPT(peak.ts)} PT · gaps = API returned null (— in heartbeat)`
        : `${inWindow.length} polls · no concurrent stock · gaps = API returned null (— in heartbeat)`
    out.push(`<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold">${titleText}</text>`)
    out.push(`<text x="${width / 2}" y="42" text-anchor="middle" font-size="11" fill="#666">${peakLine}</text>`)

    // Legend
    const lx = width - 240, ly = padT + 10
    out.push(`<rect x="${lx}" y="${ly}" width="220" height="44" fill="white" stroke="#ccc" rx="3"/>`)
    out.push(`<line x1="${lx + 10}" y1="${ly + 14}" x2="${lx + 30}" y2="${ly + 14}" stroke="${HI}" stroke-width="2"/>`)
    out.push(`<text x="${lx + 36}" y="${ly + 18}">Happy Isles→LYV remaining</text>`)
    out.push(`<line x1="${lx + 10}" y1="${ly + 32}" x2="${lx + 30}" y2="${ly + 32}" stroke="${GP}" stroke-width="2"/>`)
    out.push(`<text x="${lx + 36}" y="${ly + 36}">Glacier Point→LYV remaining</text>`)

    // Y-axis label
    out.push(`<text x="20" y="${padT + ph / 2}" text-anchor="middle" transform="rotate(-90 20 ${padT + ph / 2})" fill="#333">remaining</text>`)

    out.push('</svg>')
    return out.join('\n')
}

// Read a JSONL session log, return the parsed events.
export function readSessionLog(filePath) {
    const raw = readFileSync(filePath, 'utf-8')
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

// Find the most recent .jsonl session log under permit-bot/logs/.
export function latestSessionLogPath(logsDir = 'permit-bot/logs') {
    const entries = readdirSync(logsDir)
        .filter(f => f.startsWith('watch-auto-') && f.endsWith('.jsonl'))
        .map(f => ({ name: f, full: path.join(logsDir, f), mtime: statSync(path.join(logsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    if (entries.length === 0) throw new Error(`No session logs found in ${logsDir}`)
    return entries[0].full
}

// HTML report: embeds the SVG, lists fires + heartbeats from the session.
export function renderHtmlReport({ sessionEvents, date, fromIso, toIso, sessionPath }) {
    const polls = sessionEvents.filter(e => e.event === 'poll')
    const fires = sessionEvents.filter(e => e.event === 'fire_results')
    const heartbeats = sessionEvents.filter(e => e.event === 'heartbeat')
    const startup = sessionEvents.find(e => e.event === 'startup')

    // Chart.js v4 config. Browser renders it — proper step charts, real null
    // gaps via spanGaps:false, annotation plugin for the release marker, no
    // hand-rolled SVG bugs. Pass the full event stream so startup events act
    // as session-boundary resets in transition detection.
    const chartConfig = buildChartConfig({ events: sessionEvents, date, fromIso, toIso })

    const fireRows = fires.map(f => {
        const acct = f.results?.[0]
        const reason = acct?.reason || (acct?.cartState === 'held' ? 'held' : acct?.cartState || 'unknown')
        const kpi = acct?.latencyMs?.apiSignalToBookClickMs ?? '-'
        const reload = acct?.latencyMs?.reloadOutcome ?? 'not needed'
        return `<tr>
            <td>${f.ts}</td>
            <td><code>${f.fireId}</code></td>
            <td>${f.date}</td>
            <td>${reason}</td>
            <td>${kpi}ms</td>
            <td>${reload}</td>
        </tr>`
    }).join('')

    const heartbeatBlocks = heartbeats.slice(-5).map(h => `
        <div class="hb">
            <div class="hb-time">${h.ts} · poll #${h.pollCount} · ${h.uptimeMin}min uptime</div>
            <div class="hb-snap">${h.lastSnapshotSummary}</div>
            <pre>${(h.windowSummary || []).join('\n')}</pre>
            <pre>${(h.wouldFireSummary || []).join('\n')}</pre>
        </div>
    `).join('')

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>permit-bot session report — ${date}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js"></script>
<style>
    body { font-family: -apple-system, sans-serif; max-width: 1500px; margin: 20px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
    .chart-wrap { position: relative; height: 480px; margin: 16px 0 28px; background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; }
    code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    .hb { background: #fafafa; border-left: 3px solid #1976d2; padding: 8px 12px; margin: 10px 0; font-size: 12px; }
    .hb-time { color: #666; font-size: 11px; }
    .hb-snap { font-weight: 500; margin: 4px 0; }
    pre { margin: 4px 0; font-family: ui-monospace, Menlo, monospace; font-size: 11px; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>permit-bot session — ${date}</h1>
<div class="meta">
    Session log: <code>${sessionPath}</code>
    · ${polls.length} polls
    · ${fires.length} fires
    · ${heartbeats.length} heartbeats
    ${startup ? `· targets: ${(startup.targets || []).join(', ')}` : ''}
</div>
<div class="chart-wrap"><canvas id="tickChart"></canvas></div>
<script>
    // Wait until Chart.js + plugins are loaded before instantiating.
    window.addEventListener('load', () => {
        if (window.Chart && window['chartjs-plugin-annotation']) {
            Chart.register(window['chartjs-plugin-annotation']);
        }
        const config = ${JSON.stringify(chartConfig)};
        new Chart(document.getElementById('tickChart').getContext('2d'), config);
    });
</script>
<h2>Fires (${fires.length})</h2>
${fires.length > 0 ? `<table>
    <tr><th>ts</th><th>fireId</th><th>date</th><th>outcome</th><th>API→bookClick</th><th>reload</th></tr>
    ${fireRows}
</table>` : '<p><em>No fires this session.</em></p>'}
<h2>Last ${Math.min(5, heartbeats.length)} heartbeats</h2>
${heartbeatBlocks || '<p><em>No heartbeats yet.</em></p>'}
</body>
</html>`
}

// Resolve the active date for the report. If --date isn't provided, use the
// first date the session targeted (per startup event) or the first date that
// appears in any poll's byDate.
export function resolveDate(sessionEvents, overrideDate) {
    if (overrideDate) return overrideDate
    const startup = sessionEvents.find(e => e.event === 'startup')
    if (startup?.targets?.length) return startup.targets[0]
    for (const ev of sessionEvents) {
        if (ev.byDate) {
            const keys = Object.keys(ev.byDate)
            if (keys.length) return keys.sort()[0]
        }
    }
    throw new Error('Could not infer target date from session log; pass --date=YYYY-MM-DD')
}

// PT calendar date of an ISO timestamp. Uses Intl to handle DST correctly
// (PDT in summer, PST in winter — important for races near time boundaries).
export function ptCalendarDate(isoTs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(isoTs))
    const y = parts.find(p => p.type === 'year').value
    const m = parts.find(p => p.type === 'month').value
    const d = parts.find(p => p.type === 'day').value
    return `${y}-${m}-${d}`
}

// CLI entry: read session log, render HTML, write to reports/.
// allSameDay: when true, also load every other session log in the same
// directory whose first event falls on the same PT calendar day, and merge
// their events. Race-day reality is multi-session (bot restarts mid-morning).
export async function runChartCommand({ sessionPath, date, fromHHMM, toHHMM, allSameDay = false, windowDay = null, outDir = 'permit-bot/reports' }) {
    let events = readSessionLog(sessionPath)
    // Window day priority:
    //   1. --window-day CLI override
    //   2. PT day of the first decision/fire_results (the action day, even if
    //      the session started days earlier)
    //   3. PT day of startup (sole long-running session fallback)
    // Long-running sessions span midnight; old code anchored on startup and
    // produced an empty chart when the race ran on a different day.
    let sessionDayPT
    if (windowDay) {
        sessionDayPT = windowDay
    } else {
        const action = events.find(e => e.event === 'decision' || e.event === 'fire_results')
        const anchor = action || events.find(e => e.event === 'startup') || events[0]
        sessionDayPT = ptCalendarDate(anchor.ts)
    }
    if (allSameDay) {
        const dir = path.dirname(sessionPath)
        const siblings = readdirSync(dir)
            .filter(f => f.endsWith('.jsonl') && path.join(dir, f) !== sessionPath)
            .map(f => path.join(dir, f))
        for (const sib of siblings) {
            const sibEvents = readSessionLog(sib)
            const sibFirst = sibEvents.find(e => e.event === 'startup') || sibEvents[0]
            if (!sibFirst) continue
            if (ptCalendarDate(sibFirst.ts) === sessionDayPT) {
                events = events.concat(sibEvents)
            }
        }
        // Sort merged events by ts so the chart's transition-detection sees a
        // single monotonic stream rather than two interleaved.
        events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    }
    const targetDate = resolveDate(events, date)
    const ptWindow = (hhmm) => {
        const [hh, mm] = hhmm.split(':').map(Number)
        return `${sessionDayPT}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-07:00`
    }
    const html = renderHtmlReport({
        sessionEvents: events,
        date: targetDate,
        fromIso: ptWindow(fromHHMM || '06:50'),
        toIso: ptWindow(toHHMM || '07:35'),
        sessionPath,
    })

    mkdirSync(outDir, { recursive: true })
    const sessionTag = path.basename(sessionPath).replace(/\.jsonl$/, '')
    const reportPath = path.join(outDir, `${sessionTag}-${targetDate}.html`)
    writeFileSync(reportPath, html)
    return { reportPath, polls: events.filter(e => e.event === 'poll').length }
}
