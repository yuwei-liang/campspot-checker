-- Initial schema. Applied once on first boot; tracked via schema_migrations.

CREATE TABLE IF NOT EXISTS campgrounds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    park TEXT,
    valley_drive_minutes INTEGER,
    elevation_ft INTEGER,
    season TEXT,
    total_sites INTEGER,
    access_type TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per executed cycle.
CREATE TABLE IF NOT EXISTS poll_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    campgrounds_polled INTEGER NOT NULL DEFAULT 0
);

-- One row per (cycle, campground) outcome.
CREATE TABLE IF NOT EXISTS poll_results (
    cycle_id INTEGER NOT NULL REFERENCES poll_cycles(id),
    campground_id INTEGER NOT NULL REFERENCES campgrounds(id),
    status TEXT NOT NULL,
    available_sites_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    polled_at TEXT NOT NULL,
    PRIMARY KEY (cycle_id, campground_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_results_cg ON poll_results (campground_id, polled_at DESC);

-- Current open/closed state per (campground, campsite, target_date). Used to detect transitions.
CREATE TABLE IF NOT EXISTS current_availability (
    campground_id INTEGER NOT NULL,
    campsite_id TEXT NOT NULL,
    target_date TEXT NOT NULL,
    is_open INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (campground_id, campsite_id, target_date)
);

-- Append-only event log. One row each time a (site, date) flips state.
CREATE TABLE IF NOT EXISTS availability_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campground_id INTEGER NOT NULL,
    campsite_id TEXT NOT NULL,
    site_no TEXT,
    target_date TEXT NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('opened', 'closed')),
    loop TEXT,
    campsite_type TEXT,
    max_people INTEGER,
    seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_by_cg ON availability_events (campground_id, seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_by_site ON availability_events (campground_id, campsite_id, target_date, seen_at DESC);

-- Notification ledger: one row per (campground, site, date) we've notified about.
-- INSERT OR IGNORE is the dedup. Row is cleared when we see a 'closed' event so next 'opened' can ping again.
CREATE TABLE IF NOT EXISTS notifications (
    campground_id INTEGER NOT NULL,
    campsite_id TEXT NOT NULL,
    target_date TEXT NOT NULL,
    first_notified_at TEXT NOT NULL,
    PRIMARY KEY (campground_id, campsite_id, target_date)
);
