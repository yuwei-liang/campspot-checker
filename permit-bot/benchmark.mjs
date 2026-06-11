import axios from 'axios'
import { httpsAgent } from './dnsBypass.mjs'

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function urlFor(permitId, monthStartIso, monthEndIso) {
    return `https://www.recreation.gov/api/permitinyo/${permitId}/availability` +
        `?start_date=${encodeURIComponent(monthStartIso)}` +
        `&end_date=${encodeURIComponent(monthEndIso)}` +
        `&commercial_acct=false`
}

function pct(arr, p) {
    if (arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
    return sorted[idx]
}

// Fire `requests` total API calls at the target interval. Counts 429s, other
// errors, response times. concurrency=N issues N parallel polls per tick.
export async function benchmarkPolling({
    permitId,
    monthStartIso,
    monthEndIso,
    intervalMs,
    concurrency = 1,
    durationSec = 60,
    log = console,
}) {
    const url = urlFor(permitId, monthStartIso, monthEndIso)
    const latencies = []
    let okCount = 0
    let rateLimited = 0
    let netErrors = 0
    let serverErrors = 0
    let firstRateLimitAt = null
    const startMs = Date.now()
    const deadline = startMs + durationSec * 1000

    log.info(`benchmark start: interval=${intervalMs}ms concurrency=${concurrency} duration=${durationSec}s`)
    log.info(`url: ${url}`)

    const issueOne = async () => {
        const t0 = Date.now()
        try {
            const res = await axios.get(url, {
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
                timeout: 10000,
                httpsAgent,
                validateStatus: () => true,
            })
            const dt = Date.now() - t0
            if (res.status === 200) {
                latencies.push(dt)
                okCount += 1
            } else if (res.status === 429) {
                rateLimited += 1
                if (firstRateLimitAt == null) {
                    firstRateLimitAt = (Date.now() - startMs) / 1000
                    log.warn(`first 429 at t=${firstRateLimitAt.toFixed(1)}s (after ${okCount} ok)`)
                }
            } else if (res.status >= 500) {
                serverErrors += 1
            } else {
                log.warn(`unexpected status ${res.status} at t=${(Date.now()-startMs)/1000}s`)
            }
        } catch (err) {
            netErrors += 1
        }
    }

    let tick = 0
    while (Date.now() < deadline) {
        const tickStart = Date.now()
        const batch = []
        for (let i = 0; i < concurrency; i++) batch.push(issueOne())
        await Promise.all(batch)
        tick += 1
        const elapsed = Date.now() - tickStart
        const sleep = Math.max(0, intervalMs - elapsed)
        if (tick % 10 === 0 || rateLimited > 0) {
            const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1)
            log.info(`t=${elapsedSec}s ticks=${tick} ok=${okCount} 429=${rateLimited} 5xx=${serverErrors} neterr=${netErrors} p50=${pct(latencies, 0.5)}ms p95=${pct(latencies, 0.95)}ms`)
        }
        if (sleep > 0) await new Promise(r => setTimeout(r, sleep))
    }

    const totalSec = (Date.now() - startMs) / 1000
    const totalRequests = okCount + rateLimited + netErrors + serverErrors
    log.info(`---- SUMMARY ----`)
    log.info(`duration:       ${totalSec.toFixed(1)}s`)
    log.info(`requests sent:  ${totalRequests}`)
    log.info(`ok:             ${okCount}`)
    log.info(`429s:           ${rateLimited}${firstRateLimitAt != null ? ` (first at ${firstRateLimitAt.toFixed(1)}s)` : ''}`)
    log.info(`5xx:            ${serverErrors}`)
    log.info(`net errors:     ${netErrors}`)
    log.info(`avg rate:       ${(totalRequests / totalSec).toFixed(2)} req/s`)
    log.info(`latency p50/95/99: ${pct(latencies, 0.5)} / ${pct(latencies, 0.95)} / ${pct(latencies, 0.99)} ms`)
    return {
        totalSec,
        totalRequests,
        okCount,
        rateLimited,
        firstRateLimitAt,
        latencyMs: { p50: pct(latencies, 0.5), p95: pct(latencies, 0.95), p99: pct(latencies, 0.99) },
    }
}
