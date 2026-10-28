import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('v2 host does not intercept or dispose another owner lifecycle', async () => {
  const files = ['src/index.js', 'src/host/delete-session.mjs', 'src/host/archive-manager.mjs']
  const source = (await Promise.all(files.map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n')
  assert.doesNotMatch(source, /cordis\.original|installAgentHandleTracker|agentHandles|\.dispose\(|requireState|setState|enqueueOperation/)
})
