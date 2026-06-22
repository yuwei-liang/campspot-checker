# campspot-bot

Sibling to `permit-bot/`. Watches a rec.gov **campground** (not permit) for
Thu–Sun stays in a configurable window and (optionally) drives Playwright to
add the slot to the user's cart so the hold sticks for 15 minutes.

Target campground is set in `campspot-bot/config.json`. Defaults to Upper
Pines (id `232447`), window `2026-06-22 → 2026-09-30`, weekdays Thu/Fri/Sat/Sun,
max 4-night stays.

Re-uses the rec.gov login from `permit-bot/.chromium-profile`, so run
`node permit-bot/permit-bot.mjs login --account=1` once before any
`--for-real` cart operation.

## Commands

```
node campspot-bot/campspot-bot.mjs check
  # one-shot scan of every campsite, prints qualifying Thu-Sun stays
  # (ranked: longest first, earliest first, lowest site #).

node campspot-bot/campspot-bot.mjs cart --site=068 --start=2026-09-10 --end=2026-09-14
  # dry-run cart flow: opens browser, advances the calendar, locates the
  # Available cell, screenshots. No clicks past the cell.

node campspot-bot/campspot-bot.mjs cart --site=068 --start=2026-09-10 --end=2026-09-14 --for-real
  # actually clicks "Add to Cart", verifies /cart hold, posts Discord with
  # the cart screenshot.

node campspot-bot/campspot-bot.mjs watch
  # poll every config.pollIntervalMs; Discord/ntfy on NEW openings only.

node campspot-bot/campspot-bot.mjs watch --auto-grab
  # same, but fires the cart bot on the top-ranked new stay (one at a time;
  # 1-hour cooldown per (site, dates) so we don't retry the same loss).

node campspot-bot/campspot-bot.mjs release-cart [--account=N]
  # test-only: clears every hold from the account's cart.
```

## How the cart flow works

Validated 2026-06-22 via probe scripts (`probe-cart-ui.mjs`,
`probe-click-avail.mjs`, `probe-after-click.mjs`):

1. Open `/camping/campgrounds/<id>?startdate=X&enddate=Y` (Y is checkout).
2. The page renders a `~10-day` per-site grid. Each cell is
   `<button class="rec-availability-date">` with aria-label
   `"<MonAbbr> <Day>, <Year> - Site <SiteNo> is available"` for bookable
   nights, `"... is Reserved"` / `"... is Closed"` otherwise.
3. Advance via `button[aria-label="Go Forward 5 Days"]` until the target
   date column is rendered.
4. Click the Available cell for the START date on the desired site. A
   single click is enough — the page interprets the URL `startdate`/`enddate`
   as the full trip, so "Add to Cart" appears immediately.
5. Click `#add-cart-campsite` / `button:has-text("Add to Cart")`.
6. Verify in a fresh `/cart` tab — body text should contain `Site <N>` and
   the start date.

## Env vars (loaded from `./.env` at repo root)

- `REC_EMAIL` / `REC_PASSWORD` — account 1 credentials.
- `CAMPSPOT_DISCORD_WEBHOOK_URL` (optional) — campspot-bot's own channel.
  Falls back to `WEBHOOK_URL`.
- `NTFY_TOPIC_URL` (optional) — same ntfy channel the other bots use.
