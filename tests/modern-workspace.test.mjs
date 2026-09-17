import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { patchModernWorkspaceClient } from '../scripts/build-modern-client.mjs'

const upstream = await readFile(new URL('../node_modules/dsh-ui-workspace-alpha2-modern/lib/client.js', import.meta.url), 'utf8')
const patched = patchModernWorkspaceClient(upstream)
test('alpha2 keeps upstream selection ownership and retain/release service unchanged', () => {
  const service = source => source.slice(source.indexOf('var UiWorkspaceService ='), source.indexOf('function recentWorkspace('))
  assert.ok(service(upstream).includes('source: "mainView"'))
  assert.equal(service(patched), service(upstream))
})
test('alpha2 unknown shape is rejected instead of producing a partly patched client', () => {
  assert.throws(() => patchModernWorkspaceClient(upstream.replace('this.sessions.retain(target, { source: "mainView" })', 'this.sessions.acquire(target)')))
  assert.throws(() => patchModernWorkspaceClient(upstream.replace('function apply(ctx) {', 'function apply(context) {')))
})
test('alpha2 archive shortcut targets the unified settings section without old modal state', () => {
  assert.match(patched, /open\("archived-sessions"\)/)
  assert.doesNotMatch(patched, /setArchiveManagerOpen/)
  assert.match(patched, /always: true/)
})
