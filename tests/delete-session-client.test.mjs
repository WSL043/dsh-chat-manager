import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  patchWorkspaceClient,
  resolveUpstreamClient,
  resolveUpstreamManifest,
} from '../scripts/build-client.mjs'

test('patches the official workspace client with a native confirmed delete flow', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.match(patched, /^\/\/ Modified from @deepseek-ai\/dsh-client-ui-workspace 0\.1\.0-rc\.6/)
  assert.match(patched, /id: "@deepseek-ai\/dsh-client-ui-workspace"/)
  assert.match(patched, /id: "delete-session"/)
  assert.match(patched, /menu\.deleteSession/)
  assert.match(patched, /delete\.session\.confirm/)
  assert.match(patched, /x-dsh-session-delete-confirmation/)
  assert.match(patched, /\/plugins\/dsh-session-delete\/delete/)
  assert.match(patched, /id: "archive"/)
  assert.doesNotMatch(patched, /id: "dsh-session-delete"/)
})

test('refuses to silently patch an unknown upstream client shape', () => {
  assert.throws(() => patchWorkspaceClient('unknown upstream'), /upstream marker/)
})

test('build dependency is pinned to the supported upstream workspace version', async () => {
  const manifest = JSON.parse(await readFile(resolveUpstreamManifest(), 'utf8'))
  assert.equal(manifest.name, '@deepseek-ai/dsh-client-ui-workspace')
  assert.equal(manifest.version, '0.1.0-rc.6')
})
