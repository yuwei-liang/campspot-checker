export const STATUS_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>Pitchwatch</title>
<style>
  :root {
    --bg: #f7f6f2;
    --fg: #15181d;
    --muted: #6b7280;
    --subtle: #9ca3af;
    --line: #e6e3dc;
    --line-strong: #d1ccc1;
    --card-bg: #ffffff;
    --card-shadow: 0 1px 2px rgba(20,30,40,0.04), 0 2px 6px rgba(20,30,40,0.04);
    --card-shadow-hover: 0 2px 4px rgba(20,30,40,0.06), 0 8px 16px rgba(20,30,40,0.06);
    --accent: #2d5a3d;
    --accent-strong: #1d4029;
    --accent-soft: #e7efe9;
    --accent-fg: #ffffff;
    --green: #2d5a3d;
    --green-bg: #e2eee5;
    --red: #b3261e;
    --red-bg: #fbe9e7;
    --cold: #2b6cb0;
    --pill-bg: #00000010;
    --pill-warn-bg: #b3261e;
    --radius: 12px;
    --radius-sm: 8px;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115;
      --fg: #e5e7eb;
      --muted: #9ca3af;
      --subtle: #6b7280;
      --line: #262932;
      --line-strong: #363a47;
      --card-bg: #181a20;
      --card-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.3);
      --card-shadow-hover: 0 2px 4px rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.4);
      --accent: #6ad29b;
      --accent-strong: #4cbf83;
      --accent-soft: #1d2a23;
      --accent-fg: #0f1115;
      --green: #6ad29b;
      --green-bg: #1d2a23;
      --red: #f87171;
      --red-bg: #2a1414;
      --cold: #60a5fa;
      --pill-bg: #ffffff14;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.5 var(--font-sans);
    color: var(--fg);
    background: var(--bg);
    -webkit-tap-highlight-color: transparent;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1240px; margin: 0 auto; padding: 24px 20px 48px; }

  header.top { margin-bottom: 24px; }
  .brand {
    display: flex; align-items: center; flex-wrap: wrap;
    gap: 12px; margin-bottom: 10px;
  }
  .brand h1 {
    font-size: 24px; font-weight: 700; margin: 0;
    color: var(--fg); letter-spacing: -0.02em;
    display: flex; align-items: center; gap: 8px;
  }
  .brand-mark {
    width: 12px; height: 12px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .header-actions {
    margin-left: auto;
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  }
  .page-desc {
    font-size: 14px;
    color: var(--muted);
    margin: 0 0 16px;
    max-width: 760px;
    line-height: 1.6;
  }
  .meta {
    display: flex; flex-wrap: wrap; gap: 6px 14px;
    font-size: 12px; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .meta span { white-space: nowrap; }
  .meta .pill { background: var(--pill-bg); padding: 2px 8px; border-radius: 999px; }
  .meta .pill.warn { background: var(--pill-warn-bg); color: #fff; }

  button {
    font: inherit;
    padding: 8px 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--card-bg);
    color: inherit;
    cursor: pointer;
    min-height: 36px;
    transition: background-color 0.12s, border-color 0.12s, transform 0.06s;
  }
  button:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
  }
  .discord-btn {
    display: inline-flex; align-items: center;
    font: inherit; font-weight: 600;
    padding: 8px 14px;
    min-height: 36px;
    border-radius: var(--radius-sm);
    border: 1px solid #5865F2;
    background: #5865F2;
    color: #fff !important;
    text-decoration: none;
    transition: background-color 0.12s, transform 0.06s;
  }
  .discord-btn:hover { background: #4752c4; border-color: #4752c4; }
  .discord-btn:active { transform: translateY(1px); }

  .filter-bar { margin: 12px 0 0; min-height: 26px; }
  .link-btn {
    font: inherit; font-size: 12px;
    padding: 3px 10px; min-height: 0;
    background: transparent; border: 1px dashed var(--line-strong);
    color: var(--muted); border-radius: 999px;
    cursor: pointer;
  }
  .link-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .flash { font-size: 12px; }
  .flash.ok { color: var(--green); }
  .flash.err { color: var(--red); }

  .lang-switch {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    overflow: hidden;
    background: var(--card-bg);
  }
  .lang-switch button {
    font-size: 12px; padding: 6px 12px; min-height: 0;
    border: none; border-radius: 0;
    background: transparent; color: var(--muted);
    font-weight: 500;
  }
  .lang-switch button.active {
    background: var(--accent); color: var(--accent-fg);
  }
  .lang-switch button:hover:not(.active) {
    background: var(--accent-soft); color: var(--accent);
  }

  .cards {
    display: grid;
    gap: 16px;
    grid-template-columns: 1fr;
    margin-top: 8px;
  }
  @media (min-width: 720px) { .cards { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1080px) { .cards { grid-template-columns: repeat(3, 1fr); } }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--card-shadow);
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 10px;
    transition: box-shadow 0.18s, border-color 0.18s;
  }
  .card:hover { box-shadow: var(--card-shadow-hover); border-color: var(--line-strong); }
  .card.disabled { opacity: 0.55; }

  .card-header { display: flex; gap: 10px; align-items: flex-start; }
  .toggle {
    cursor: pointer;
    width: 18px; height: 18px; flex: 0 0 auto;
    margin-top: 4px;
    accent-color: var(--accent);
  }
  .card-title { flex: 1 1 auto; min-width: 0; }
  .park-badge {
    display: inline-block;
    font-size: 10px; font-weight: 600;
    padding: 2px 7px; border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent);
    margin-right: 6px;
    vertical-align: 2px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .card-title a {
    color: var(--fg); text-decoration: none;
    font-weight: 600; font-size: 15px;
    letter-spacing: -0.01em;
  }
  .card-title a:hover { color: var(--accent); }
  .card-meta {
    font-size: 11px; color: var(--muted); margin-top: 4px;
    display: flex; flex-wrap: wrap; gap: 4px;
    font-variant-numeric: tabular-nums;
  }
  .card-meta .sep { opacity: 0.35; }

  .status-line {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .status {
    font-weight: 600; font-size: 12px;
    letter-spacing: 0.02em; text-transform: uppercase;
  }
  .status.available { color: var(--green); }
  .status.all_reserved { color: var(--muted); text-transform: none; letter-spacing: 0; }
  .status.error { color: var(--red); }
  .status.pending { color: var(--muted); text-transform: none; letter-spacing: 0; }
  .count-pill {
    font-size: 11px; font-weight: 600;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--green-bg);
    color: var(--green);
    font-variant-numeric: tabular-nums;
  }
  .last-poll {
    font-size: 11px; color: var(--subtle);
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .date-list { list-style: none; padding: 0; margin: 4px 0 0; }
  .date-row {
    display: grid;
    grid-template-columns: max-content 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 7px 0;
    border-top: 1px solid var(--line);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .date-row:first-child { border-top: none; padding-top: 4px; }
  .date-label {
    color: var(--muted); white-space: nowrap;
    font-family: var(--font-mono); font-size: 11px;
  }
  .weather { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
  .weather .temps { font-family: var(--font-mono); font-size: 11px; }
  .weather .temps.cold { color: var(--cold); font-weight: 600; }
  .weather .snow { color: var(--cold); }
  .date-count {
    font-weight: 600;
    color: var(--green);
    background: var(--green-bg);
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11px;
    min-width: 28px; text-align: center;
  }
  .date-count.zero { color: var(--muted); background: var(--pill-bg); font-weight: 400; }
  .more-dates { padding: 6px 0; font-size: 11px; color: var(--subtle); }
  .err-msg { font-size: 12px; color: var(--red); }

  .sites-link {
    margin-top: 6px; padding-top: 8px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }
  .sites-link details summary {
    cursor: pointer;
    color: var(--accent);
    list-style: none;
    padding: 4px 0;
    font-weight: 500;
    user-select: none;
  }
  .sites-link details summary::-webkit-details-marker { display: none; }
  .sites-link details[open] summary::before { content: "▾ "; }
  .sites-link details summary::before { content: "▸ "; opacity: 0.6; }
  .sites-link .site-item {
    padding: 5px 0;
    border-top: 1px solid var(--line);
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
  }
  .sites-link .site-item a { color: var(--accent); font-weight: 500; }
  .sites-link .site-detail { font-size: 10px; color: var(--subtle); }
  .sites-link .site-dates { font-size: 10px; color: var(--muted); font-family: var(--font-mono); }

  .panel { margin-top: 32px; }
  .panel h2 {
    font-size: 14px; margin: 0 0 12px; font-weight: 600;
    letter-spacing: -0.01em;
  }
  .event-row {
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 12px;
    align-items: baseline;
    font-size: 12px;
  }
  .event-row:last-child { border-bottom: none; }
  .ev-time { color: var(--subtle); font-size: 11px; font-family: var(--font-mono); }
  .ev-open {
    color: var(--green); font-weight: 600; font-size: 10px;
    padding: 2px 8px; background: var(--green-bg); border-radius: 999px;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .ev-closed {
    color: var(--muted); font-size: 10px;
    padding: 2px 8px; background: var(--pill-bg); border-radius: 999px;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .empty-panel { font-size: 12px; color: var(--muted); padding: 8px 0; }

  .footer { margin-top: 32px; font-size: 11px; color: var(--subtle); line-height: 1.6; }
  .footer a { color: var(--muted); }
  .footer a:hover { color: var(--accent); }
  a { color: var(--accent); }

  @media (max-width: 480px) {
    .wrap { padding: 16px 14px 32px; }
    .brand h1 { font-size: 20px; }
    .brand { gap: 10px; }
    .card { padding: 12px 14px; border-radius: var(--radius-sm); }
    .card-title a { font-size: 14px; }
    .event-row { grid-template-columns: 70px 1fr auto; gap: 8px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <h1><span class="brand-mark"></span><span id="brand-name">Pitchwatch</span></h1>
      <div class="header-actions">
        <button id="poll-btn" class="primary"></button>
        <a id="discord-link" class="discord-btn" target="_blank" rel="noopener" hidden></a>
        <span class="flash" id="poll-flash"></span>
        <div class="lang-switch">
          <button data-lang="zh">中文</button>
          <button data-lang="en">EN</button>
        </div>
      </div>
    </div>
    <p class="page-desc" id="page-desc"></p>
    <div class="meta" id="meta"></div>
  </header>

  <div class="filter-bar">
    <button id="toggle-disabled" class="link-btn" type="button" hidden></button>
  </div>

  <main class="cards" id="cards"></main>

  <section class="panel">
    <h2 id="recent-events-heading"></h2>
    <div id="events" class="empty-panel"></div>
  </section>

  <div class="footer">
    <span id="footer-text"></span>
    <a href="/about" id="about-link"></a> · <a href="/api/status">/api/status</a> · <a href="/api/history">/api/history</a>
  </div>
</div>

<script>
const I18N = {
  en: {
    brand_name: "Pitchwatch",
    title_desc: "Pitchwatch polls recreation.gov every couple minutes for selected Yosemite & Sequoia campgrounds, watches your target dates for newly opened sites, and pings Discord the moment something opens up.",
    poll_now: "Poll now",
    recent_events: "Recent events",
    footer: "Auto-refreshes every 5 seconds · Weather: prior-year actuals via open-meteo.com · ",
    no_events: "No events yet — the first cycle establishes the baseline.",
    fail_load: (path, msg) => \`failed to load \${path}: \${msg}\`,
    status_available: "Available",
    status_all_reserved: "All reserved",
    status_pending: "Pending first poll",
    status_error: "Error",
    sites_count: (s, d) => \`\${s} site\${s===1?'':'s'} · \${d} date\${d===1?'':'s'}\`,
    view_all_sites: (n) => \`View all \${n} site\${n===1?'':'s'}\`,
    more_dates: (n) => \`+\${n} more date\${n===1?'':'s'}\`,
    more_sites: (n) => \`+\${n} more site\${n===1?'':'s'}\`,
    total_sites: (n) => \`\${n} site\${n===1?'':'s'}\`,
    in_valley: "in valley",
    min_unit: "min",
    hour_unit: "h",
    ft_unit: "ft",
    last_cycle: (ago, n) => \`last cycle \${ago} · \${n} total\`,
    first_cycle_running: "first cycle running…",
    waiting_first_cycle: "waiting to start first cycle",
    months_label: (n, start, end) => \`\${n} months (\${start} → \${end})\`,
    dates_count: (n) => \`\${n} dates\`,
    backoff: (ms) => \`backoff \${ms}ms\`,
    triggering: "triggering…",
    poll_started: "poll started — watch the timestamps refresh",
    already_running: (reason) => \`already running\${reason ? ' (' + reason + ')' : ''}\`,
    request_failed: (m) => \`request failed: \${m}\`,
    toggle_failed: (m) => \`toggle failed: \${m}\`,
    toggle_title: "Enable / disable polling",
    join_discord: "Join Discord",
    show_disabled: (n) => \`+\${n} disabled (show)\`,
    hide_disabled: (n) => \`\${n} disabled shown (hide)\`,
    max_people: (n) => \`max \${n}\`,
    event_opened: "opened",
    event_closed: "closed",
    weekdays: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    ago_sec: (s) => \`\${s}s ago\`,
    ago_min: (m) => \`\${m}m ago\`,
    ago_hour: (h) => \`\${h}h ago\`,
    site_prefix: "Site",
    about_link: "How it works",
  },
  zh: {
    brand_name: "霞客",
    title_desc: "霞客每隔几分钟轮询 recreation.gov，监测您选定的优胜美地与红杉营地在目标日期是否有新空位放出，发现时立刻通过 Discord 推送通知。名字取自明代徐霞客，三十年踏遍中国山川的「中国第一驴友」。",
    poll_now: "立即检查",
    recent_events: "最近动态",
    footer: "每 5 秒自动刷新 · 天气数据来自 open-meteo.com 去年同日实测值 · ",
    no_events: "暂无事件 — 首轮检查会建立基线。",
    fail_load: (path, msg) => \`加载 \${path} 失败: \${msg}\`,
    status_available: "有空位",
    status_all_reserved: "已订满",
    status_pending: "等待首次检查",
    status_error: "错误",
    sites_count: (s, d) => \`\${s} 个营位 · \${d} 天\`,
    view_all_sites: (n) => \`查看全部 \${n} 个营位\`,
    more_dates: (n) => \`+\${n} 个日期\`,
    more_sites: (n) => \`+\${n} 个营位\`,
    total_sites: (n) => \`\${n} 个营位\`,
    in_valley: "山谷内",
    min_unit: "分钟",
    hour_unit: "小时",
    ft_unit: "英尺",
    last_cycle: (ago, n) => \`上轮 \${ago}完成 · 共 \${n} 次\`,
    first_cycle_running: "首轮进行中…",
    waiting_first_cycle: "等待开始首轮",
    months_label: (n, start, end) => \`\${n} 个月（\${start} → \${end}）\`,
    dates_count: (n) => \`\${n} 个日期\`,
    backoff: (ms) => \`退避 \${ms}ms\`,
    triggering: "触发中…",
    poll_started: "已触发轮询 — 留意时间戳更新",
    already_running: (reason) => \`正在进行\${reason ? '（' + reason + '）' : ''}\`,
    request_failed: (m) => \`请求失败: \${m}\`,
    toggle_failed: (m) => \`切换失败: \${m}\`,
    toggle_title: "启用 / 停用轮询",
    join_discord: "加入 Discord",
    show_disabled: (n) => \`\${n} 个已停用（点击显示）\`,
    hide_disabled: (n) => \`已显示 \${n} 个已停用（点击隐藏）\`,
    max_people: (n) => \`最多 \${n} 人\`,
    event_opened: "开放",
    event_closed: "关闭",
    weekdays: ['周日','周一','周二','周三','周四','周五','周六'],
    ago_sec: (s) => \`\${s} 秒前\`,
    ago_min: (m) => \`\${m} 分钟前\`,
    ago_hour: (h) => \`\${h} 小时前\`,
    site_prefix: "营位",
    about_link: "工作原理",
  },
}

let lang = (localStorage.getItem('lang') === 'en') ? 'en' : 'zh'
const T = () => I18N[lang]

let lastData = null
let lastEvents = []
let showDisabled = localStorage.getItem('showDisabled') === 'true'

const escape = (s) => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]))

const fmtAgo = (iso) => {
  if (!iso) return '—'
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return T().ago_sec(sec)
  if (sec < 3600) return T().ago_min(Math.floor(sec / 60))
  return T().ago_hour(Math.floor(sec / 3600))
}

const fmtDateShort = (iso) => {
  const d = new Date(iso)
  return T().weekdays[d.getUTCDay()] + ' ' + iso.slice(5, 10)
}

const fmtDrive = (mins) => {
  if (mins == null) return null
  if (mins === 0) return T().in_valley
  if (mins < 60) return mins + ' ' + T().min_unit
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? h + T().hour_unit + ' ' + m + T().min_unit : h + T().hour_unit
}

const renderWeather = (w) => {
  if (!w) return '<span class="weather"><span class="temps">—</span></span>'
  const tmax = w.tmaxF != null ? Math.round(w.tmaxF) : null
  const tmin = w.tminF != null ? Math.round(w.tminF) : null
  const cold = tmin != null && tmin < 40
  const temps = (tmax != null && tmin != null) ? \`\${tmax}°/\${tmin}°\` : '—'
  const snow = (w.snowfallCm != null && w.snowfallCm > 0) ? \`<span class="snow" title="\${w.snowfallCm}cm snow">❄</span>\` : ''
  return \`<span class="weather"><span class="temps\${cold ? ' cold' : ''}">\${escape(temps)}</span>\${snow}</span>\`
}

const renderSiteItem = (s) => {
  const url = \`https://www.recreation.gov/camping/campsites/\${escape(s.campsiteId)}\`
  const detail = [s.loop, s.campsiteType, s.maxPeople ? T().max_people(s.maxPeople) : null].filter(Boolean).join(' · ')
  const dates = (s.availableDates || []).map(fmtDateShort).join(', ')
  return \`<div class="site-item">
    <a href="\${url}" target="_blank" rel="noopener">\${escape(T().site_prefix)} \${escape(s.siteNO)}</a>
    \${detail ? \`<span class="site-detail">\${escape(detail)}</span>\` : ''}
    <span class="site-dates">\${escape(dates)}</span>
  </div>\`
}

const renderCard = (cg) => {
  const bookingUrl = \`https://www.recreation.gov/camping/campgrounds/\${cg.id}\`
  const m = cg.meta || {}
  const metaBits = [
    fmtDrive(m.valleyDriveMinutes),
    m.elevationFt ? m.elevationFt.toLocaleString() + ' ' + T().ft_unit : null,
    m.season,
    m.totalSites ? T().total_sites(m.totalSites) : null,
    m.accessType,
  ].filter(Boolean)
  const metaLine = metaBits.map(escape).join(' <span class="sep">·</span> ')

  const checked = cg.enabled !== false ? 'checked' : ''
  const disabledCls = cg.enabled === false ? ' disabled' : ''

  let statusLabel = cg.status
  let countPill = ''
  if (cg.status === 'available') {
    statusLabel = T().status_available
    const datesWithSites = Object.values(cg.availableByDate || {}).filter(n => n > 0).length
    countPill = \`<span class="count-pill">\${T().sites_count(cg.availableSites.length, datesWithSites)}</span>\`
  } else if (cg.status === 'all_reserved') {
    statusLabel = T().status_all_reserved
  } else if (cg.status === 'pending') {
    statusLabel = T().status_pending
  } else if (cg.status === 'error') {
    statusLabel = T().status_error
  }

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
      \${hiddenCount > 0 ? \`<li class="more-dates">\${escape(T().more_dates(hiddenCount))}</li>\` : ''}
    </ul>
  \` : ''

  const sitesHtml = cg.availableSites && cg.availableSites.length > 0 ? \`
    <div class="sites-link">
      <details>
        <summary>\${escape(T().view_all_sites(cg.availableSites.length))}</summary>
        \${cg.availableSites.slice(0, 30).map(renderSiteItem).join('')}
        \${cg.availableSites.length > 30 ? \`<div class="more-dates">\${escape(T().more_sites(cg.availableSites.length - 30))}</div>\` : ''}
      </details>
    </div>
  \` : ''

  return \`<article class="card\${disabledCls}" data-id="\${cg.id}">
    <div class="card-header">
      <input type="checkbox" class="toggle" data-id="\${cg.id}" \${checked} title="\${escape(T().toggle_title)}">
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
    ? T().last_cycle(fmtAgo(data.cycle.lastFinishedAt), data.cycle.cycleCount)
    : data.cycle.currentlyRunning
    ? T().first_cycle_running
    : T().waiting_first_cycle

  const monthsLabel = data.monthStarts.length === 1
    ? data.monthStarts[0].slice(0, 7)
    : T().months_label(data.monthStarts.length, data.monthStarts[0].slice(0, 7), data.monthStarts[data.monthStarts.length - 1].slice(0, 7))

  const backoffPill = data.backoffMs > 0
    ? \`<span class="pill warn">\${escape(T().backoff(data.backoffMs))}</span>\`
    : ''

  document.getElementById('meta').innerHTML =
    \`<span>\${escape(monthsLabel)}</span>\` +
    \`<span>\${escape(T().dates_count(data.targetDates.length))}</span>\` +
    \`<span>\${escape(cycleInfo)}</span>\` +
    backoffPill

  const allCgs = data.campgrounds || []
  const disabledCount = allCgs.filter(c => c.enabled === false).length
  const visible = showDisabled ? allCgs : allCgs.filter(c => c.enabled !== false)
  document.getElementById('cards').innerHTML = visible.map(renderCard).join('')

  const toggleBtn = document.getElementById('toggle-disabled')
  if (disabledCount === 0) {
    toggleBtn.hidden = true
  } else {
    toggleBtn.hidden = false
    toggleBtn.textContent = showDisabled
      ? T().hide_disabled(disabledCount)
      : T().show_disabled(disabledCount)
  }
}

const refresh = async () => {
  try {
    const res = await fetch('/api/status')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    lastData = await res.json()
    render()
    applyDiscordLink()
  } catch (e) {
    document.getElementById('cards').innerHTML =
      \`<div class="err-msg">\${escape(T().fail_load('/api/status', e.message))}</div>\`
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
    el.textContent = T().no_events
    return
  }
  el.className = ''
  el.innerHTML = events.map(ev => {
    const datePart = ev.targetDate ? fmtDateShort(ev.targetDate) : '—'
    const isOpen = ev.event === 'opened'
    const cls = isOpen ? 'ev-open' : 'ev-closed'
    const label = isOpen ? T().event_opened : T().event_closed
    const siteUrl = \`https://www.recreation.gov/camping/campsites/\${escape(ev.campsiteId)}\`
    return \`<div class="event-row">
      <span class="ev-time">\${escape(fmtAgo(ev.seenAt))}</span>
      <span>\${escape(cgName(ev.campgroundId))} <a href="\${siteUrl}" target="_blank">\${escape(T().site_prefix)} \${escape(ev.siteNo || ev.campsiteId)}</a> · \${escape(datePart)}</span>
      <span class="\${cls}">\${escape(label)}</span>
    </div>\`
  }).join('')
}

const refreshEvents = async () => {
  try {
    const res = await fetch('/api/history?limit=50')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    lastEvents = data.events || []
    renderEvents(lastEvents)
  } catch (e) {
    document.getElementById('events').innerHTML =
      \`<span class="err-msg">\${escape(T().fail_load('/api/history', e.message))}</span>\`
  }
}

const pollBtn = document.getElementById('poll-btn')
const pollFlash = document.getElementById('poll-flash')
const setFlash = (msg, cls) => {
  pollFlash.textContent = msg
  pollFlash.className = 'flash ' + (cls || '')
  if (msg) setTimeout(() => { if (pollFlash.textContent === msg) setFlash('', '') }, 4000)
}

const applyLang = () => {
  document.documentElement.lang = lang
  document.title = T().brand_name
  document.getElementById('brand-name').textContent = T().brand_name
  document.getElementById('page-desc').textContent = T().title_desc
  document.getElementById('poll-btn').textContent = T().poll_now
  document.getElementById('recent-events-heading').textContent = T().recent_events
  document.getElementById('footer-text').textContent = T().footer
  document.getElementById('about-link').textContent = T().about_link
  document.getElementById('discord-link').textContent = T().join_discord
  for (const b of document.querySelectorAll('.lang-switch button')) {
    b.classList.toggle('active', b.dataset.lang === lang)
  }
  if (lastData) render()
  if (lastEvents.length || document.getElementById('events').textContent) renderEvents(lastEvents)
}

const applyDiscordLink = () => {
  const link = document.getElementById('discord-link')
  const url = lastData?.discordInviteUrl
  if (url) {
    link.href = url
    link.hidden = false
  } else {
    link.hidden = true
  }
}

document.querySelectorAll('.lang-switch button').forEach(b => {
  b.addEventListener('click', () => {
    lang = b.dataset.lang
    localStorage.setItem('lang', lang)
    applyLang()
  })
})

document.getElementById('toggle-disabled').addEventListener('click', () => {
  showDisabled = !showDisabled
  localStorage.setItem('showDisabled', String(showDisabled))
  render()
})

pollBtn.addEventListener('click', async () => {
  pollBtn.disabled = true
  setFlash(T().triggering, '')
  try {
    const res = await fetch('/api/poll', { method: 'POST' })
    if (res.ok) {
      setFlash(T().poll_started, 'ok')
      setTimeout(refresh, 1500)
    } else {
      const body = await res.json().catch(() => ({}))
      setFlash(T().already_running(body.reason), 'err')
    }
  } catch (e) {
    setFlash(T().request_failed(e.message), 'err')
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
    setFlash(T().toggle_failed(err.message), 'err')
    e.target.checked = !enabled
  } finally {
    setTimeout(() => { e.target.disabled = false }, 300)
  }
})

applyLang()
refresh()
refreshEvents()
setInterval(refresh, 5000)
setInterval(refreshEvents, 10000)
</script>
</body>
</html>`
