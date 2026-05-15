export const ABOUT_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>关于 · Pitchwatch</title>
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
    --accent: #2d5a3d;
    --accent-strong: #1d4029;
    --accent-soft: #e7efe9;
    --accent-fg: #ffffff;
    --green: #2d5a3d;
    --green-bg: #e2eee5;
    --red: #b3261e;
    --pill-bg: #00000010;
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
      --accent: #6ad29b;
      --accent-strong: #4cbf83;
      --accent-soft: #1d2a23;
      --accent-fg: #0f1115;
      --green: #6ad29b;
      --green-bg: #1d2a23;
      --red: #f87171;
      --pill-bg: #ffffff14;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 15px/1.65 var(--font-sans);
    color: var(--fg);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 20px 48px; }

  header.top { margin-bottom: 24px; }
  .brand {
    display: flex; align-items: center; flex-wrap: wrap;
    gap: 12px; margin-bottom: 10px;
  }
  .brand h1 {
    font-size: 22px; font-weight: 700; margin: 0;
    color: var(--fg); letter-spacing: -0.02em;
    display: flex; align-items: center; gap: 8px;
  }
  .brand-mark {
    width: 12px; height: 12px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .brand a { color: inherit; text-decoration: none; }
  .header-actions {
    margin-left: auto;
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  }
  .back-link {
    font-size: 13px; font-weight: 500;
    color: var(--muted); text-decoration: none;
    padding: 6px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--card-bg);
  }
  .back-link:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .lang-switch {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    overflow: hidden;
    background: var(--card-bg);
  }
  .lang-switch button {
    font: inherit; font-size: 12px; padding: 6px 12px;
    border: none; background: transparent; color: var(--muted);
    font-weight: 500; cursor: pointer;
  }
  .lang-switch button.active { background: var(--accent); color: var(--accent-fg); }
  .lang-switch button:hover:not(.active) { background: var(--accent-soft); color: var(--accent); }

  h2 {
    font-size: 17px; font-weight: 600;
    margin: 32px 0 10px; letter-spacing: -0.01em;
  }
  h2:first-of-type { margin-top: 24px; }
  p { margin: 0 0 12px; color: var(--fg); }
  p.lede { color: var(--muted); font-size: 15px; line-height: 1.6; }
  ol, ul { padding-left: 20px; margin: 0 0 12px; }
  li { margin-bottom: 6px; }
  li code { font-family: var(--font-mono); font-size: 12.5px; background: var(--pill-bg); padding: 1px 6px; border-radius: 4px; }

  .callout {
    background: var(--card-bg);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    box-shadow: var(--card-shadow);
    padding: 14px 16px;
    margin: 16px 0;
  }
  .callout.warn { border-left-color: var(--red); }
  .callout h3 {
    font-size: 14px; font-weight: 600;
    margin: 0 0 6px;
    display: flex; align-items: center; gap: 8px;
  }
  .callout.warn h3 { color: var(--red); }
  .callout p:last-child { margin-bottom: 0; }
  .pill-available {
    display: inline-block;
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--green); background: var(--green-bg);
    padding: 2px 8px; border-radius: 999px;
  }

  .discord-cta {
    display: inline-flex; align-items: center;
    font: inherit; font-weight: 600; font-size: 14px;
    padding: 9px 16px; margin-top: 4px;
    border-radius: var(--radius-sm);
    background: #5865F2; color: #fff;
    text-decoration: none;
    transition: background-color 0.12s;
  }
  .discord-cta:hover { background: #4752c4; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
    font-size: 11px; color: var(--subtle); line-height: 1.6; }
  .footer a { color: var(--muted); }
  .footer a:hover { color: var(--accent); }

  @media (max-width: 480px) {
    .wrap { padding: 16px 14px 32px; }
    .brand h1 { font-size: 19px; }
    body { font-size: 14.5px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <h1><span class="brand-mark"></span><a href="/" id="brand-name">Pitchwatch</a></h1>
      <div class="header-actions">
        <a href="/" class="back-link" id="back-link"></a>
        <div class="lang-switch">
          <button data-lang="zh">中文</button>
          <button data-lang="en">EN</button>
        </div>
      </div>
    </div>
  </header>

  <main id="content"></main>

  <div class="footer">
    <a href="/">/</a> · <a href="/api/status">/api/status</a> · <a href="/api/history">/api/history</a>
  </div>
</div>

<script>
const I18N = {
  zh: {
    title: "关于 · Pitchwatch",
    back: "← 返回",
    h_intro: "这是什么？",
    intro:
      "Pitchwatch 持续监测 recreation.gov 上你选定的优胜美地、红杉等热门营地。一旦有人取消订单、新放出空位，工具会在几十秒内推送 Discord 通知。名字取自明代徐霞客 —— 三十年踏遍中国山川的「中国第一驴友」。",
    h_how: "工作原理",
    how: [
      "每 ~90 秒轮询一次 recreation.gov 的官方 API（与官网调用同一个接口）。",
      "对每个启用的营地，抓取你设定的目标日期范围（默认 5 个月内的周四到周六）的全部营位状态。",
      "结果写入本地 SQLite。每轮把新结果与上一轮对比，找出从「已订」变为「空位」的营位。",
      "出现新空位时，立即通过 Discord webhook 推送通知，附带营地名、营位号、可订日期和直达预订链接。",
      "遇到 429 / 5xx 错误会自动指数退避（最长 10 分钟），避免被封 IP。"
    ],
    h_available: "页面显示「有空位」时该怎么办？",
    callout_title: "速度最重要。",
    callout_body:
      "新放出的营位通常会在 30–60 秒内被抢走（包括一些自动化脚本）。看到推送或页面变绿时，直接点链接预订，别犹豫。",
    available_steps_title: "推荐操作流程：",
    available_steps: [
      "点击卡片里的「查看全部 X 个营位」展开，找到具体的营位号和可订日期。",
      "点击营位链接（直达 recreation.gov 该营位详情页）。",
      "确保已在 recreation.gov 登录 —— 选择日期 → Add to Cart → Checkout。",
      "整个流程要在 1 分钟内完成。任何犹豫都意味着另一个人正在点 Checkout。"
    ],
    prep_title: "强烈建议提前准备：",
    prep: [
      "注册并登录 recreation.gov 账号（首次注册要 5 分钟）。",
      "保存付款方式（信用卡）到账号资料里。",
      "填好同行人 / 紧急联系人信息（结账时 recreation.gov 会要求）。",
      "把常用营地加到收藏夹（Favorites），方便结账时识别。",
      "做完这些之后，从看到推送到完成预订只需要 30 秒左右。"
    ],
    h_notes: "几点说明",
    notes: [
      "从有人取消到你收到通知，会有几秒到 1 分钟的延迟 —— 这是 recreation.gov 服务器自身的缓存窗口。",
      "「已订满」只代表你监测的目标日期范围内全部已订，并不意味着其他日期也满。",
      "同一个 (营位, 日期) 一小时内只推一次，避免连续刷屏。",
      "工具本身不会替你下单 —— 这是一个监测器，下单永远是你自己点。"
    ],
    h_self: "想自己跑一份？",
    self:
      "完整源码在 GitHub 上 —— Node.js + SQLite + Express，单容器，一行 docker compose 就能起。营地列表、目标日期、Discord webhook 全在 .env 和 campgrounds.json 里配。",
    h_request: "想加哪个营地？",
    request:
      "在 Discord 上 @ 我（Yuwei），把你想监测的营地在 recreation.gov 上的名字或链接发给我，我加进去就好。也欢迎反馈和功能建议。",
    join_discord: "加入 Discord"
  },
  en: {
    title: "About · Pitchwatch",
    back: "← Back",
    h_intro: "What is this?",
    intro:
      "Pitchwatch continuously watches recreation.gov for your selected Yosemite, Sequoia, and other in-demand campgrounds. When someone cancels and a site opens back up, you get a Discord ping within seconds. Named after Xu Xiake, a Ming-dynasty traveler who spent 30 years exploring China's mountains on foot — China's original road-tripper.",
    h_how: "How it works",
    how: [
      "Polls recreation.gov's API roughly every 90 seconds (same endpoint the official site uses).",
      "For each enabled campground, fetches every campsite over your configured target dates (default: Thu–Sat across the next 5 months).",
      "Persists results to local SQLite. Each cycle diffs against the previous one to find sites that flipped from booked to available.",
      "On a new opening, fires a Discord webhook with campground name, site number, available dates, and a deep link straight to the reservation page.",
      "On 429 / 5xx errors, exponential backoff up to 10 minutes — keeps us from getting IP-banned."
    ],
    h_available: "What to do when the page shows \\"Available\\"",
    callout_title: "Speed is the entire game.",
    callout_body:
      "Newly opened sites are usually re-booked within 30–60 seconds — sometimes by other automated tools. When you see the ping or the card turns green, click and book. Don't second-guess.",
    available_steps_title: "Recommended flow:",
    available_steps: [
      "Open the card's \\"View all X sites\\" section to see the specific site number and available dates.",
      "Click the site link (it deep-links to that campsite's detail page on recreation.gov).",
      "Make sure you're already signed in to recreation.gov, then: pick dates → Add to Cart → Checkout.",
      "The whole thing has to land in under a minute. Any hesitation means someone else is hitting Checkout."
    ],
    prep_title: "Prep in advance — strongly recommended:",
    prep: [
      "Create and sign in to a recreation.gov account (5 minutes the first time).",
      "Save a payment method (credit card) to your profile.",
      "Fill out occupant / emergency-contact info — recreation.gov asks for it at checkout.",
      "Favorite the campgrounds you care about so you recognize them in the cart.",
      "With this done, ping-to-confirmation takes about 30 seconds."
    ],
    h_notes: "A few caveats",
    notes: [
      "There's a few-seconds-to-1-minute lag from cancellation to ping — that's recreation.gov's own cache window, not us.",
      "\\"All reserved\\" just means every date in your target range is booked. Other dates outside the range may still be open.",
      "Each (site, date) only pings once per hour to avoid flooding the channel.",
      "Pitchwatch does not auto-book for you. It's a watcher — clicking Reserve is always your job."
    ],
    h_self: "Want to run your own?",
    self:
      "Full source on GitHub — Node.js + SQLite + Express, single container, one-line docker compose. Campground list, target dates, and Discord webhook all live in .env and campgrounds.json.",
    h_request: "Want a campground added?",
    request:
      "Ping me (Yuwei) on Discord with the campground name or its recreation.gov link, and I'll add it. Feedback and feature suggestions welcome too.",
    join_discord: "Join Discord"
  }
}

let lang = (localStorage.getItem('lang') === 'en') ? 'en' : 'zh'
const T = () => I18N[lang]

const escape = (s) => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]))

