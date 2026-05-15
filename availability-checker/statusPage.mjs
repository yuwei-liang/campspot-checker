export const STATUS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>campspot-checker</title>
<style>
  body { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
         margin: 24px; max-width: 1180px;
         color: #111; background: #fafafa; }
  @media (prefers-color-scheme: dark) {
    body { color: #ddd; background: #111; }
    th { background: #222 !important; }
    tr:hover { background: #1c1c1c !important; }
    a { color: #6cf; }
  }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta { margin-bottom: 16px; font-size: 12px; opacity: 0.8; }
  .meta span { margin-right: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc3; vertical-align: top; }
  th { background: #eee; font-weight: 600; }
  tr:hover { background: #0001; }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { text-decoration: underline; }
  th .arrow { font-size: 10px; opacity: 0.6; margin-left: 4px; }
  .status { font-weight: 600; }
  .status.available { color: #1a7f1a; }
  .status.all_reserved { color: #888; }
  .status.error { color: #c33; }
  .status.pending { color: #999; }
  .sites { font-size: 12px; line-height: 1.4; }
  .meta-sub { font-size: 11px; opacity: 0.6; margin-top: 2px; }
  .err { color: #c33; font-size: 12px; }
  .footer { margin-top: 16px; font-size: 12px; opacity: 0.6; }
  a { color: #06c; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .pill { display: inline-block; padding: 2px 6px; border-radius: 4px;
          background: #0002; font-size: 11px; }
  .pill.warn { background: #c3331a; color: #fff; }
  .num { text-align: right; white-space: nowrap; }
  .actions { margin-bottom: 12px; }
  button { font: inherit; padding: 6px 12px; border: 1px solid #888; border-radius: 4px;
           background: #fff; color: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: #eee; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (prefers-color-scheme: dark) {
    button { background: #222; border-color: #555; }
    button:hover:not(:disabled) { background: #2a2a2a; }
  }
  .flash { margin-left: 12px; font-size: 12px; }
  .flash.ok { color: #1a7f1a; }
  .flash.err { color: #c33; }
  .date-counts { margin-bottom: 4px; }
  .date-pill { background: #1a7f1a22; }
  .site-row { padding: 2px 0; border-bottom: 1px dashed #ccc4; line-height: 1.3; }
  .site-row:last-of-type { border-bottom: none; }
  .site-detail { font-size: 11px; opacity: 0.65; margin-left: 6px; }
  .site-dates { display: inline-block; margin-left: 6px; }
  .more { font-size: 11px; opacity: 0.6; padding-top: 4px; }
  .panel { margin-top: 32px; }
  .panel h2 { font-size: 14px; margin: 0 0 8px; }
  .event-row { padding: 4px 0; border-bottom: 1px solid #ccc3; display: grid;
               grid-template-columns: 90px 1fr 80px 140px; gap: 8px; align-items: baseline;
               font-size: 12px; line-height: 1.4; }
  .event-row .ev-time { opacity: 0.6; }
  .event-row .ev-open { color: #1a7f1a; font-weight: 600; }
  .event-row .ev-closed { color: #888; }
  .empty-panel { font-size: 12px; opacity: 0.5; padding: 8px 0; }
  tr.disabled { opacity: 0.4; }
  tr.disabled td { background: repeating-linear-gradient(45deg, transparent, transparent 6px, #0000000a 6px, #0000000a 12px); }
  .toggle { cursor: pointer; }
</style>
</head>
<body>
<h1>campspot-checker</h1>
<div class="actions">
  <button id="poll-btn">Poll now</button>
  <span class="flash" id="poll-flash"></span>
</div>
<div class="meta" id="meta">loading…</div>
<table>
  <thead>
    <tr>
      <th>On</th>
      <th class="sortable" data-sort="name">Campground</th>
      <th class="sortable" data-sort="drive">Drive to valley</th>
      <th class="sortable" data-sort="elev">Elev</th>
      <th>Season</th>
      <th class="sortable" data-sort="total">Sites</th>
      <th class="sortable" data-sort="lastPoll">Last poll</th>
      <th class="sortable" data-sort="status">Status</th>
      <th>Available</th>
    </tr>
  </thead>
  <tbody id="rows"></tbody>
</table>
<div class="panel">
  <h2>Recent events</h2>
  <div id="events" class="empty-panel">loading…</div>
</div>

<div class="footer">Auto-refreshes every 5 seconds. Click a header to sort. <a href="/api/status">/api/status</a> · <a href="/api/history">/api/history</a></div>

<script>
let lastData = null
let sortKey = 'drive'
let sortDir = 'asc'

const fmtAgo = (iso) => {
  if (!iso) return '—'
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return sec + 's ago'
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago'
  return Math.floor(sec / 3600) + 'h ago'
}

const fmtDrive = (mins) => {
  if (mins == null) return '—'
  if (mins === 0) return 'in valley'
  if (mins < 60) return mins + ' min'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? \`\${h}h \${m}m\` : \`\${h}h\`
}

const fmtElev = (ft) => ft == null ? '—' : ft.toLocaleString() + ' ft'

const escape = (s) => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]))

const WKDAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const fmtDateShort = (iso) => {
  const d = new Date(iso)
  return \`\${WKDAY[d.getUTCDay()]} \${iso.slice(5, 10)}\`
}

const renderDateCounts = (availableByDate) => {
  const entries = Object.entries(availableByDate || {})
    .filter(([_, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return ''
  return entries.map(([date, n]) =>
    \`<span class="pill date-pill">\${escape(fmtDateShort(date))}: \${n}</span>\`
  ).join(' ')
}

const renderSiteDetail = (s) => {
  const bits = [s.loop, s.campsiteType, s.maxPeople ? \`max \${s.maxPeople}\` : null]
    .filter(Boolean)
  if (!bits.length) return ''
  return \`<span class="site-detail">\${escape(bits.join(' · '))}</span>\`
}

const renderSiteDates = (dates) => {
  if (!dates || !dates.length) return ''
  return dates.map(d => \`<span class="pill date-pill">\${escape(fmtDateShort(d))}</span>\`).join(' ')
}

const renderSites = (cg) => {
  const sites = cg.availableSites || []
  if (!sites.length) return '—'
  const counts = renderDateCounts(cg.availableByDate)
  const shown = sites.slice(0, 5)
  const more = sites.length - shown.length
  const siteRows = shown.map(s =>
    \`<div class="site-row">
       <a href="\${escape(s.url)}" target="_blank">Site \${escape(s.siteNO)}</a>
       \${renderSiteDetail(s)}
       <div class="site-dates">\${renderSiteDates(s.availableDates)}</div>
     </div>\`
  ).join('')
  const moreLine = more > 0 ? \`<div class="more">+\${more} more</div>\` : ''
  return \`<div class="date-counts">\${counts}</div>\${siteRows}\${moreLine}\`
}

const renderStatus = (cg) => {
  const cls = cg.status
  const total = (cg.availableSites || []).length
  let label = cg.status
  if (cg.status === 'available') label = \`AVAILABLE (\${total})\`
  if (cg.status === 'all_reserved') label = 'all reserved'
  if (cg.status === 'pending') label = 'pending first poll'
  if (cg.status === 'error') label = 'ERROR'
  return \`<span class="status \${cls}">\${escape(label)}</span>\` +
         (cg.error ? \`<div class="err">\${escape(cg.error)}</div>\` : '')
}

const STATUS_RANK = { available: 0, error: 1, pending: 2, all_reserved: 3 }

const sortValue = (cg, key) => {
  const m = cg.meta || {}
  if (key === 'name') return cg.name.toLowerCase()
  if (key === 'drive') return m.valleyDriveMinutes ?? Infinity
  if (key === 'elev') return m.elevationFt ?? -Infinity
  if (key === 'total') return m.totalSites ?? -Infinity
  if (key === 'lastPoll') return cg.lastPolledAt ? new Date(cg.lastPolledAt).getTime() : -Infinity
  if (key === 'status') return STATUS_RANK[cg.status] ?? 99
  return 0
}

const sortRows = (campgrounds) => {
  const dir = sortDir === 'asc' ? 1 : -1
  return [...campgrounds].sort((a, b) => {
    const va = sortValue(a, sortKey)
    const vb = sortValue(b, sortKey)
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
}

const render = () => {
  if (!lastData) return
  const data = lastData

  const cycleInfo = data.cycle.lastFinishedAt
    ? \`last cycle finished \${fmtAgo(data.cycle.lastFinishedAt)} (\${data.cycle.cycleCount} total)\`
    : data.cycle.currentlyRunning
    ? 'first cycle running…'
    : 'waiting to start first cycle'

  const backoffPill = data.backoffMs > 0
    ? \`<span class="pill warn">backoff \${data.backoffMs}ms</span>\`
    : ''

  const datesLabel = data.targetDates.length === 1
    ? data.targetDates[0]
    : \`\${data.targetDates.length} dates (\${fmtDateShort(data.targetDates[0])} → \${fmtDateShort(data.targetDates[data.targetDates.length - 1])})\`

  const monthsLabel = data.monthStarts.length === 1
    ? data.monthStarts[0].slice(0, 7)
    : \`\${data.monthStarts.length} months (\${data.monthStarts[0].slice(0, 7)} → \${data.monthStarts[data.monthStarts.length - 1].slice(0, 7)})\`

  document.getElementById('meta').innerHTML =
    \`<span>MONTHS: \${escape(monthsLabel)}</span>\` +
    \`<span>TARGET_DATES: \${escape(datesLabel)}</span>\` +
    \`<span>\${escape(cycleInfo)}</span>\` +
    \` \${backoffPill}\`

  document.querySelectorAll('th.sortable').forEach(th => {
    const key = th.dataset.sort
    const arrow = key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
    th.innerHTML = th.textContent.replace(/[ ▲▼]+$/, '') +
                   \`<span class="arrow">\${arrow}</span>\`
  })

  const sorted = sortRows(data.campgrounds)
  document.getElementById('rows').innerHTML = sorted.map(cg => {
    const park = cg.park ? \`[\${escape(cg.park)}] \` : ''
    const bookingUrl = \`https://www.recreation.gov/camping/campgrounds/\${cg.id}\`
    const m = cg.meta || {}
    const accessPill = m.accessType
      ? \` <span class="pill">\${escape(m.accessType)}</span>\`
      : ''
    const rowClass = cg.enabled === false ? 'disabled' : ''
    const checked = cg.enabled !== false ? 'checked' : ''
    return \`<tr class="\${rowClass}">
      <td><input type="checkbox" class="toggle" data-id="\${cg.id}" \${checked} title="Enable / disable polling for this campground"></td>
      <td>\${park}<a href="\${bookingUrl}" target="_blank">\${escape(cg.name)}</a>\${accessPill}
          <div class="meta-sub">id:\${cg.id}</div></td>
      <td class="num">\${fmtDrive(m.valleyDriveMinutes)}</td>
      <td class="num">\${fmtElev(m.elevationFt)}</td>
      <td>\${escape(m.season || '—')}</td>
      <td class="num">\${m.totalSites ?? '—'}</td>
      <td>\${fmtAgo(cg.lastPolledAt)}</td>
      <td>\${renderStatus(cg)}</td>
      <td class="sites">\${renderSites(cg)}</td>
    </tr>\`
  }).join('')
}

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey = key
      sortDir = 'asc'
    }
    render()
  })
})

// Delegated toggle handler (rows re-render every refresh).
document.getElementById('rows').addEventListener('change', async (e) => {
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
    // Optimistically reflect in cached state, then refresh
    if (lastData) {
      const cg = lastData.campgrounds.find(c => c.id === id)
      if (cg) cg.enabled = enabled
    }
    render()
    setTimeout(refresh, 500)
  } catch (err) {
    setFlash('toggle failed: ' + err.message, 'err')
    e.target.checked = !enabled // revert visually
  } finally {
    setTimeout(() => { e.target.disabled = false }, 300)
  }
})

const refresh = async () => {
  try {
    const res = await fetch('/api/status')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    lastData = await res.json()
    render()
  } catch (e) {
    document.getElementById('meta').innerHTML =
      \`<span class="err">failed to load /api/status: \${escape(e.message)}</span>\`
  }
}

// Map of campground id → name, populated from /api/status data.
const cgName = (id) => {
  const cg = lastData?.campgrounds?.find(c => c.id === id)
  return cg ? \`\${cg.park ? '[' + cg.park + '] ' : ''}\${cg.name}\` : 'id:' + id
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
    const detail = [ev.loop, ev.campsiteType, ev.maxPeople ? \`max \${ev.maxPeople}\` : null]
      .filter(Boolean).join(' · ')
    return \`<div class="event-row">
      <span class="ev-time">\${fmtAgo(ev.seenAt)}</span>
      <span>\${escape(cgName(ev.campgroundId))} <a href="\${siteUrl}" target="_blank">Site \${escape(ev.siteNo || ev.campsiteId)}</a>
            \${detail ? '<span class="site-detail">' + escape(detail) + '</span>' : ''}</span>
      <span class="\${cls}">\${ev.event}</span>
      <span>\${escape(datePart)}</span>
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
      \`<span class="err">failed to load /api/history: \${escape(e.message)}</span>\`
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
      // Force an immediate refresh after a short delay so user sees movement
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
</script>
</body>
</html>`
