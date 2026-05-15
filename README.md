# campspot-checker

Polls recreation.gov for campsite availability and pings a Discord channel when a site opens up for your target date.

## Setup

1. `cp .env.example .env` and fill in:
   - `WEBHOOK_URL` — your Discord webhook URL
   - `MONTH_START` — first of the first month you're monitoring, e.g. `2026-06-01T00:00:00.000Z` (matches what recreation.gov's API expects)
   - `MONTHS_TO_SCAN` — optional, 1..12. How many consecutive months to scan from `MONTH_START`. Each campground gets one API request per month per cycle.
   - `TARGET_WEEKDAYS` — comma-separated weekday names to monitor, e.g. `Thu,Fri,Sat`. Expands to every matching night across all scanned months.
   - `TARGET_DATE` — optional single-date fallback when `TARGET_WEEKDAYS` is unset, e.g. `2026-06-27T00:00:00Z`.
   - `POLL_INTERVAL_MS` — optional, defaults to `90000` (90s). Don't drop below `1000`.
2. `npm install`
3. `npm start`
4. Open http://localhost:8787 for the live status page (override the port with `PORT=...` in `.env` if 8787 is taken).

## Configure which campgrounds to monitor

Edit `campgrounds.json`. Each entry is `{ "name": "...", "id": <recreation.gov id>, "park": "..." }`. The `id` is the number in the campground URL on recreation.gov, e.g. `https://www.recreation.gov/camping/campgrounds/232447` → id `232447`.

## Run tests

```
npm test
```

## How it works

`server.mjs` reads `.env` and `campgrounds.json`, builds a `Checker`, and polls each campground in sequence with a 2s gap between calls. After every cycle, it waits `POLL_INTERVAL_MS + jitter` before the next cycle. On HTTP 429 / 5xx / network errors, it backs off exponentially up to 10 minutes (and honors `Retry-After` when present) so we don't get IP-banned by recreation.gov.

When a campsite is available for `TARGET_DATE`, the report is posted to `WEBHOOK_URL`. Heartbeats are posted every 30 minutes so you know the monitor is alive.

## Docker

```
docker compose up --build
```
