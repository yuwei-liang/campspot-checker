// Decide what to fire based on current LYV availability.
//
// Inputs (per target date):
//   hi = Happy Isles -> LYV remaining (max 15)
//   gp = Glacier Point -> LYV remaining (max 6)
//   partyTargets = [7, 6]  // try 7 first, fall back to 6
//
// Output:
//   null            — no viable plan, keep waiting
//   {kind:'solo',  shots:[{accountIndex, divisionId, name, party}], partySize}
//   {kind:'split', shots:[..., ...],                                  partySize}

const HAPPY_ISLES = { divisionId: '44585917', name: 'Happy Isles -> Little Yosemite Valley (No Donohue)' }
const GLACIER_POINT = { divisionId: '44585913', name: 'Glacier Point -> Little Yosemite Valley' }
const GP_CAP = 6   // Glacier Point max group size
const HI_CAP = 15  // Happy Isles max group size

export function decide({
    hi,
    gp,
    partyTargets = [7, 6],
    // Account assignment: solo always uses acct1. Split uses acct1 for the
    // larger half (Happy Isles), acct2 for the smaller (Glacier Point).
    soloAccount = 1,
    hiAccount = 1,
    gpAccount = 2,
    // Trailhead overrides — used by simulate mode to point shots at a
    // known-available test trailhead instead of real LYV.
    hiTrailhead = HAPPY_ISLES,
    gpTrailhead = GLACIER_POINT,
} = {}) {
    for (const need of partyTargets) {
        // Solo Happy Isles — preferred whenever it fits.
        if (hi >= need && need <= HI_CAP) {
            return {
                kind: 'solo',
                partySize: need,
                shots: [{ accountIndex: soloAccount, ...hiTrailhead, party: need }],
            }
        }
        // Solo Glacier Point — only applicable for parties up to GP_CAP (6).
        if (gp >= need && need <= GP_CAP) {
            return {
                kind: 'solo',
                partySize: need,
                shots: [{ accountIndex: soloAccount, ...gpTrailhead, party: need }],
            }
        }
        // Split — at least 1 in each, totalling `need`. Bias toward
        // taking as much as possible from Happy Isles (bigger quota = lower
        // race risk).
        if (hi >= 1 && gp >= 1 && hi + gp >= need) {
            const hiPart = Math.min(hi, need - 1)   // leave >=1 for GP
            const gpPart = need - hiPart
            if (gpPart >= 1 && gpPart <= gp && gpPart <= GP_CAP) {
                return {
                    kind: 'split',
                    partySize: need,
                    shots: [
                        { accountIndex: hiAccount, ...hiTrailhead, party: hiPart },
                        { accountIndex: gpAccount, ...gpTrailhead, party: gpPart },
                    ],
                }
            }
        }
    }
    return null
}

// Quick sanity smoke when run directly: `node permit-bot/decision.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
    const cases = [
        { hi: 15, gp: 6, label: 'release-moment (full)' },
        { hi: 8, gp: 6, label: 'plenty solo' },
        { hi: 7, gp: 6, label: 'exact 7 at HI' },
        { hi: 6, gp: 6, label: 'no 7-solo; split 6+1' },
        { hi: 4, gp: 3, label: 'split 4+3' },
        { hi: 1, gp: 6, label: 'split 1+6' },
        { hi: 6, gp: 0, label: 'fall back to party 6 solo HI' },
        { hi: 0, gp: 6, label: 'fall back to party 6 solo GP' },
        { hi: 3, gp: 3, label: 'fall back to party 6 split 3+3' },
        { hi: 2, gp: 3, label: 'sub-6 total — no plan' },
        { hi: 0, gp: 0, label: 'nothing' },
    ]
    for (const c of cases) {
        const plan = decide({ hi: c.hi, gp: c.gp })
        const desc = plan
            ? `${plan.kind} party=${plan.partySize} ${plan.shots.map(s => `[acct${s.accountIndex}=${s.party}@${s.name.split('->')[0].trim()}]`).join(' + ')}`
            : 'WAIT'
        console.log(`hi=${c.hi}, gp=${c.gp}  (${c.label})  →  ${desc}`)
    }
}
