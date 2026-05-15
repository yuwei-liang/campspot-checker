export const STATUS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d0d0d" media="(prefers-color-scheme: dark)">
<title>campspot-checker</title>
<style>
  :root {
    --bg: #fafafa;
    --fg: #111;
    --muted: #666;
    --line: #ccc4;
    --card-bg: #fff;
    --card-shadow: 0 1px 3px rgba(0,0,0,0.06);
    --accent: #06c;
    --accent-bg: #06c1c;
    --green: #1a7f1a;
    --green-bg: #1a7f1a14;
    --red: #c33;
    --orange: #c66;
    --cold: #2f70b0;
    --pill-bg: #00000010;
    --pill-warn-bg: #c3331a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d0d0d;
      --fg: #ddd;
      --muted: #888;
      --line: #2a2a2a;
      --card-bg: #161616;
      --card-shadow: 0 1px 3px rgba(0,0,0,0.5);
      --accent: #6cf;
      --pill-bg: #ffffff14;
      --green-bg: #1a7f1a26;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--fg);
    background: var(--bg);
    -webkit-tap-highlight-color: transparent;
  }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 16px; }
  header.top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin-bottom: 12px; }
  header.top h1 { font-size: 18px; margin: 0; flex: 0 0 auto; }
  .meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); flex: 1 1 100%; }
  .meta span { white-space: nowrap; }
  .actions { display: flex; gap: 8px; align-items: center; flex: 0 0 auto; }
  button {
    font: inherit;
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--card-bg);
    color: inherit;
    cursor: pointer;
    min-height: 36px;
  }
  button:hover:not(:disabled) { background: var(--pill-bg); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .flash { font-size: 12px; }
  .flash.ok { color: var(--green); }
  .flash.err { color: var(--red); }

  .cards {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
    margin-top: 12px;
  }
  @media (min-width: 720px) {
    .cards { grid-template-columns: repeat(2, 1fr); }
  }
  @media (min-width: 1080px) {
    .cards { grid-template-columns: repeat(3, 1fr); }
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--card-shadow);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card.disabled { opacity: 0.55; }
  .card.disabled::after {
    content: "disabled";
    position: absolute;
    /* placeholder for screen readers — visual styling below */
  }
  .card-header { display: flex; gap: 10px; align-items: flex-start; }
  .toggle {
    cursor: pointer;
    width: 22px; height: 22px; flex: 0 0 auto;
    margin-top: 2px;
  }
  .card-title { flex: 1 1 auto; min-width: 0; }
  .park-badge {
    display: inline-block;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--pill-bg);
    color: var(--muted);
    margin-right: 6px;
    vertical-align: 2px;
  }
  .card-title a { color: inherit; text-decoration: none; font-weight: 600; font-size: 15px; }
  .card-title a:hover { color: var(--accent); }
  .card-meta {
    font-size: 11px; color: var(--muted); margin-top: 2px;
    display: flex; flex-wrap: wrap; gap: 4px;
  }
  .card-meta .sep { opacity: 0.4; }

  .status-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status { font-weight: 600; font-size: 13px; }
  .status.available { color: var(--green); }
  .status.all_reserved { color: var(--muted); }
  .status.error { color: var(--red); }
  .status.pending { color: var(--muted); }
  .count-pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--green-bg);
    color: var(--green);
  }
  .last-poll { font-size: 11px; color: var(--muted); margin-left: auto; }

  .date-list { list-style: none; padding: 0; margin: 4px 0 0; }
  .date-row {
    display: grid;
    grid-template-columns: 70px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 6px 0;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
  .date-row:first-child { border-top: none; }
  .date-label { color: var(--muted); }
  .date-label.weekend { color: var(--fg); }
  .weather { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
  .weather .temps.cold { color: var(--cold); font-weight: 600; }
  .weather .snow { color: var(--cold); }
  .date-count {
    font-weight: 600;
    color: var(--green);
    background: var(--green-bg);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
  }
  .date-count.zero { color: var(--muted); background: var(--pill-bg); font-weight: 400; }
  .more-dates { padding: 6px 0; font-size: 11px; color: var(--muted); }
  .err-msg { font-size: 12px; color: var(--red); }

  .sites-link {
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }
  .sites-link details summary { cursor: pointer; color: var(--accent); list-style: none; padding: 4px 0; }
  .sites-link details summary::-webkit-details-marker { display: none; }
  .sites-link details[open] summary::before { content: "▼ "; }
  .sites-link details summary::before { content: "▶ "; opacity: 0.6; }
  .sites-link .site-item {
    padding: 4px 0; border-top: 1px solid var(--line);
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
  }
  .sites-link .site-item:first-of-type { border-top: 1px solid var(--line); }
  .sites-link .site-item a { color: var(--accent); }
  .sites-link .site-detail { font-size: 10px; opacity: 0.7; }
  .sites-link .site-dates { font-size: 10px; color: var(--muted); }

  .panel { margin-top: 28px; }
  .panel h2 { font-size: 14px; margin: 0 0 8px; font-weight: 600; }
  .event-row {
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
    display: grid;
    grid-template-columns: 60px 1fr auto;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
  }
  .ev-time { color: var(--muted); font-size: 11px; }
  .ev-open { color: var(--green); font-weight: 600; font-size: 11px; }
  .ev-closed { color: var(--muted); font-size: 11px; }
  .empty-panel { font-size: 12px; color: var(--muted); padding: 8px 0; }

  .footer { margin-top: 24px; font-size: 11px; color: var(--muted); }
  .footer a { color: var(--accent); }
  a { color: var(--accent); }

  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; background: var(--pill-bg); font-size: 11px; }
  .pill.warn { background: var(--pill-warn-bg); color: #fff; }

  @media (max-width: 480px) {
    .wrap { padding: 12px; }
    header.top { gap: 8px; }
    .card { padding: 10px 12px; border-radius: 8px; }
    .card-title a { font-size: 14px; }
    .date-row { grid-template-columns: 64px 1fr auto; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>campspot-checker</h1>
    <div class="actions">
      <button id="poll-btn">Poll now</button>
      <span class="flash" id="poll-flash"></span>
    </div>
    <div class="meta" id="meta">loading…</div>
  </header>

  <main class="cards" id="cards"></main>

  <section class="panel">
    <h2>Recent events</h2>
    <div id="events" class="empty-panel">loading…</div>
  </section>

  <div class="footer">
    Auto-refreshes every 5 seconds. Weather: prior-year actuals from open-meteo.com.
    <a href="/api/status">/api/status</a> · <a href="/api/history">/api/history</a>
  </div>
</div>

<script>
let lastData = null

const WKDAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const escape = (s) => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]))

const fmtAgo = (iso) => {
  if (!iso) return '—'
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return sec + 's ago'
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago'
  return Math.floor(sec / 3600) + 'h ago'
}

const fmtDateShort = (iso) => {
  const d = new Date(iso)
  return WKDAY[d.getUTCDay()] + ' ' + iso.slice(5, 10)
}

const fmtDrive = (mins) => {
  if (mins == null) return null
  if (mins === 0) return 'in valley'
  if (mins < 60) return mins + ' min'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? h + 'h ' + m + 'm' : h + 'h'
}

const renderWeather = (w) => {
  if (!w) return '<span class="weather"><span class="temps muted">—</span></span>'
  const tmax = w.tmaxF != null ? Math.round(w.tmaxF) : null
  const tmin = w.tminF != null ? Math.round(w.tminF) : null
  const cold = tmin != null && tmin < 40
  const temps = (tmax != null && tmin != null) ? \`\${tmax}°/\${tmin}°\` : '—'
  const snow = (w.snowfallCm != null && w.snowfallCm > 0) ? \`<span class="snow" title="\${w.snowfallCm}cm snow">❄</span>\` : ''
  return \`<span class="weather"><span class="temps\${cold ? ' cold' : ''}">\${escape(temps)}</span>\${snow}</span>\`
}

const renderSiteItem = (s) => {
  const url = \`https://www.recreation.gov/camping/campsites/\${escape(s.campsiteId)}\`
  const detail = [s.loop, s.campsiteType, s.maxPeople ? 'max ' + s.maxPeople : null].filter(Boolean).join(' · ')
  const dates = (s.availableDates || []).map(fmtDateShort).join(', ')
  return \`<div class="site-item">
    <a href="\${url}" target="_blank" rel="noopener">Site \${escape(s.siteNO)}</a>
    \${detail ? \`<span class="site-detail">\${escape(detail)}</span>\` : ''}
    <span class="site-dates">\${escape(dates)}</span>
  </div>\`
}

const renderCard = (cg) => {
  const bookingUrl = \`https://www.recreation.gov/camping/campgrounds/\${cg.id}\`
  const m = cg.meta || {}
  const metaBits = [
    fmtDrive(m.valleyDriveMinutes),
    m.elevationFt ? m.elevationFt.toLocaleString() + ' ft' : null,
    m.season,
    m.totalSites ? m.totalSites + ' sites' : null,
    m.accessType,
  ].filter(Boolean)
  const metaLine = metaBits.map(escape).join(' <span class="sep">·</span> ')

  const checked = cg.enabled !== false ? 'checked' : ''
  const disabledCls = cg.enabled === false ? ' disabled' : ''

  let statusLabel = cg.status
  let countPill = ''
  if (cg.status === 'available') {
    statusLabel = 'AVAILABLE'
    const datesWithSites = Object.values(cg.availableByDate || {}).filter(n => n > 0).length
    countPill = \`<span class="count-pill">\${cg.availableSites.length} sites · \${datesWithSites} date\${datesWithSites === 1 ? '' : 's'}</span>\`
  } else if (cg.status === 'all_reserved') {
    statusLabel = 'all reserved'
  } else if (cg.status === 'pending') {
    statusLabel = 'pending first poll'
  } else if (cg.status === 'error') {
    statusLabel = 'ERROR'
  }

  // Build per-date list: only rows where there's >0 availability OR show all dates if no openings
  const dateEntries = Object.entries(cg.availableByDate || {})
  const datesWithSites = dateEntries.filter(([_, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b))
  const visibleDates = datesWithSites.slice(0, 12)
  const hiddenCount = datesWithSites.length - visibleDates.length

  const dateListHtml = visibleDates.length > 0 ? \`
    <ul class="date-list">
      \${visibleDates.map(([date, count]) => {
        const w = (cg.weatherByDate || {})[date]
        return \`<li class="date-row">
          <span class="date-label">\${escape(fmtDateShort(date))}</span>
          \${renderWeather(w)}
          <span class="date-count">\${count}</span>
        </li>\`
      }).join('')}
      \${hiddenCount > 0 ? \`<li class="more-dates">+\${hiddenCount} more date\${hiddenCount === 1 ? '' : 's'}</li>\` : ''}
    </ul>
  \` : ''

  const sitesHtml = cg.availableSites && cg.availableSites.length > 0 ? \`
    <div class="sites-link">
      <details>
        <summary>View all \${cg.availableSites.length} site\${cg.availableSites.length === 1 ? '' : 's'}</summary>
        \${cg.availableSites.slice(0, 30).map(renderSiteItem).join('')}
        \${cg.availableSites.length > 30 ? \`<div class="more-dates">+\${cg.availableSites.length - 30} more sites</div>\` : ''}
      </details>
    </div>
  \` : ''

  return \`<article class="card\${disabledCls}" data-id="\${cg.id}">
    <div class="card-header">
      <input type="checkbox" class="toggle" data-id="\${cg.id}" \${checked} title="Enable / disable polling">
      <div class="card-title">
        <div>
          \${cg.park ? \`<span class="park-badge">\${escape(cg.park)}</span>\` : ''}
          <a href="\${bookingUrl}" target="_blank" rel="noopener">\${escape(cg.name)}</a>
        </div>
        <div class="card-meta">\${metaLine}</div>
      </div>
    </div>
    <div class="status-line">
      <span class="status \${cg.status}">\${escape(statusLabel)}</span>
      \${countPill}
      <span class="last-poll">\${escape(fmtAgo(cg.lastPolledAt))}</span>
    </div>
    \${cg.error ? \`<div class="err-msg">\${escape(cg.error)}</div>\` : ''}
    \${dateListHtml}
    \${sitesHtml}
  </article>\`
}

const render = () => {
  if (!lastData) return
  const data = lastData

  const cycleInfo = data.cycle.lastFinishedAt
    ? \`last cycle finished \${fmtAgo(data.cycle.lastFinishedAt)} (\${data.cycle.cycleCount} total)\`
    : data.cycle.currentlyRunning
    ? 'first cycle running…'
    : 'waiting to start first cycle'

  const monthsLabel = data.monthStarts.length === 1
    ? data.monthStarts[0].slice(0, 7)
    : \`\${data.monthStarts.length} months (\${data.monthStarts[0].slice(0, 7)} → \${data.monthStarts[data.monthStarts.length - 1].slice(0, 7)})\`

  const backoffPill = data.backoffMs > 0
    ? \`<span class="pill warn">backoff \${data.backoffMs}ms</span>\`
    : ''

  document.getElementById('meta').innerHTML =
    \`<span>\${escape(monthsLabel)}</span>\` +
    \`<span>\${data.targetDates.length} dates</span>\` +
    \`<span>\${escape(cycleInfo)}</span>\` +
    backoffPill

  document.getElementById('cards').innerHTML = data.campgrounds.map(renderCard).join('')
}

const refresh = async () => {
  try {
    const res = await fetch('/api/status')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    lastData = await res.json()
    render()
  } catch (e) {
    document.getElementById('cards').innerHTML =
      \`<div class="err-msg">failed to load /api/status: \${escape(e.message)}</div>\`
  }
}

const cgName = (id) => {
  const cg = lastData?.campgrounds?.find(c => c.id === id)
  return cg ? (cg.park ? '[' + cg.park + '] ' : '') + cg.name : 'id:' + id
}

const renderEvents = (events) => {
  const el = document.getElementById('events')
  if (!events.length) {
    el.className = 'empty-panel'
    el.innerHTML = 'no events yet — the very first cycle establishes the baseline.'
    return
  }
  el.className = ''
  el.innerHTML = events.map(ev => {
    const datePart = ev.targetDate ? fmtDateShort(ev.targetDate) : '—'
    const cls = ev.event === 'opened' ? 'ev-open' : 'ev-closed'
    const siteUrl = \`https://www.recreation.gov/camping/campsites/\${escape(ev.campsiteId)}\`
    return \`<div class="event-row">
      <span class="ev-time">\${fmtAgo(ev.seenAt)}</span>
      <span>\${escape(cgName(ev.campgroundId))} <a href="\${siteUrl}" target="_blank">Site \${escape(ev.siteNo || ev.campsiteId)}</a> · \${escape(datePart)}</span>
      <span class="\${cls}">\${ev.event}</span>
    </div>\`
  }).join('')
}

const refreshEvents = async () => {
  try {
    const res = await fetch('/api/history?limit=50')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    renderEvents(data.events || [])
  } catch (e) {
    document.getElementById('events').innerHTML =
      \`<span class="err-msg">failed to load /api/history: \${escape(e.message)}</span>\`
  }
}

refresh()
refreshEvents()
setInterval(refresh, 5000)
setInterval(refreshEvents, 10000)

const pollBtn = document.getElementById('poll-btn')
const pollFlash = document.getElementById('poll-flash')
const setFlash = (msg, cls) => {
  pollFlash.textContent = msg
  pollFlash.className = 'flash ' + (cls || '')
  if (msg) setTimeout(() => { if (pollFlash.textContent === msg) setFlash('', '') }, 4000)
}

pollBtn.addEventListener('click', async () => {
  pollBtn.disabled = true
  setFlash('triggering…', '')
  try {
    const res = await fetch('/api/poll', { method: 'POST' })
    if (res.ok) {
      setFlash('poll started — watch the timestamps refresh', 'ok')
      setTimeout(refresh, 1500)
    } else {
      const body = await res.json().catch(() => ({}))
      const reason = body.reason ? \` (\${body.reason})\` : ''
      setFlash(\`already running\${reason}\`, 'err')
    }
  } catch (e) {
    setFlash('request failed: ' + e.message, 'err')
  } finally {
    setTimeout(() => { pollBtn.disabled = false }, 1000)
  }
})

document.getElementById('cards').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('toggle')) return
  const id = Number(e.target.dataset.id)
  const enabled = e.target.checked
  e.target.disabled = true
  try {
    const res = await fetch(\`/api/campgrounds/\${id}/enabled\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    if (lastData) {
      const cg = lastData.campgrounds.find(c => c.id === id)
      if (cg) cg.enabled = enabled
    }
    render()
    setTimeout(refresh, 500)
  } catch (err) {
    setFlash('toggle failed: ' + err.message, 'err')
    e.target.checked = !enabled
  } finally {
    setTimeout(() => { e.target.disabled = false }, 300)
  }
})
</script>
</body>
</html>`
