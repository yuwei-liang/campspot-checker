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

## Deploy to NAS

After local changes:

```
./deploy.sh
```

Builds an amd64 image, ships it + `.env` + `docker-compose-nas.yml` over SSH to `blackwhale:/volume1/docker/campspot-checker/`, and force-recreates the container. Image transfer is ~30s over LAN. Live URL: https://campspot.yuweiliang.com.

Prereqs (one-time, already set up on this Mac + NAS):
- SSH key auth to `blackwhale` host alias
- Passwordless sudo for docker on the NAS (`/etc/sudoers.d/docker-fredcorn`)
- DSM SFTP service enabled (for `scp -O`)

## Public access via Cloudflare Tunnel

Expose the dashboard at `campspot.yuweiliang.com` without opening any inbound port on the router. A `cloudflared` sidecar runs next to the app and makes outbound-only connections to Cloudflare's edge. Cloudflare Access (free, up to 50 users) gates the subdomain behind an email allowlist with one-time PIN auth.

### 1. Provision the Cloudflare side (one command)

Create a custom API token at https://dash.cloudflare.com/profile/api-tokens with these scopes (restrict zone scope to `yuweiliang.com`):
- Account → Cloudflare Tunnel → Edit
- Account → Access: Apps and Policies → Edit
- Zone → DNS → Edit
- Zone → Zone → Read

Then:
```
export CLOUDFLARE_API_TOKEN=...           # the token you just made
export ALLOWED_EMAILS="you@x.com,friend@y.com"
./cloudflared/setup-cloudflare.sh
```

This creates the tunnel, ingress (`campspot.yuweiliang.com` → `host.docker.internal:49160`), DNS CNAME, Access application, and Access policy in one go. It writes the resulting tunnel token to `cloudflared/.env`.

> First-time Zero Trust users: if Access calls fail, visit https://one.dash.cloudflare.com once to accept the free Zero Trust terms, then re-run the script.

### 2. Run the sidecar on the NAS

Upload `cloudflared/docker-compose.yml` and `cloudflared/.env` to Synology Container Manager as a new project at `/volume1/docker/campspot-cloudflared`, then start it. Logs should show `Registered tunnel connection`.

Verify with `curl -I https://campspot.yuweiliang.com` — you should get a Cloudflare Access login redirect.

