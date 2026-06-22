// Dashboard HTML. Self-contained: CSS embedded, single fetch loop for
// /api/bots, no framework. Auto-refreshes every 5s; tab-visibility-aware so a
// backgrounded tab doesn't burn polls.
export const DASHBOARD_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bots Dashboard</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #161a23;
    --panel-2: #1c2230;
    --ink: #e7ecf3;
    --ink-dim: #98a2b3;
    --accent: #6ee7b7;
    --accent-2: #fbbf24;
    --accent-3: #818cf8;
    --warn: #f87171;
    --line: #2a3142;
    --code: #c6d3e6;
  }
  html, body { background: var(--bg); color: var(--ink); margin: 0; }
  body {
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px 20px 64px; max-width: 1300px; margin-inline: auto;
  }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .lede { color: var(--ink-dim); margin: 0 0 20px; font-size: 13px; }
  .topbar { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .clock { color: var(--ink-dim); font: 12px ui-monospace, Menlo, monospace; }
  .meter { display: flex; align-items: center; gap: 8px; color: var(--ink-dim); font-size: 12px; }
  .meter .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

  .grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
  @media (min-width: 1100px) { .grid { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1500px) { .grid { grid-template-columns: 1fr 1fr 1fr; } }

  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 16px 18px;
  }
  .card-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; margin-bottom: 10px;
  }
  .card-title { font-weight: 600; font-size: 15px; color: var(--ink); }
  .card-sub { color: var(--ink-dim); font-size: 12px; }

  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 9px; border-radius: 999px;
    background: var(--panel-2); border: 1px solid var(--line);
    font-size: 11.5px; color: var(--ink-dim); letter-spacing: 0.02em;
    text-transform: uppercase; font-weight: 600;
  }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .pill.live  { color: var(--accent);   border-color: rgba(110,231,183,0.45); background: rgba(110,231,183,0.10); }
  .pill.stale { color: var(--accent-2); border-color: rgba(251,191,36,0.45); background: rgba(251,191,36,0.08); }
  .pill.dead  { color: var(--warn);     border-color: rgba(248,113,113,0.45); background: rgba(248,113,113,0.10); }
  .pill.absent{ color: var(--ink-dim); }
  .pill.live .dot { animation: pulse 1.5s infinite; }

  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .m { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
  .m .v { font-size: 18px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
  .m .l { font-size: 10.5px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
  .m.warn .v { color: var(--warn); }
  .m.good .v { color: var(--accent); }

  .row { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .k { color: var(--ink-dim); font-size: 12px; min-width: 84px; }
  .v { color: var(--ink); font-size: 13px; }
  code, .mono { font: 12px ui-monospace, Menlo, monospace; color: var(--code); }

  .section-title { font-size: 11px; color: var(--ink-dim); letter-spacing: 0.06em; text-transform: uppercase; margin: 14px 0 6px; }

  .stays { display: flex; flex-direction: column; gap: 4px; }
  .stay {
    display: grid; grid-template-columns: 60px 1fr 60px;
    background: var(--panel-2); border: 1px solid var(--line);
    border-radius: 6px; padding: 6px 10px;
    font-size: 12.5px;
    align-items: center;
  }
  .stay .site { color: var(--accent-3); font-weight: 600; }
  .stay .dates { color: var(--ink); font-variant-numeric: tabular-nums; }
  .stay .nights { color: var(--accent-2); text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  .events { display: flex; flex-direction: column; gap: 3px; max-height: 240px; overflow: auto; }
  .ev {
    display: grid; grid-template-columns: 64px 96px 1fr;
    gap: 8px; font-size: 12px;
    padding: 4px 0; border-bottom: 1px dashed var(--line);
  }
  .ev:last-child { border-bottom: none; }
  .ev .t { color: var(--ink-dim); font: 11.5px ui-monospace, Menlo, monospace; }
  .ev .type { color: var(--accent-3); font-weight: 600; }
  .ev .type.new_stay  { color: var(--accent); }
  .ev .type.cart_attempt { color: var(--accent-2); }
  .ev .type.poll_error { color: var(--warn); }
  .ev .type.heartbeat { color: var(--ink-dim); }
  .ev .body { color: var(--ink); }

  .absent-card { color: var(--ink-dim); padding: 16px 0; font-size: 13px; }

  .links { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; font-size: 12.5px; }
  .links a { color: var(--accent-3); text-decoration: none; }
  .links a:hover { text-decoration: underline; }

  .footer { color: var(--ink-dim); margin-top: 24px; font-size: 12px; }
</style>
</head>
<body>

<div class="topbar">
  <div>
    <h1>Bots Dashboard</h1>
    <p class="lede">Live status across permit-bot and campspot-bot. Auto-refreshes every 5s.</p>
  </div>
  <div>
    <div class="meter"><span class="dot"></span><span id="meter-text">connecting&hellip;</span></div>
    <div class="clock" id="clock">--</div>
  </div>
</div>

<div class="grid" id="grid"><!-- cards injected here --></div>

<div class="footer">
  Endpoint: <a href="/api/bots" style="color:var(--accent-3)">/api/bots</a>
</div>

<script>
  const LIVENESS_LABEL = { live: 'LIVE', stale: 'STALE', dead: 'DEAD', absent: 'ABSENT', unknown: '—' };
  const grid = document.getElementById('grid');
  const meter = document.getElementById('meter-text');
  const clock = document.getElementById('clock');

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }
  function ago(iso) {
    if (!iso) return '—';
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }
  function uptime(iso) {
    if (!iso) return '—';
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    const h = Math.floor(s / 3600); const m = Math.round((s - h*3600) / 60);
    return h + 'h ' + m + 'm';
  }

  function metricsBlock(metrics, layout) {
    if (!metrics) return '';
    return '<div class="metrics">' + layout.map(([key, label, kind]) => {
      const v = metrics[key];
      const klass = kind === 'warn' && v > 0 ? 'm warn' : kind === 'good' && v > 0 ? 'm good' : 'm';
      return '<div class="' + klass + '"><div class="v">' + escape(v ?? '—') + '</div><div class="l">' + label + '</div></div>';
    }).join('') + '</div>';
  }

  function renderEvents(events) {
    if (!events || events.length === 0) return '<div class="card-sub">No recent events.</div>';
    return '<div class="events">' + events.slice(0, 30).map(e => {
      const body = e.type === 'new_stay'
        ? 'site ' + escape(e.siteNo) + ' · ' + escape(e.startDate) + ' → ' + escape(e.endDate) + ' (' + e.nights + 'n)' + (e.maxPeople ? ', max ' + e.maxPeople : '')
        : e.type === 'cart_attempt'
          ? 'site ' + escape(e.siteNo) + ' · ' + escape(e.startDate) + ' → ' + escape(e.endDate) + ' &rarr; ' + escape(e.result)
          : e.type === 'fire_results'
            ? 'fire ' + escape(e.fireId || '') + ' · ' + escape(e.date) + ' · held=' + e.heldCount + '/' + (e.results?.length ?? '?')
            : e.type === 'decision'
              ? 'plan ' + escape(e.plan?.kind || '?') + ' party=' + escape(e.plan?.partySize) + ' on ' + escape(e.date)
              : e.type === 'heartbeat'
                ? 'polls=' + escape(e.pollCount) + ' uptime=' + escape(e.uptimeMin) + 'min' + (e.flags?.length ? ' flags=[' + e.flags.join(',') + ']' : '')
              : e.type === 'startup'
                ? 'mode=' + escape(e.mode || '—')
              : e.type === 'poll_error'
                ? escape(e.error || '') + ' (backoff ' + escape(e.backoffMs ?? 0) + 'ms)'
              : e.type === 'decision_skipped'
                ? escape(e.date) + ' skipped: ' + escape(e.reason || '')
              : e.type === 'verify_config'
                ? (e.ok ? 'OK' : 'DRIFT: ' + escape((e.errors || []).join('; ')))
              : e.type === 'warm_row_check_failed'
                ? 'warm row check failed for ' + (e.missing || []).map(m => escape(m.name)).join(', ')
              : e.type === 'shutdown'
                ? 'polls=' + escape(e.pollCount ?? '—') + ' uptimeMs=' + escape(e.uptimeMs ?? '—')
                : escape(JSON.stringify(e).slice(0, 140));
      const t = (e.ts || '').slice(11, 19);
      return '<div class="ev"><div class="t">' + escape(t) + '</div><div class="type ' + escape(e.type) + '">' + escape(e.type) + '</div><div class="body">' + body + '</div></div>';
    }).join('') + '</div>';
  }

  function renderCampspotCard(b) {
    const liv = (b.liveness || 'unknown').toLowerCase();
    const head =
      '<div class="card-head">' +
        '<div><div class="card-title">' + escape(b.label || b.bot) + '</div>' +
        '<div class="card-sub">' + escape(b.mode || '—') + (b.pid ? ' · pid ' + b.pid : '') + '</div></div>' +
        '<span class="pill ' + liv + '"><span class="dot"></span>' + LIVENESS_LABEL[liv] + '</span>' +
      '</div>';
    const cfg = b.config || {};
    const rows =
      '<div class="row"><span class="k">Campground</span><span class="v">' + escape(cfg.campgroundName || '—') + '</span></div>' +
      '<div class="row"><span class="k">Window</span><span class="v mono">' + escape(cfg.window || '—') + '</span></div>' +
      '<div class="row"><span class="k">Weekdays</span><span class="v mono">' + escape((cfg.weekdays || []).join(',')) + '</span></div>' +
      '<div class="row"><span class="k">Nights</span><span class="v mono">' + escape(cfg.nights || '—') + '</span> <span class="k">· party ≥</span><span class="v mono">' + escape(cfg.minPeople ?? '—') + '</span></div>' +
      '<div class="row"><span class="k">Uptime</span><span class="v">' + uptime(b.startedAt) + ' · last poll ' + ago(b.lastHeartbeat) + '</span></div>';
    const m = metricsBlock(b.metrics, [
      ['cycles', 'Polls'],
      ['totalStaysSeen', 'Open stays'],
      ['cartAttempts', 'Cart fires', 'good'],
      ['cartHolds', 'Holds won', 'good'],
    ]);
    const m2 = metricsBlock(b.metrics, [
      ['newStaysDetected', 'New openings'],
      ['errors', 'Errors', 'warn'],
      ['backoffMs', 'Backoff ms', 'warn'],
    ]);
    const stays = (b.lastSnapshot?.stays || []).slice(0, 6);
    const staysBlock = stays.length
      ? '<div class="section-title">Top stays right now</div><div class="stays">' + stays.map(s =>
          '<div class="stay"><div class="site">site ' + escape(s.siteNo) + '</div><div class="dates mono">' + escape(s.startDate) + ' → ' + escape(s.endDate) + '</div><div class="nights">' + s.nights + 'n</div></div>'
        ).join('') + '</div>'
      : '<div class="section-title">Top stays right now</div><div class="card-sub">No qualifying stays — campground likely fully booked across window.</div>';
    const events = '<div class="section-title">Recent events</div>' + renderEvents(b.recentEvents);
    return head + rows + m + m2 + staysBlock + events;
  }

  function renderPermitBotCard(b) {
    if (b.liveness === 'absent') {
      return cardHeader(b) + '<div class="absent-card">Not running. Start with <code>node permit-bot/permit-bot.mjs watch-auto --pre-warm</code>. (' + escape(b.absentReason || '') + ')</div>';
    }
    const liv = (b.liveness || 'unknown').toLowerCase();
    const cfg = b.config || {};
    const head = cardHeader(b);
    const rows =
      '<div class="row"><span class="k">Targets</span><span class="v mono">' + escape((cfg.targetDates || []).join(', ')) + '</span></div>' +
      '<div class="row"><span class="k">Pre-warm</span><span class="v">' + escape(cfg.preWarm ? 'on' : 'off') + '</span></div>' +
      '<div class="row"><span class="k">Uptime</span><span class="v">' + uptime(b.startedAt) + ' · last event ' + ago(b.lastHeartbeat) + '</span></div>' +
      '<div class="row"><span class="k">Snapshot</span><span class="v mono">' + escape(b.lastSnapshotSummary || '—') + '</span></div>';
    const m = metricsBlock(b.metrics, [
      ['cycles', 'Polls'],
      ['decisions', 'Decisions'],
      ['fires', 'Fires', 'good'],
      ['heldShots', 'Holds won', 'good'],
    ]);
    const events = '<div class="section-title">Recent events</div>' + renderEvents(b.recentEvents);
    return head + rows + m + events;
  }

  function cardHeader(b) {
    const liv = (b.liveness || 'unknown').toLowerCase();
    return '<div class="card-head">' +
      '<div><div class="card-title">' + escape(b.label || b.bot) + '</div>' +
      '<div class="card-sub">' + escape(b.mode || '—') + (b.pid ? ' · pid ' + b.pid : '') + '</div></div>' +
      '<span class="pill ' + liv + '"><span class="dot"></span>' + LIVENESS_LABEL[liv] + '</span>' +
    '</div>';
  }

  function render(data) {
    clock.textContent = data.serverTime?.slice(11, 19) ?? '--';
    grid.innerHTML = data.bots.map(b => {
      const inner = b.bot === 'campspot-bot' ? renderCampspotCard(b)
        : b.bot === 'permit-bot' ? renderPermitBotCard(b)
        : '<div class="absent-card">Unknown bot: ' + escape(b.bot) + '</div>';
      return '<div class="card">' + inner + '</div>';
    }).join('');
  }

  async function tick() {
    if (document.hidden) return; // don't poll a backgrounded tab
    try {
      const r = await fetch('/api/bots', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      meter.textContent = 'live · ' + data.bots.length + ' bots';
      render(data);
    } catch (err) {
      meter.textContent = 'offline · retrying';
    }
  }
  tick();
  setInterval(tick, 5000);
</script>
</body>
</html>`
