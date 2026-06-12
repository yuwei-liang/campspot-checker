# TODOS

## Notification dedup
**What:** Once a campsite becomes available, the current loop fires a Discord post every cycle for as long as it stays available — potentially many pings before someone clicks Reserve. Add a per-site `last-notified` state so the same `(campground_id, siteNO, targetDate)` only pings once per hour.

**Why:** First time the monitor actually catches an opening, the Discord channel will overflow.

**Pros:** Makes the monitor usable in practice; trivial in-memory map keyed by `(campground, site, date)`.
**Cons:** In-memory state lost on container restart (acceptable trade); adds ~20 lines to `Checker`.
**Context:** State lives in the `Checker` instance, resets on process restart. 1h TTL is a reasonable default.
**Depends on:** nothing.

## Broader test coverage on Notifier and Checker.executeCheck
**What:** Current tests cover `Campground`, `configLoader`, and `Checker.__getSiteAvailabilities` / error-handling. Missing: `Notifier.__limitSize` truncation logic, full `Checker.executeCheck` loop (requires axios mocking, probably via dependency injection of the http client).

**Why:** The reason the 2023-date bug went unnoticed for years is precisely that nothing tested this code. Filling the suite long-term is the right hedge.

**Pros:** Prevents the next silent-broken bug.
**Cons:** Requires refactoring `Checker` to accept an axios client via DI (or wrestling with jest's experimental ESM module mocking).
**Context:** Jest is wired up via `node --experimental-vm-modules`. Tests live in `availability-checker/__tests__/`.

## Circuit-break on sustained API failures
**What:** Today the backoff caps at 10 minutes and keeps retrying forever. Add a circuit breaker: after N consecutive failures (e.g. 5), enter an "open" state and stop polling for a longer cooldown (e.g. 1 hour). Log loudly so operator notices.

**Why:** If recreation.gov changes their API or our IP gets banned, current behavior is an infinite retry loop on a 10-min cycle that fills logs but does no useful work.

**Pros:** Cleaner failure mode; surfaces real outages instead of hiding them in logs.
**Cons:** State management gets a little more complex.

## Alert on "all reserved" uniformity (silent-failure detector)
**What:** If every campground in `campgrounds.json` reports "ALL RESERVED" for N consecutive cycles (e.g. 10), post a warning to Discord. This is the exact failure mode that hid the 2023-date bug for years.

**Why:** A monitor that produces no signal indistinguishably from "everything is full" is a monitor that hides bugs. Catch the next silent failure proactively.

**Pros:** Defends against the same class of bug we just fixed.
**Cons:** Could false-positive in peak season when everything actually is full.

## Heartbeat scheduler refactor
**What:** `liveCheck` runs a 60s timer and checks `minutes % 30 === 0` to fire a Discord heartbeat. Cleaner: use a proper scheduler that fires at known intervals from boot time. Or just `setInterval(notifier.heartbeat, 30 * 60 * 1000)`.

**Why:** Current logic is hard to reason about and can miss fires if the loop drifts.

**Pros:** Simpler code, predictable timing.
**Cons:** Loses minute-aligned heartbeats (current code fires near :00 and :30 of the hour).

## Containerize permit-bot for Alienware (post-LYV-grab)
**What:** Ship the permit bot as a Docker stack on the Alienware homelab host (`192.168.68.90`) following the `/home/fredcorn/<app>/` + `homelab/<app>/` pattern. Source-of-truth: `homelab/permit-bot/`. Image: `mcr.microsoft.com/playwright:v1.60.0-jammy` base. Volumes for `.chromium-profile*` (login state) and `permit-bot/logs/`. Default cmd: `watch-auto --pre-warm`. Heartbeat-via-Discord is the watchdog (no listening port unless we add a `/health` endpoint for Kuma).

**Why:** Always-on watcher with no laptop-sleep risk. Alienware has 6C/12T + 32 GB so two Chromiums + Node is nothing. Race latency unchanged vs Mac (same home ISP egress).

**Pros:** Survives Mac sleep/reboot; integrates with existing Beszel/Kuma/Caddy ops; reuses `alienware-f20d0e8e20ccaa5c` ntfy topic.
**Cons:** Login bootstrap is awkward — must do headed `login --account=N` locally on Mac then rsync `.chromium-profile*` dirs to the Alienware volume (treat as secrets — they're session cookies). Headless on server = can't recover from a mid-grab captcha; heartbeat will surface the failure but the race for that release moment is lost. For race-critical fire moments, a us-east-1 VM still beats home internet (~80-120ms → ~10-30ms RTT to rec.gov on AWS).
**Context:** Defer until current Mac-based setup has secured the LYV spots. Don't fork bot code — homelab compose should pull from `workspaces/campspot-checker/permit-bot/` via build context.
**Depends on:** at least one successful grab with the current setup (validate the bot end-to-end before re-platforming).

## Rotate webhook one more time post-deploy
**What:** The webhook URL was pasted into a Claude chat conversation during this implementation. Once deployment is verified, generate a new webhook URL, update `.env`, and revoke the current one. Belt-and-suspenders since chat transcripts can be cached.

**Why:** Maximum hygiene — the value in production should never have transited a third-party LLM conversation.

**Pros:** Zero-trust posture on the secret.
**Cons:** None — straightforward operational step.
