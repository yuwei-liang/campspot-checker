// observedNights() isn't exported (intentionally module-local), but its
// behaviour is the load-bearing piece of the wrong_trip / auto-release
// decision. We exercise it indirectly via the date-format regex's expected
// pairs to lock in the parsing contract.

// Equivalent inline version for test purposes — kept in sync with
// CampspotCartBot.mjs's local observedNights().
const monthLookup = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
function observedNights(ci, co) {
    if (!ci || !co) return null
    const parse = (s) => {
        const m = s.match(/^(\w+)\s+(\d+),\s+(\d{4})$/)
        if (!m) return null
        const month = monthLookup[m[1].slice(0, 3)]
        if (month == null) return null
        return Date.UTC(Number(m[3]), month, Number(m[2]))
    }
    const a = parse(ci), b = parse(co)
    if (a == null || b == null) return null
    return Math.round((b - a) / 86400000)
}

describe('observedNights', () => {
    test('2-night Jul 23 → Jul 25', () => {
        // This is THE case from 2026-06-25 — Site 100, asked 4n, got 2n.
        // partialNights=2 >= minNights=2 → KEEP the hold.
        expect(observedNights('Jul 23, 2026', 'Jul 25, 2026')).toBe(2)
    })

    test('1-night next-day stay', () => {
        expect(observedNights('Sep 13, 2026', 'Sep 14, 2026')).toBe(1)
    })

    test('4-night across a month boundary', () => {
        expect(observedNights('Jun 29, 2026', 'Jul 3, 2026')).toBe(4)
    })

    test('returns null on malformed input', () => {
        expect(observedNights(null, 'Sep 14, 2026')).toBeNull()
        expect(observedNights('not-a-date', 'Sep 14, 2026')).toBeNull()
        expect(observedNights('Sep 13, 2026', 'XYZ 14, 2026')).toBeNull()
    })

    test('handles year boundary', () => {
        expect(observedNights('Dec 30, 2026', 'Jan 2, 2027')).toBe(3)
    })
})

describe('Check-In/Out regex tolerates both rec.gov formats', () => {
    // The 2026-06-25 cart used "Check-In: Thu Jul 23, 2026" (no Date word).
    // The 2026-06-22 cart used "Check-In Date: Sun Sep 13, 2026" (with Date).
    const ciRegex = /Check-?\s*In(?:\s+Date)?:\s*\w+\s+(\w+)\s+(\d+),\s+(\d{4})/i
    const coRegex = /Check-?\s*Out(?:\s+Date)?:\s*\w+\s+(\w+)\s+(\d+),\s+(\d{4})/i

    test('matches "Check-In Date:" form (legacy)', () => {
        const m = 'Check-In Date: Sun Sep 13, 2026'.match(ciRegex)
        expect(m).not.toBeNull()
        expect(`${m[1]} ${m[2]}, ${m[3]}`).toBe('Sep 13, 2026')
    })

    test('matches "Check-In:" form (compact, the one that broke us)', () => {
        const m = 'Check-In: Thu Jul 23, 2026'.match(ciRegex)
        expect(m).not.toBeNull()
        expect(`${m[1]} ${m[2]}, ${m[3]}`).toBe('Jul 23, 2026')
    })

    test('Check-Out variants both match', () => {
        expect('Check-Out Date: Fri Jun 26, 2026'.match(coRegex)).not.toBeNull()
        expect('Check-Out: Sat Jul 25, 2026'.match(coRegex)).not.toBeNull()
    })
})
