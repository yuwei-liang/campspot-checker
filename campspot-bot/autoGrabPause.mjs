// Auto-grab pause: after a cart attempt returns items (regardless of whether
// the bot could verify site/dates), we assume the user MIGHT have booked this
// slot and pause auto-grab for a cooldown window. Prevents "bot grabs a
// second site while user is still paying for the first" — an accidental
// double-book on the user's rec.gov account.
//
// Not a lock: this is a soft safeguard. On resume (via `unpause` CLI or
// natural expiry) the bot goes right back to auto-grabbing.

const DEFAULT_HOURS = 24

// Cart states where "items are in the cart" — meaning the user *might* be
// mid-checkout. Pausing preserves their agency; unpausing is a deliberate
// act. Empty/unknown/error don't pause because there's nothing to accidentally
// double-book on top of. Auto-released wrong_trip is fine to keep grabbing
// (the bot itself released it, so cart is empty again).
const ITEMS_STATES = new Set(['held', 'has_items_but_not_target'])

export function shouldPause(cartResult) {
    if (!cartResult) return false
    if (ITEMS_STATES.has(cartResult.cartState)) return true
    // wrong_trip kept (didn't auto-release) also parks items in the cart —
    // pause. wrong_trip auto-released is empty cart again — don't pause.
    if (cartResult.cartState === 'wrong_trip' && !cartResult.autoReleased) return true
    return false
}

export function pauseFor({ now = new Date(), hours = DEFAULT_HOURS, reason }) {
    const untilMs = now.getTime() + hours * 60 * 60 * 1000
    return {
        pausedUntil: new Date(untilMs).toISOString(),
        pauseReason: reason,
    }
}

// Returns { active, expired } — call every cycle:
//   active=true  → skip auto-grab dispatch this cycle
//   expired=true → the pause window just passed, caller should clear the
//                  fields and log "auto-grab resumed"
// Both false = no pause was set. Never both true.
export function pauseStatus(pauseFields, now = new Date()) {
    const iso = pauseFields?.pausedUntil
    if (!iso) return { active: false, expired: false }
    const untilMs = new Date(iso).getTime()
    if (!Number.isFinite(untilMs)) return { active: false, expired: false } // malformed
    if (untilMs > now.getTime()) return { active: true, expired: false }
    return { active: false, expired: true }
}

// Recover pause state from the previous dashState (persisted on disk) so a
// bot restart during the cooldown window still respects it. Only carry the
// pause forward if it's still in the future; a stale expired pause is silently
// dropped.
export function inheritPauseFromPrevious(prev, now = new Date()) {
    const iso = prev?.autoGrab?.pausedUntil
    if (!iso) return { pausedUntil: null, pauseReason: null }
    const untilMs = new Date(iso).getTime()
    if (!Number.isFinite(untilMs) || untilMs <= now.getTime()) {
        return { pausedUntil: null, pauseReason: null }
    }
    return {
        pausedUntil: iso,
        pauseReason: prev.autoGrab.pauseReason || null,
    }
}

export const AUTO_GRAB_PAUSE_HOURS = DEFAULT_HOURS
