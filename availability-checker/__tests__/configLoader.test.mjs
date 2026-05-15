import { loadConfig } from '../configLoader.mjs'

const validEnv = () => ({
    WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
    MONTH_START: '2026-06-01T00:00:00.000Z',
    TARGET_DATE: '2026-06-27T00:00:00Z',
})

describe('loadConfig', () => {
    test('returns expected shape when all required vars are set', () => {
        const env = { ...validEnv(), POLL_INTERVAL_MS: '120000' }
        expect(loadConfig(env)).toEqual({
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            monthStart: '2026-06-01T00:00:00.000Z',
            targetDate: '2026-06-27T00:00:00Z',
            pollIntervalMs: 120000,
        })
    })

    test('defaults POLL_INTERVAL_MS to 90000 when omitted', () => {
        const cfg = loadConfig(validEnv())
        expect(cfg.pollIntervalMs).toBe(90000)
    })

    test('throws listing every missing required var', () => {
        expect(() => loadConfig({})).toThrow(/WEBHOOK_URL.*MONTH_START.*TARGET_DATE/)
    })

    test('throws when MONTH_START missing', () => {
        const env = validEnv()
        delete env.MONTH_START
        expect(() => loadConfig(env)).toThrow(/MONTH_START/)
    })

    test('rejects non-numeric POLL_INTERVAL_MS', () => {
        const env = { ...validEnv(), POLL_INTERVAL_MS: 'soon' }
        expect(() => loadConfig(env)).toThrow(/POLL_INTERVAL_MS/)
    })

    test('rejects too-aggressive POLL_INTERVAL_MS (< 1000ms)', () => {
        const env = { ...validEnv(), POLL_INTERVAL_MS: '500' }
        expect(() => loadConfig(env)).toThrow(/POLL_INTERVAL_MS/)
    })
})
