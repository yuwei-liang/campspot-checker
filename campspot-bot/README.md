# campspot-bot

Sibling to `permit-bot/`. Watches a rec.gov **campground** (not permit) for
Thu–Sun stays in a configurable window and (optionally) drives Playwright to
add the slot to the user's cart so the hold sticks for 15 minutes.

Targets are set in `campspot-bot/config.json` as `{ shared, campgrounds[] }`.
`shared` covers the targeting window / weekdays / nights; each entry in
`campgrounds[]` adds a `{ campgroundId, campgroundName, park }` and can
override any shared field. Ships with the eight reservable Yosemite
campgrounds (Upper/Lower/North Pines, Hodgdon Meadow, Crane Flat, Wawona,
Bridalveil Creek, Tuolumne Meadows). Legacy single-campground configs
(everything at the top level) still load — they're normalized to a
one-element list at read time.

Run one watch per campground; `--campground=ID` picks which entry. State
files are written per id (`state/status-<id>.json`) so processes don't
stomp each other and the dashboard renders one card per running bot.

Re-uses the rec.gov login from `permit-bot/.chromium-profile`, so run
`node permit-bot/permit-bot.mjs login --account=1` once before any
`--for-real` cart operation.

## Commands

```
node campspot-bot/campspot-bot.mjs check [--campground=ID]
  # one-shot scan of every campsite, prints qualifying Thu-Sun stays
  # (ranked: longest first, earliest first, lowest site #).
  # Defaults to the first entry in config.campgrounds[].

node campspot-bot/campspot-bot.mjs cart [--campground=ID] --site=068 --start=2026-09-10 --end=2026-09-14
  # dry-run cart flow: opens browser, advances the calendar, locates the
  # Available cell, screenshots. No clicks past the cell.

node campspot-bot/campspot-bot.mjs cart [--campground=ID] --site=068 --start=2026-09-10 --end=2026-09-14 --for-real
  # actually clicks "Add to Cart", verifies /cart hold, posts Discord with
  # the cart screenshot.

node campspot-bot/campspot-bot.mjs watch [--campground=ID]
  # poll every config.pollIntervalMs; Discord/ntfy on NEW openings only.

node campspot-bot/campspot-bot.mjs watch --campground=ID --auto-grab
  # same, but fires the cart bot on the top-ranked new stay (one at a time;
  # 1-hour cooldown per (site, dates) so we don't retry the same loss).

node campspot-bot/campspot-bot.mjs release-cart [--account=N]
  # test-only: clears every hold from the account's cart.
```

### Watching multiple campgrounds

The bot is single-campground per process; fan out with one process per
entry. Quick tmux pattern:

```
for id in 232447 232450 232449; do
  tmux new-session -d -s "campspot-$id" \
    "node campspot-bot/campspot-bot.mjs watch --campground=$id"
done
```

The dashboard scans `campspot-bot/state/` and renders one card per running
watch — no extra wiring needed.

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
