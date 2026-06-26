// Tests for the dashboard data aggregator.
//
// Focus: multi-campground campspot scan. The aggregator now lists every
// `status-*.json` under the state dir and emits one bot view per file.
// We don't want a half-rolled-out multi-watch deploy to blank out the
// dashboard, so the legacy `status.json` name is also recognized.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildDashboardData } from '../dashboardData.mjs'

function writeState(dir, name, state) {
    writeFileSync(path.join(dir, name), JSON.stringify(state))
}

function snapshot(overrides = {}) {
    return {
        bot: 'campspot-bot',
        pid: 0, // 0 → isPidAlive returns false → liveness becomes "dead"; deterministic for tests
        startedAt: '2026-06-26T07:00:00Z',
        lastHeartbeat: '2026-06-26T07:00:05Z',
        mode: 'watch',
        config: { pollIntervalMs: 30000 },
        metrics: { cycles: 1, errors: 0 },
        recentEvents: [],
        ...overrides,
    }
}

describe('buildDashboardData — campspot multi-card', () => {
    let tmp
    let savedDir
    let savedFile
    let savedLogDir

    beforeEach(() => {
        tmp = mkdtempSync(path.join(tmpdir(), 'campspot-dash-'))
        savedDir = process.env.CAMPSPOT_STATE_DIR
        savedFile = process.env.CAMPSPOT_STATE_FILE
        savedLogDir = process.env.PERMIT_BOT_LOG_DIR
        process.env.CAMPSPOT_STATE_DIR = tmp
        // Point permit-bot away from anything real so its present/absent
        // result is deterministic and irrelevant to these assertions.
        process.env.PERMIT_BOT_LOG_DIR = path.join(tmp, 'no-permit-logs-here')
        delete process.env.CAMPSPOT_STATE_FILE
    })

    afterEach(() => {
        restore('CAMPSPOT_STATE_DIR', savedDir)
        restore('CAMPSPOT_STATE_FILE', savedFile)
        restore('PERMIT_BOT_LOG_DIR', savedLogDir)
        rmSync(tmp, { recursive: true, force: true })
    })

    function restore(key, val) {
        if (val === undefined) delete process.env[key]
        else process.env[key] = val
    }

    test('renders one campspot card per status-*.json in the state dir', () => {
        writeState(tmp, 'status-232447.json', snapshot({
            config: { campgroundName: 'Upper Pines Campground', pollIntervalMs: 30000 },
        }))
        writeState(tmp, 'status-232450.json', snapshot({
            config: { campgroundName: 'Lower Pines Campground', pollIntervalMs: 30000 },
        }))

        const data = buildDashboardData()
        const campspotCards = data.bots.filter(b => b.bot === 'campspot-bot')
        expect(campspotCards).toHaveLength(2)
        const labels = campspotCards.map(c => c.label).sort()
        expect(labels).toEqual([
            'campspot-bot (Lower Pines Campground)',
            'campspot-bot (Upper Pines Campground)',
        ])
    })

    test('legacy status.json is still picked up so dashboard-before-bot deploys do not blank', () => {
        writeState(tmp, 'status.json', snapshot({
            config: { campgroundName: 'Upper Pines Campground' },
        }))

        const cards = buildDashboardData().bots.filter(b => b.bot === 'campspot-bot')
        expect(cards).toHaveLength(1)
        expect(cards[0].label).toBe('campspot-bot (Upper Pines Campground)')
    })

    test('no state files → single absent placeholder with run-command hint', () => {
        const cards = buildDashboardData().bots.filter(b => b.bot === 'campspot-bot')
        expect(cards).toHaveLength(1)
        expect(cards[0].liveness).toBe('absent')
        expect(cards[0].absentReason).toMatch(/--campground=/)
    })

    test('CAMPSPOT_STATE_FILE (legacy env) still resolves the directory', () => {
        delete process.env.CAMPSPOT_STATE_DIR
        process.env.CAMPSPOT_STATE_FILE = path.join(tmp, 'status.json')
        writeState(tmp, 'status.json', snapshot({
            config: { campgroundName: 'Upper Pines Campground' },
        }))
        const cards = buildDashboardData().bots.filter(b => b.bot === 'campspot-bot')
        expect(cards).toHaveLength(1)
    })

    test('label without campgroundName falls back to bare "campspot-bot"', () => {
        writeState(tmp, 'status-unknown.json', snapshot({ config: {} }))
        const cards = buildDashboardData().bots.filter(b => b.bot === 'campspot-bot')
        expect(cards[0].label).toBe('campspot-bot')
    })
})
