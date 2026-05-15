const FIELDS = [
    'id', 'name', 'park',
    'valley_drive_minutes', 'elevation_ft', 'season',
    'total_sites', 'access_type',
    'enabled', 'sort_order',
]

const fromRow = (row) => row && ({
    id: row.id,
    name: row.name,
    park: row.park || '',
    valleyDriveMinutes: row.valley_drive_minutes,
    elevationFt: row.elevation_ft,
    season: row.season,
    totalSites: row.total_sites,
    accessType: row.access_type,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
})

export const createCampgroundsRepo = (db) => {
    const upsertCampground = db.prepare(`
        INSERT INTO campgrounds (
            id, name, park, valley_drive_minutes, elevation_ft, season, total_sites, access_type, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            park = excluded.park,
            valley_drive_minutes = excluded.valley_drive_minutes,
            elevation_ft = excluded.elevation_ft,
            season = excluded.season,
            total_sites = excluded.total_sites,
            access_type = excluded.access_type,
            sort_order = excluded.sort_order
    `)

    const setEnabled = db.prepare(`UPDATE campgrounds SET enabled = ? WHERE id = ?`)
    const selectAll = db.prepare(`SELECT * FROM campgrounds ORDER BY sort_order ASC, id ASC`)
    const selectById = db.prepare(`SELECT * FROM campgrounds WHERE id = ?`)
    const selectEnabledIds = db.prepare(`SELECT id FROM campgrounds WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`)
    const countRow = db.prepare(`SELECT COUNT(*) AS n FROM campgrounds`)

    return {
        count() {
            return countRow.get().n
        },
        all() {
            return selectAll.all().map(fromRow)
        },
        byId(id) {
            return fromRow(selectById.get(Number(id)))
        },
        enabledIds() {
            return selectEnabledIds.all().map(r => r.id)
        },
        setEnabled(id, enabled) {
            setEnabled.run(enabled ? 1 : 0, Number(id))
        },
        /**
         * Upsert a JSON-shaped campground record (id, name, park, valleyDriveMinutes, ...)
         * Preserves the existing `enabled` column.
         */
        upsert(cg, sortOrder = 0) {
            upsertCampground.run(
                cg.id,
                cg.name,
                cg.park || null,
                cg.valleyDriveMinutes ?? null,
                cg.elevationFt ?? null,
                cg.season ?? null,
                cg.totalSites ?? null,
                cg.accessType ?? null,
                sortOrder,
            )
        },
        /**
         * Bulk seed/upsert from a list of JSON campground entries. Preserves
         * sort order from the array. Wrapped in a transaction.
         */
        upsertMany(list) {
            const tx = db.transaction(() => {
                list.forEach((cg, idx) => this.upsert(cg, idx))
            })
            tx()
        },
    }
}
