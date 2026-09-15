import assert from 'node:assert/strict'
import test from 'node:test'
import { unarchiveSession } from '../scripts/build-client.mjs'

test('official settings restoration delegates to the public workspace API and propagates errors', async () => {
  const ids = []
  await unarchiveSession.call({ workspaces: { async unarchiveSession(id) { ids.push(id) } } }, 'archived-test')
  assert.deepEqual(ids, ['archived-test'])
  await assert.rejects(unarchiveSession.call({ workspaces: { async unarchiveSession() { throw new Error('offline') } } }, 'archived-test'), /offline/)
})

