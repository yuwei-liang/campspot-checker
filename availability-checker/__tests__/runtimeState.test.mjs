import { loadRuntimeState, saveRuntimeState } from '../runtimeState.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('runtimeState', () => {
    let dir, path
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'runtime-state-'))
        path = join(dir, 'state.json')
    })
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    test('loadRuntimeState returns empty state when file missing', () => {
        expect(loadRuntimeState(path)).toEqual({ disabledIds: [] })
    })

    test('saveRuntimeState round-trips disabledIds', () => {
        saveRuntimeState({ disabledIds: [232450, 232447] }, path)
        expect(loadRuntimeState(path)).toEqual({ disabledIds: [232450, 232447] })
    })

    test('loadRuntimeState ignores non-array disabledIds', () => {
        saveRuntimeState({ disabledIds: 'whatever' }, path)
        expect(loadRuntimeState(path)).toEqual({ disabledIds: [] })
    })

    test('saveRuntimeState coerces ids to Number', () => {
        saveRuntimeState({ disabledIds: ['232450', 232447] }, path)
        expect(loadRuntimeState(path).disabledIds).toEqual([232450, 232447])
    })
})
