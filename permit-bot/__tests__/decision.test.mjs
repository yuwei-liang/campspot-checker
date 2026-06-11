import { decide } from '../decision.mjs'

// Maps a plan to a compact comparable shape for assertions.
const summarize = (plan) => {
    if (!plan) return null
    return {
        kind: plan.kind,
        party: plan.partySize,
        shots: plan.shots.map(s => ({
            acct: s.accountIndex,
            div: s.divisionId,
            p: s.party,
        })),
    }
}

const HI = '44585917'
const GP = '44585913'

describe('decide() — solo path (party 7 first)', () => {
    test('full release fires solo Happy Isles party=7', () => {
        expect(summarize(decide({ hi: 15, gp: 6 }))).toEqual({
            kind: 'solo', party: 7,
            shots: [{ acct: 1, div: HI, p: 7 }],
        })
    })

    test('plenty solo: hi=8 still solo at HI', () => {
        expect(summarize(decide({ hi: 8, gp: 6 }))).toEqual({
            kind: 'solo', party: 7,
            shots: [{ acct: 1, div: HI, p: 7 }],
        })
    })

    test('exact 7 at HI fires solo', () => {
        expect(summarize(decide({ hi: 7, gp: 6 }))).toEqual({
            kind: 'solo', party: 7,
            shots: [{ acct: 1, div: HI, p: 7 }],
        })
    })
})

describe('decide() — split path (party 7 falls through to split)', () => {
    test('hi=6 forces split 6+1', () => {
        expect(summarize(decide({ hi: 6, gp: 6 }))).toEqual({
            kind: 'split', party: 7,
            shots: [
                { acct: 1, div: HI, p: 6 },
                { acct: 2, div: GP, p: 1 },
            ],
        })
    })

    test('hi=4, gp=3 → split 4+3', () => {
        expect(summarize(decide({ hi: 4, gp: 3 }))).toEqual({
            kind: 'split', party: 7,
            shots: [
                { acct: 1, div: HI, p: 4 },
                { acct: 2, div: GP, p: 3 },
            ],
        })
    })

    test('hi=1, gp=6 → split 1+6', () => {
        expect(summarize(decide({ hi: 1, gp: 6 }))).toEqual({
            kind: 'split', party: 7,
            shots: [
                { acct: 1, div: HI, p: 1 },
                { acct: 2, div: GP, p: 6 },
            ],
        })
    })

    test('split bias: leave >=1 for GP so we never grab solo via split path', () => {
        // hi=7 alone would solo; verify it does (no degenerate split).
        const p = decide({ hi: 7, gp: 1 })
        expect(p.kind).toBe('solo')
    })
})

describe('decide() — fallback to party 6', () => {
    test('hi=6, gp=0: solo HI party=6', () => {
        expect(summarize(decide({ hi: 6, gp: 0 }))).toEqual({
            kind: 'solo', party: 6,
            shots: [{ acct: 1, div: HI, p: 6 }],
        })
    })

    test('hi=0, gp=6: solo GP party=6', () => {
        expect(summarize(decide({ hi: 0, gp: 6 }))).toEqual({
            kind: 'solo', party: 6,
            shots: [{ acct: 1, div: GP, p: 6 }],
        })
    })

    test('hi=3, gp=3: split party=6 as 3+3', () => {
        expect(summarize(decide({ hi: 3, gp: 3 }))).toEqual({
            kind: 'split', party: 6,
            shots: [
                { acct: 1, div: HI, p: 3 },
                { acct: 2, div: GP, p: 3 },
            ],
        })
    })

    test('hi=5, gp=1 falls back to party=6 split 5+1', () => {
        expect(summarize(decide({ hi: 5, gp: 1 }))).toEqual({
            kind: 'split', party: 6,
            shots: [
                { acct: 1, div: HI, p: 5 },
                { acct: 2, div: GP, p: 1 },
            ],
        })
    })
})

describe('decide() — no plan (wait)', () => {
    test('sub-6 total returns null', () => {
        expect(decide({ hi: 2, gp: 3 })).toBeNull()
    })

    test('nothing returns null', () => {
        expect(decide({ hi: 0, gp: 0 })).toBeNull()
    })

    test('hi=5, gp=0 cannot reach 6 → null', () => {
        expect(decide({ hi: 5, gp: 0 })).toBeNull()
    })

    test('hi=0, gp=5 cannot reach 6 (GP solo needs 6) → null', () => {
        expect(decide({ hi: 0, gp: 5 })).toBeNull()
    })
})

describe('decide() — type safety (regression guard)', () => {
    test('string inputs do NOT silently produce wrong plans', () => {
        // If callers ever pass strings from JSON, we should either coerce or
        // refuse — not silently NaN our way into a wrong plan.
        const plan = decide({ hi: '15', gp: '6' })
        // Numeric coercion via comparison ('15' >= 7 is true) means JS still
        // makes the right call here; this test pins that behavior.
        expect(plan).not.toBeNull()
        expect(plan.kind).toBe('solo')
        expect(plan.partySize).toBe(7)
    })

    test('null inputs return null (no crash)', () => {
        expect(decide({ hi: null, gp: null })).toBeNull()
    })

    test('undefined inputs return null', () => {
        expect(decide({ hi: undefined, gp: undefined })).toBeNull()
    })

    test('NaN inputs return null', () => {
        // NaN >= N is always false, so falls all the way through.
        expect(decide({ hi: NaN, gp: NaN })).toBeNull()
    })
})

describe('decide() — trailhead overrides (simulate mode)', () => {
    test('hi/gp trailhead overrides flow into shots', () => {
        const COTTONWOOD = { divisionId: '44585909', name: 'Cottonwood Creek' }
        const plan = decide({
            hi: 12, gp: 12,
            hiTrailhead: COTTONWOOD,
            gpTrailhead: COTTONWOOD,
        })
        expect(plan.shots[0].divisionId).toBe('44585909')
        expect(plan.shots[0].name).toBe('Cottonwood Creek')
    })
})

describe('decide() — custom party targets', () => {
    test('partyTargets=[4] respects narrowed search', () => {
        const plan = decide({ hi: 4, gp: 0, partyTargets: [4] })
        expect(plan).toEqual({
            kind: 'solo',
            partySize: 4,
            shots: [expect.objectContaining({ accountIndex: 1, party: 4 })],
        })
    })

    test('partyTargets=[10] splits 6 HI + 4 GP (both within trailhead caps)', () => {
        // hi=6, gp=6, party=10: split takes min(hi, 9)=6 from HI, 4 from GP.
        // GP=4 ≤ gpCap=6 → valid. Each sub-permit respects its trailhead cap.
        expect(summarize(decide({ hi: 6, gp: 6, partyTargets: [10] }))).toEqual({
            kind: 'split', party: 10,
            shots: [
                { acct: 1, div: HI, p: 6 },
                { acct: 2, div: GP, p: 4 },
            ],
        })
    })

    test('partyTargets=[20] rejected when gp_part would exceed gpCap=6', () => {
        // hi=10, gp=10, party=20: split takes min(hi, 19)=10 from HI, 10 from GP.
        // But gp_part=10 > gpCap=6 → split rejected. No viable plan.
        expect(decide({ hi: 10, gp: 10, partyTargets: [20] })).toBeNull()
    })
})
