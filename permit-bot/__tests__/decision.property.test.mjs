// Property-based tests for decide().
//
// example-based tests (decision.test.mjs) cover specific scenarios we
// anticipated. Property tests hit thousands of random inputs and assert
// INVARIANTS that should ALWAYS hold no matter the input. They've found
// edge cases in production code at Stripe, Jane Street, Coinbase — the
// pattern is worth ~20 lines of code for a pure function like this.

import fc from 'fast-check'
import { decide } from '../decision.mjs'

const HI_ID = '44585917'
const GP_ID = '44585913'
const HI_CAP = 15
const GP_CAP = 6

// arbitraries
const remaining = fc.integer({ min: 0, max: 30 })
const partyTargets = fc.oneof(
    fc.constant([7, 6]),
    fc.constant([6]),
    fc.constant([7]),
    fc.constant([7, 6, 5, 4]),
)
const decideInput = fc.record({
    hi: remaining,
    gp: remaining,
    partyTargets,
})

describe('decide() — property-based invariants', () => {
    test('non-null plan: partySize is one of partyTargets', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan) return // null is fine
            expect(partyTargets).toContain(plan.partySize)
        }))
    })

    test('non-null plan: kind is solo or split, never undefined', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan) return
            expect(['solo', 'split']).toContain(plan.kind)
        }))
    })

    test('solo plan: shots.length === 1 and shots[0].party === partySize', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan || plan.kind !== 'solo') return
            expect(plan.shots).toHaveLength(1)
            expect(plan.shots[0].party).toBe(plan.partySize)
        }))
    })

    test('split plan: shots sum to partySize, each shot party >= 1', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan || plan.kind !== 'split') return
            expect(plan.shots).toHaveLength(2)
            const sum = plan.shots.reduce((s, x) => s + x.party, 0)
            expect(sum).toBe(plan.partySize)
            expect(plan.shots.every(s => s.party >= 1)).toBe(true)
        }))
    })

    test('every shot targets HI or GP divisionId', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan) return
            for (const s of plan.shots) {
                expect([HI_ID, GP_ID]).toContain(s.divisionId)
            }
        }))
    })

    test('split plan: HI shot fits in hi remaining, GP shot fits in gp remaining', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan || plan.kind !== 'split') return
            const hiShot = plan.shots.find(s => s.divisionId === HI_ID)
            const gpShot = plan.shots.find(s => s.divisionId === GP_ID)
            expect(hiShot).toBeTruthy()
            expect(gpShot).toBeTruthy()
            expect(hiShot.party).toBeLessThanOrEqual(hi)
            expect(gpShot.party).toBeLessThanOrEqual(gp)
        }))
    })

    test('solo at GP: party never exceeds GP_CAP (6)', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan || plan.kind !== 'solo') return
            if (plan.shots[0].divisionId === GP_ID) {
                expect(plan.shots[0].party).toBeLessThanOrEqual(GP_CAP)
            }
        }))
    })

    test('solo at HI: party never exceeds HI_CAP (15) and shot fits in hi remaining', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan || plan.kind !== 'solo') return
            if (plan.shots[0].divisionId === HI_ID) {
                expect(plan.shots[0].party).toBeLessThanOrEqual(HI_CAP)
                expect(plan.shots[0].party).toBeLessThanOrEqual(hi)
            }
        }))
    })

    test('null returned only when no party target is feasible', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (plan) return // anything we got, we proved feasible
            // Assert: NO partyTarget in the list is achievable. For each
            // target, check that neither solo-HI, solo-GP, nor any split
            // would have worked.
            for (const need of partyTargets) {
                const soloHi = hi >= need && need <= HI_CAP
                const soloGp = gp >= need && need <= GP_CAP
                const splitOk = hi >= 1 && gp >= 1 && hi + gp >= need &&
                    // Can split with hiPart leaving gpPart >=1 and gpPart <= GP_CAP
                    Math.min(hi, need - 1) >= 1 && (need - Math.min(hi, need - 1)) >= 1 &&
                    (need - Math.min(hi, need - 1)) <= Math.min(gp, GP_CAP)
                expect(soloHi || soloGp || splitOk).toBe(false)
            }
        }))
    })

    test('account assignment: solo uses acct1; split uses acct1 for HI, acct2 for GP', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan) return
            if (plan.kind === 'solo') {
                expect(plan.shots[0].accountIndex).toBe(1)
            } else {
                const hiShot = plan.shots.find(s => s.divisionId === HI_ID)
                const gpShot = plan.shots.find(s => s.divisionId === GP_ID)
                expect(hiShot.accountIndex).toBe(1)
                expect(gpShot.accountIndex).toBe(2)
            }
        }))
    })

    test('every shot carries nameTokens (so DOM matcher always has anchors)', () => {
        fc.assert(fc.property(decideInput, ({ hi, gp, partyTargets }) => {
            const plan = decide({ hi, gp, partyTargets })
            if (!plan) return
            for (const s of plan.shots) {
                expect(Array.isArray(s.nameTokens)).toBe(true)
                expect(s.nameTokens.length).toBeGreaterThan(0)
            }
        }))
    })
})
