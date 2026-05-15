const REQUIRED = ['WEBHOOK_URL', 'MONTH_START', 'TARGET_DATE']

export const loadConfig = (env = process.env) => {
    const missing = REQUIRED.filter((key) => !env[key])
    if (missing.length > 0) {
        throw new Error(
            `Missing required env vars: ${missing.join(', ')}. ` +
            `Copy .env.example to .env and fill them in.`
        )
    }

    const pollIntervalMs = Number.parseInt(env.POLL_INTERVAL_MS || '90000', 10)
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
        throw new Error(
            `POLL_INTERVAL_MS must be a positive integer >= 1000 (got ${env.POLL_INTERVAL_MS}). ` +
            `Default 90000 (90s) is recommended to stay under recreation.gov rate limits.`
        )
    }

    return {
        webhookUrl: env.WEBHOOK_URL,
        monthStart: env.MONTH_START,
        targetDate: env.TARGET_DATE,
        pollIntervalMs,
    }
}
