import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export const DEFAULT_STATE_FILE = './.runtime-state.json'

const empty = () => ({ disabledIds: [] })

export const loadRuntimeState = (path = DEFAULT_STATE_FILE) => {
    if (!existsSync(path)) return empty()
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8'))
        return {
            disabledIds: Array.isArray(raw.disabledIds) ? raw.disabledIds.map(Number) : [],
        }
    } catch (err) {
        return empty()
    }
}

export const saveRuntimeState = (state, path = DEFAULT_STATE_FILE) => {
    const safe = {
        disabledIds: Array.isArray(state?.disabledIds) ? state.disabledIds.map(Number) : [],
    }
    writeFileSync(path, JSON.stringify(safe, null, 2))
}
