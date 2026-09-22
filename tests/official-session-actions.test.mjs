import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { registerOfficialSessionActions, buildOfficialSlotClient } from '../scripts/official-session-actions.mjs'

function fixture(fetch, selected = () => 'synthetic') {
  const entries = [], cleanups = []
  let closed = 0, refreshed = 0, cleared = 0
  const openedSections = []
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
  const ui = { MenuItemButton: 'MenuItem', IconTrashOutlineRegular: 'Trash', Modal: 'Modal', Button: 'Button' }
  const ctx = { locale: { getSnapshot: () => ({ active: 'zh' }) },
    get: name => name === 'uiWorkspace' ? { selection: { getSnapshot: () => ({ sessionId: selected() }) }, clearMain: () => cleared++ } : {
      list: { getSnapshot: () => ({ byId: {} }) }, refresh: async () => { refreshed++ },
    },
    effect: fn => cleanups.push(fn()), slots: {
      inject: (_name, fn) => fn(), register: (meta, component) => { entries.push({ meta, component }); return () => {} },
    },
  }
  vm.runInNewContext(`(${registerOfficialSessionActions.toString()})(ctx,React,ui)`, { ctx, React, ui, fetch, AbortController, console,
    window: { __DSH_PORTABLE_SETTINGS__: { open: section => openedSections.push(section) } } })
  const menu = () => entries[0].component({ sessionId: 'synthetic', displayTitle: 'Disposable', useMenuOpenState: () => [true, () => closed++] })
  const dialog = () => entries[1].component()
  return { entries, menu, dialog, openedSections, dispose: () => cleanups.forEach(fn => fn()), counts: () => ({ closed, refreshed, cleared }) }
}

test('official session slots add only deletion; cancellation does not contact the host', () => {
  const bed = fixture(() => { throw Error('must not delete') })
  assert.deepEqual(bed.entries.map(e => e.meta.name), ['sidebar.workspaces.session.menu.item', 'shell.overlay', 'sidebar.workspaces.header.action'])
  bed.menu().props.onSelect()
  assert.equal(bed.menu().props.danger, true)
  const dialog = bed.dialog()
  assert.equal(dialog.props.open, true)
  dialog.props.footer.children[0].props.onClick()
  assert.equal(bed.dialog(), null)
  assert.equal(bed.counts().closed, 1)
  bed.dispose()
})

test('explicit confirmation deletes once, clears only the selected session and refreshes official lists', async () => {
  let calls = 0
  const bed = fixture(async (url, options) => {
    calls++
    assert.equal(url, '/plugins/dsh-session-delete/delete')
    assert.equal(options.headers['x-dsh-session-delete-confirmation'], 'delete-session')
    assert.equal(JSON.parse(options.body).sessionId, 'synthetic')
    return { ok: true, json: async () => ({ ok: true }) }
  })
  bed.menu().props.onSelect()
  const confirm = bed.dialog().props.footer.children[1].props.onClick
  await Promise.all([confirm(), confirm()])
  assert.equal(calls, 1)
  assert.equal(bed.dialog(), null)
  assert.deepEqual(bed.counts(), { closed: 1, refreshed: 2, cleared: 1 })
  bed.dispose()
  await confirm()
  assert.equal(calls, 1)
})

test('rejected deletion stays visible and leaves the official current session untouched', async () => {
  const bed = fixture(async () => ({ ok: false, json: async () => ({ error: { message: 'session busy' } }) }))
  bed.menu().props.onSelect()
  await bed.dialog().props.footer.children[1].props.onClick()
  assert.equal(bed.dialog().children[1].props.role, 'alert')
  assert.equal(bed.dialog().children[1].children[0], 'session busy')
  assert.equal(bed.counts().cleared, 0)
  bed.dispose()
})

test('archive shortcut delegates to the single settings page and preserves host styling', () => {
  const bed = fixture(() => { throw Error('shortcut must not mutate sessions') })
  const shortcut = bed.entries[2].component({ className: 'official-header-button' })
  assert.equal(shortcut.props.className, 'official-header-button')
  shortcut.props.onClick()
  assert.deepEqual(bed.openedSections, ['archived-sessions'])
  assert.equal(bed.dialog(), null)
  bed.dispose()
})

test('switching sessions while deletion is pending preserves the new selection', async () => {
  let selected = 'synthetic', complete
  const bed = fixture(() => new Promise(resolve => { complete = resolve }), () => selected)
  bed.menu().props.onSelect()
  const pending = bed.dialog().props.footer.children[1].props.onClick()
  selected = 'other-session'
  complete({ ok: true, json: async () => ({ ok: true }) })
  await pending
  assert.equal(bed.counts().cleared, 0)
  assert.equal(bed.dialog(), null)
  bed.dispose()
})

test('candidate client loads without importing or replacing the workspace module', () => {
  let entry
  vm.runInNewContext(buildOfficialSlotClient(), { window: { __ModuleLoader__: { load: value => { entry = value } } } })
  const imports = []
  const plugin = entry.factory(name => { imports.push(name); return {} })
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(imports, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
})
