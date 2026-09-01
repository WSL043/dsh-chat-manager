import assert from 'node:assert/strict'
import test from 'node:test'

import { restoreArchivedSession } from '../src/host/session-recovery.mjs'

test('restores one archived session atomically and preserves every other workspace field', async () => {
  let state = {
    initialized: true,
    workspaceIds: ['work-one'],
    archivedSessionIds: ['keep', 'restore-me'],
  }
  const workspaceRegistry = {
    enqueueOperation: task => task(),
    requireState: () => state,
    async setState(next) { state = next },
  }

  assert.deepEqual(await restoreArchivedSession(workspaceRegistry, 'restore-me'), {
    restored: true,
    archivedSessionIds: ['keep'],
  })
  assert.deepEqual(state, {
    initialized: true,
    workspaceIds: ['work-one'],
    archivedSessionIds: ['keep'],
  })
})

test('restoring an absent session is idempotent and invalid ids fail before mutation', async () => {
  let writes = 0
  const state = { initialized: true, workspaceIds: [], archivedSessionIds: ['kept'] }
  const workspaceRegistry = {
    enqueueOperation: task => task(),
    requireState: () => state,
    async setState() { writes += 1 },
  }

  assert.deepEqual(await restoreArchivedSession(workspaceRegistry, 'absent'), {
    restored: false,
    archivedSessionIds: ['kept'],
  })
  await assert.rejects(restoreArchivedSession(workspaceRegistry, '../bad\0id'), /invalid archived session id/)
  assert.equal(writes, 0)
})
