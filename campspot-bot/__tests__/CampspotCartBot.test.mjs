import { lastNightOf } from '../CampspotCartBot.mjs'

describe('lastNightOf', () => {
    test('4-night Thu-Sun stay → last night is Sun', () => {
        // Jun 25 (Thu) → Jun 29 (Mon checkout) = nights Thu/Fri/Sat/Sun = last night Sun Jun 28.
        expect(lastNightOf('2026-06-25', '2026-06-29')).toBe('2026-06-28')
    })

    test('2-night Fri-Sat stay', () => {
        expect(lastNightOf('2026-07-10', '2026-07-12')).toBe('2026-07-11')
    })

    test('1-night stay → last night equals first night (caller skips range click)', () => {
        // The CartBot watches for `lastNight !== startDate` before doing the
        // second click — this is the early-return signal.
        expect(lastNightOf('2026-06-22', '2026-06-23')).toBe('2026-06-22')
    })

    test('null on invalid / reversed dates', () => {
        expect(lastNightOf('2026-06-29', '2026-06-25')).toBeNull()
        expect(lastNightOf('not-a-date', '2026-06-29')).toBeNull()
    })

    test('crosses month boundary', () => {
        expect(lastNightOf('2026-06-30', '2026-07-03')).toBe('2026-07-02')
    })
})
