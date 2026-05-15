export const createCyclesRepo = (db) => {
    const insertCycle = db.prepare(`INSERT INTO poll_cycles (started_at) VALUES (?)`)
    const finishCycle = db.prepare(`
        UPDATE poll_cycles
        SET finished_at = ?, duration_ms = ?, campgrounds_polled = ?
        WHERE id = ?
    `)
    const insertResult = db.prepare(`
        INSERT INTO poll_results (cycle_id, campground_id, status, available_sites_count, error, polled_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `)
    const recentCycles = db.prepare(`
        SELECT id, started_at, finished_at, duration_ms, campgrounds_polled
        FROM poll_cycles
        ORDER BY id DESC
        LIMIT ?
    `)

    return {
        start(startedAtIso) {
            const result = insertCycle.run(startedAtIso)
            return result.lastInsertRowid
        },
        finish(cycleId, finishedAtIso, durationMs, campgroundsPolled) {
            finishCycle.run(finishedAtIso, durationMs, campgroundsPolled, cycleId)
        },
        recordResult(cycleId, campgroundId, status, availableSitesCount, error, polledAtIso) {
            insertResult.run(cycleId, campgroundId, status, availableSitesCount, error, polledAtIso)
        },
        recent(limit = 20) {
            return recentCycles.all(limit).map(r => ({
                id: r.id,
                startedAt: r.started_at,
                finishedAt: r.finished_at,
                durationMs: r.duration_ms,
                campgroundsPolled: r.campgrounds_polled,
            }))
        },
    }
}
