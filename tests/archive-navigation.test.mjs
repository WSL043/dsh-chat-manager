import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreArchivedSession } from '../src/host/archive-manager.mjs'

test('archive reconciliation requires the official public unarchive operation', async () => {
  let called = false
  const registry = { archivedSessionIds: ['fixture'], unarchiveSession: async id => { assert.equal(id, 'fixture'); called = true; registry.archivedSessionIds = [] } }
  assert.deepEqual(await restoreArchivedSession(registry, 'fixture'), { restored: true, archivedSessionIds: [] })
  assert.equal(called, true)
  await assert.rejects(restoreArchivedSession({ archivedSessionIds: ['fixture'] }, 'fixture'), /public workspace unarchive API/)
})
