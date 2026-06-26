// Config normalizer for the multi-campground campspot-bot.
//
// Two on-disk shapes are accepted:
//   1. Legacy single-campground (everything at the top level).
//   2. New { shared: {...}, campgrounds: [{...}, ...] } shape.
//
// Both normalize to an array of fully-resolved per-campground configs so the
// rest of the bot doesn't have to care which one was on disk. Per-campground
// fields override `shared` — useful if e.g. Tuolumne should poll on a longer
// interval than Upper Pines.
import { readFileSync } from 'node:fs'

const PER_CAMPGROUND_KEYS = new Set(['campgroundId', 'campgroundName', 'park'])

export function normalizeRawConfig(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('config: expected a JSON object')
    }
    if (Array.isArray(raw.campgrounds)) {
        return normalizeMulti(raw)
    }
    if (raw.campgroundId) {
        return normalizeLegacy(raw)
    }
    throw new Error('config: missing `campgrounds[]` (or legacy `campgroundId`)')
}

function normalizeMulti({ shared = {}, campgrounds }) {
    if (campgrounds.length === 0) {
        throw new Error('config: campgrounds[] is empty')
    }
    return campgrounds.map(cg => {
        if (!cg.campgroundId) throw new Error('config: campground entry missing campgroundId')
        // Per-entry overrides win over shared, so Tuolumne can have its own
        // pollIntervalMs or rangeEndDate without forking the whole config.
        return { ...shared, ...cg }
    })
}

function normalizeLegacy(raw) {
    const shared = {}
    const cg = {}
    for (const [k, v] of Object.entries(raw)) {
        if (PER_CAMPGROUND_KEYS.has(k)) cg[k] = v
        else shared[k] = v
    }
    return [{ ...shared, ...cg }]
}

export function loadConfigsFromFile(filePath) {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return normalizeRawConfig(raw)
}

// Pick the campground to run by id. Defaults to the first entry if no id
// is provided so `node campspot-bot.mjs check` still works without args.
export function selectCampground(configs, campgroundId) {
    if (!campgroundId) return configs[0]
    const match = configs.find(c => String(c.campgroundId) === String(campgroundId))
    if (!match) {
        const known = configs.map(c => c.campgroundId).join(', ')
        throw new Error(`config: no campground with id=${campgroundId} (known: ${known})`)
    }
    return match
}
