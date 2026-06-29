import { parseCartCheckDates } from '../CampspotCartBot.mjs'

// rec.gov has rendered the cart/orderdetails check-in line three different
// ways in the wild. Cover all three so we don't regress when the layout
// changes again.

describe('parseCartCheckDates', () => {
    test('layout 1: "Check-In Date:" full label, no comma after dow (2026-06-22)', () => {
        const text = `Upper Pines\n003, STANDARD NONELECTRIC\nCheck-In Date: Thu Jun 25, 2026\nCheck-Out Date: Fri Jun 26, 2026\n`
        expect(parseCartCheckDates(text)).toEqual({
            checkIn: 'Jun 25, 2026',
            checkOut: 'Jun 26, 2026',
        })
    })

    test('layout 2: "Check-In:" compact label (2026-06-25)', () => {
        const text = `Some preamble\nCheck-In: Thu Jul 23, 2026\nCheck-Out: Sat Jul 25, 2026\n`
        expect(parseCartCheckDates(text)).toEqual({
            checkIn: 'Jul 23, 2026',
            checkOut: 'Jul 25, 2026',
        })
    })

    test('layout 3: column-header on its own line, comma after dow (2026-06-27, Wawona alienware test)', () => {
        const text = `040, B | STANDARD NONELECTRIC\nCheck-In\nMon, Aug 17, 2026\nCheck Out\nTue, Aug 18, 2026\nPrimary Occupant`
        expect(parseCartCheckDates(text)).toEqual({
            checkIn: 'Aug 17, 2026',
            checkOut: 'Aug 18, 2026',
        })
    })

    test('returns null fields when both labels absent (empty cart)', () => {
        const text = 'Your cart is empty! Looks like your cart is empty.'
        expect(parseCartCheckDates(text)).toEqual({
            checkIn: null,
            checkOut: null,
        })
    })

    test('partial: check-in present but check-out missing', () => {
        const text = 'Check-In\nMon, Aug 17, 2026\nsome other stuff but no check out'
        expect(parseCartCheckDates(text)).toEqual({
            checkIn: 'Aug 17, 2026',
            checkOut: null,
        })
    })
})
