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
</style>
</head>
<body>
<h1>campspot-checker</h1>
<div class="meta" id="meta">loading…</div>
<table>
  <thead>
    <tr>
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
<div class="footer">Auto-refreshes every 5 seconds. Click a header to sort. <a href="/api/status">/api/status</a> for raw JSON.</div>

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

const renderSites = (sites) => {
  if (!sites.length) return '—'
  const shown = sites.slice(0, 5)
  const more = sites.length - shown.length
  let out = shown.map(s =>
    \`<a href="\${escape(s.url)}" target="_blank">Site \${escape(s.siteNO)}</a>\`
  ).join(', ')
  if (more > 0) out += \` <span class="pill">+\${more} more</span>\`
  return out
}

const renderStatus = (cg) => {
  const cls = cg.status
  let label = cg.status
  if (cg.status === 'available') label = \`AVAILABLE (\${cg.availableSitesCount})\`
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

  document.getElementById('meta').innerHTML =
    \`<span>TARGET_DATE: \${escape(data.targetDate)}</span>\` +
    \`<span>MONTH_START: \${escape(data.monthStart)}</span>\` +
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
    return \`<tr>
      <td>\${park}<a href="\${bookingUrl}" target="_blank">\${escape(cg.name)}</a>\${accessPill}
          <div class="meta-sub">id:\${cg.id}</div></td>
      <td class="num">\${fmtDrive(m.valleyDriveMinutes)}</td>
      <td class="num">\${fmtElev(m.elevationFt)}</td>
      <td>\${escape(m.season || '—')}</td>
      <td class="num">\${m.totalSites ?? '—'}</td>
      <td>\${fmtAgo(cg.lastPolledAt)}</td>
      <td>\${renderStatus(cg)}</td>
      <td class="sites">\${renderSites(cg.availableSites)}</td>
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

refresh()
setInterval(refresh, 5000)
</script>
</body>
</html>`
