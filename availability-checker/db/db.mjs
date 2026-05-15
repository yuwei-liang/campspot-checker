import Database from 'better-sqlite3'
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

export const DEFAULT_DB_PATH = './data/campspot.db'

/**
 * Open (creating if needed) the SQLite database, run any pending migrations,
 * and return the better-sqlite3 connection.
 *
 * Pass `:memory:` for tests.
 */
export const openDatabase = (path = DEFAULT_DB_PATH) => {
    if (path !== ':memory:') {
        const dir = dirname(resolve(path))
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
        }
    }
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    return db
}

const ensureMigrationsTable = (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `)
}

const appliedVersions = (db) => {
    const rows = db.prepare('SELECT version FROM schema_migrations').all()
    return new Set(rows.map(r => r.version))
}

const runMigrations = (db) => {
    ensureMigrationsTable(db)
    const done = appliedVersions(db)
    const files = readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort()
    const insert = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    for (const file of files) {
        const version = basename(file, '.sql')
        if (done.has(version)) continue
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
        const tx = db.transaction(() => {
            db.exec(sql)
            insert.run(version)
        })
        tx()
    }
}
