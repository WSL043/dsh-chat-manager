import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { patchModernWorkspaceClient, mirrorDirectoryFlow } from '../scripts/build-modern-client.mjs'

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

test('directory flow follows official providers and unload removes only forwarded registrations', () => {
  const provider = { component: () => null, options: { priority: 0 }, inject: () => ({ pick: true }) }
  let entries = [provider], listener, dispose
  const registered = new Set()
  const ctx = { slots: {
    inject(_name, effect) { const off = effect(); dispose = off; return off },
    entries() { return entries },
    subscribe(_name, fn) { listener = fn; return () => { listener = undefined } },
    register(options, component) {
      const row = { options, component }; registered.add(row)
      return () => registered.delete(row)
    },
  } }
  mirrorDirectoryFlow(ctx)
  assert.equal(registered.size, 1)
  assert.equal([...registered][0].component, provider.component)
  assert.equal([...registered][0].options.inject, provider.inject)
  entries = []; listener()
  assert.equal(registered.size, 0)
  entries = [provider]; listener()
  assert.equal(registered.size, 1)
  dispose()
  assert.equal(registered.size, 0)
  assert.equal(listener, undefined)
  assert.equal(entries[0], provider)
})
