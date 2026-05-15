/**
 * Repository for current_availability + availability_events + notifications.
 * These three tables together implement the transition-based dedup model:
 *
 *   each cycle we know the open/closed state per (campground, site, date).
 *   we compare against `current_availability` (the previous state),
 *   log an availability_events row on each flip, and
 *   only INSERT INTO notifications on a fresh open transition.
 *
 * The notifications table doubles as the dedup ledger: a (cg, site, date)
 * row is added when we ping Discord, and removed on a 'closed' transition
 * so the next 'opened' can ping again.
 */
export const createAvailabilityRepo = (db) => {
    const getCurrent = db.prepare(`
        SELECT is_open FROM current_availability
        WHERE campground_id = ? AND campsite_id = ? AND target_date = ?
    `)
    const upsertCurrent = db.prepare(`
        INSERT INTO current_availability (campground_id, campsite_id, target_date, is_open, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(campground_id, campsite_id, target_date) DO UPDATE SET
            is_open = excluded.is_open,
            updated_at = excluded.updated_at
    `)
    const insertEvent = db.prepare(`
        INSERT INTO availability_events
        (campground_id, campsite_id, site_no, target_date, event, loop, campsite_type, max_people)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertNotificationOrIgnore = db.prepare(`
        INSERT OR IGNORE INTO notifications (campground_id, campsite_id, target_date, first_notified_at)
        VALUES (?, ?, ?, datetime('now'))
    `)
    const deleteNotification = db.prepare(`
        DELETE FROM notifications
        WHERE campground_id = ? AND campsite_id = ? AND target_date = ?
    `)
    const recentEvents = db.prepare(`
        SELECT campground_id, campsite_id, site_no, target_date, event, loop, campsite_type, max_people, seen_at
        FROM availability_events
        ORDER BY id DESC
        LIMIT ?
    `)
    const recentEventsForCampground = db.prepare(`
        SELECT campground_id, campsite_id, site_no, target_date, event, loop, campsite_type, max_people, seen_at
        FROM availability_events
        WHERE campground_id = ?
        ORDER BY id DESC
        LIMIT ?
    `)

    /**
     * Apply a batch of (site, date, isOpen) observations atomically.
     * For each observation:
     *   - if state flipped vs current_availability: log an event, update notifications ledger
     *     - opened: leave notifications for the dedup INSERT OR IGNORE to gate
     *     - closed: delete any pending notification row so the next open can re-ping
     *   - upsert current_availability
     *
     * Returns the list of (cg, site, date) tuples that JUST transitioned to OPEN
     * AND for which we should send a notification (i.e. INSERT INTO notifications
     * succeeded). Caller is responsible for actually sending the Discord message.
     */
    const applyObservations = db.transaction((observations) => {
        const newlyOpenedToNotify = []
        for (const obs of observations) {
            const { campgroundId, campsiteId, siteNo, targetDate, isOpen,
                    loop, campsiteType, maxPeople } = obs
            const prev = getCurrent.get(campgroundId, campsiteId, targetDate)
            const wasOpen = prev?.is_open === 1
            const nowOpen = !!isOpen

            if (wasOpen !== nowOpen) {
                insertEvent.run(
                    campgroundId, campsiteId, siteNo || null, targetDate,
                    nowOpen ? 'opened' : 'closed',
                    loop || null, campsiteType || null, maxPeople ?? null,
                )
                if (nowOpen) {
                    const r = insertNotificationOrIgnore.run(campgroundId, campsiteId, targetDate)
                    if (r.changes > 0) {
                        newlyOpenedToNotify.push({
                            campgroundId, campsiteId, siteNo, targetDate,
                            loop, campsiteType, maxPeople,
                        })
                    }
                } else {
                    deleteNotification.run(campgroundId, campsiteId, targetDate)
                }
            } else if (nowOpen) {
                // No transition; ensure dedup ledger is consistent. INSERT OR IGNORE.
                insertNotificationOrIgnore.run(campgroundId, campsiteId, targetDate)
            }

            upsertCurrent.run(campgroundId, campsiteId, targetDate, nowOpen ? 1 : 0)
        }
        return newlyOpenedToNotify
    })

    return {
        applyObservations,
        recentEvents(limit = 50) {
            return recentEvents.all(limit).map(toEventDto)
        },
        recentEventsForCampground(campgroundId, limit = 50) {
            return recentEventsForCampground.all(Number(campgroundId), limit).map(toEventDto)
        },
    }
}

const toEventDto = (r) => ({
    campgroundId: r.campground_id,
    campsiteId: r.campsite_id,
    siteNo: r.site_no,
    targetDate: r.target_date,
    event: r.event,
    loop: r.loop,
    campsiteType: r.campsite_type,
    maxPeople: r.max_people,
    seenAt: r.seen_at,
})
