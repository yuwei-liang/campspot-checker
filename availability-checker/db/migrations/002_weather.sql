-- Adds lat/lon to campgrounds and a weather_forecasts cache table.
ALTER TABLE campgrounds ADD COLUMN lat REAL;
ALTER TABLE campgrounds ADD COLUMN lon REAL;

CREATE TABLE IF NOT EXISTS weather_forecasts (
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    target_date TEXT NOT NULL,
    source_date TEXT NOT NULL,
    tmin_f REAL,
    tmax_f REAL,
    precip_mm REAL,
    snowfall_cm REAL,
    weather_code INTEGER,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (lat, lon, target_date)
);