const li = (s) => \`<li>\${escape(s)}</li>\`

const render = () => {
  document.documentElement.lang = lang
  document.title = T().title
  document.getElementById('back-link').textContent = T().back
  for (const b of document.querySelectorAll('.lang-switch button')) {
    b.classList.toggle('active', b.dataset.lang === lang)
  }

  const t = T()
  document.getElementById('content').innerHTML = \`
    <h2>\${escape(t.h_intro)}</h2>
    <p class="lede">\${escape(t.intro)}</p>

    <h2>\${escape(t.h_how)}</h2>
    <ol>\${t.how.map(li).join('')}</ol>

    <h2>\${escape(t.h_available)}</h2>
    <div class="callout warn">
      <h3><span class="pill-available">Available</span> \${escape(t.callout_title)}</h3>
      <p>\${escape(t.callout_body)}</p>
    </div>
    <p><strong>\${escape(t.available_steps_title)}</strong></p>
    <ol>\${t.available_steps.map(li).join('')}</ol>
    <div class="callout">
      <h3>\${escape(t.prep_title)}</h3>
      <ul>\${t.prep.map(li).join('')}</ul>
    </div>

    <h2>\${escape(t.h_notes)}</h2>
    <ul>\${t.notes.map(li).join('')}</ul>

    <h2>\${escape(t.h_self)}</h2>
    <p>\${escape(t.self)}</p>

    <h2>\${escape(t.h_request)}</h2>
    <div class="callout">
      <p>\${escape(t.request)}</p>
      <a class="discord-cta" id="discord-cta" href="#" target="_blank" rel="noopener" hidden>\${escape(t.join_discord)}</a>
    </div>
  \`
  applyDiscordLink()
}

let discordInviteUrl = null
const applyDiscordLink = () => {
  const a = document.getElementById('discord-cta')
  if (!a) return
  if (discordInviteUrl) {
    a.href = discordInviteUrl
    a.hidden = false
  } else {
    a.hidden = true
  }
}
fetch('/api/status').then(r => r.json()).then(d => {
  discordInviteUrl = d.discordInviteUrl || null
  applyDiscordLink()
}).catch(() => {})

document.querySelectorAll('.lang-switch button').forEach(b => {
  b.addEventListener('click', () => {
    lang = b.dataset.lang
    localStorage.setItem('lang', lang)
    render()
  })
})

render()
</script>
</body>
</html>`
