// Operator-facing window string for the dashboard + Discord startup ping.
// When leadDays > 0, the effective floor (today + leadDays) slides forward
// each PT day, so callers should recompute this on every cycle if they want
// the dashboard to reflect today's floor.
export function windowDisplay(rangeStartDate, rangeEndDate, leadDays, effectiveStartDate) {
    const base = `${rangeStartDate} → ${rangeEndDate}`
    if (!leadDays || effectiveStartDate === rangeStartDate) return base
    return `${base} (effective from ${effectiveStartDate}, leadDays=${leadDays})`
}
