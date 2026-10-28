import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { registerOfficialSessionActions, buildOfficialSlotClient } from '../scripts/official-session-actions.mjs'

function fixture(fetch, archived = true) {
  const entries = [], cleanups = []
  let closed = 0, refreshed = 0, requestDelete
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
  const ui = { MenuItemButton: 'MenuItem', IconTrashOutlineRegular: 'Trash', Modal: 'Modal', Button: 'Button' }
  const ctx = { locale: { getSnapshot: () => ({ active: 'zh' }) },
    get: name => { assert.equal(name, 'sessions'); return { refresh: async () => { refreshed++ } } },
    effect: fn => cleanups.push(fn()), slots: {
      inject: (_name, fn) => fn(), register: (meta, component) => { entries.push({ meta, component }); return () => {} },
    },
  }
  vm.runInNewContext('(' + registerOfficialSessionActions.toString() + ')(ctx,React,ui)', {
    ctx, React, ui, fetch, AbortController, console,
    registerArchiveSettings: (_ctx, _React, _ui, options) => { requestDelete = options.requestDelete },
  })
  const menu = () => entries[0].component({ sessionId: 'synthetic', displayTitle: 'Disposable',
    useMenuOpenState: () => [true, () => closed++], useWorkspaces: selector => selector({ archivedSessionIds: archived ? ['synthetic'] : [] }) })
  return { entries, menu, dialog: () => entries[1].component(), requestDelete: row => requestDelete(row),
    dispose: () => cleanups.forEach(fn => fn()), counts: () => ({ closed, refreshed }) }
}

test('archived-only public menu and cancellation never contact the host', () => {
  const bed = fixture(() => { throw Error('must not delete') })
  assert.deepEqual(bed.entries.map(e => e.meta.name), ['sidebar.workspaces.session.menu.item', 'shell.overlay'])
  assert.equal(fixture(() => {}, false).menu(), null)
  bed.menu().props.onSelect()
  assert.equal(bed.menu().props.danger, true)
  const dialog = bed.dialog()
  assert.equal(dialog.props.open, true)
  assert.match(dialog.props.description, /已加载或运行中的会话会被拒绝/)
  dialog.props.footer.children[0].props.onClick()
  assert.equal(bed.dialog(), null)
  assert.equal(bed.counts().closed, 1)
  bed.dispose()
})

test('explicit confirmation deletes once and refreshes the real public session list without a fictional workspace refresh', async () => {
  let calls = 0
  const bed = fixture(async (url, options) => {
    calls++; assert.equal(url, '/plugins/dsh-session-delete/delete')
    assert.equal(options.headers['x-dsh-session-delete-confirmation'], 'delete-session')
    assert.equal(JSON.parse(options.body).sessionId, 'synthetic')
    return { ok: true, json: async () => ({ ok: true, value: { archiveReconciled: true } }) }
  })
  bed.menu().props.onSelect()
  const confirm = bed.dialog().props.footer.children[1].props.onClick
  await Promise.all([confirm(), confirm()])
  assert.equal(calls, 1); assert.equal(bed.dialog(), null)
  assert.deepEqual(bed.counts(), { closed: 1, refreshed: 1 })
  bed.dispose(); await confirm(); assert.equal(calls, 1)
})

test('refused deletion remains visible; incomplete archive cleanup is not hidden', async () => {
  const refused = fixture(async () => ({ ok: false, json: async () => ({ error: { message: 'session busy' } }) }))
  refused.menu().props.onSelect(); await refused.dialog().props.footer.children[1].props.onClick()
  assert.equal(refused.dialog().children[1].children[0], 'session busy')
  assert.equal(refused.counts().refreshed, 0); refused.dispose()
  const partial = fixture(async () => ({ ok: true, json: async () => ({ ok: true, value: { archiveReconciled: false } }) }))
  partial.menu().props.onSelect(); await partial.dialog().props.footer.children[1].props.onClick()
  assert.match(partial.dialog().children[1].children[0], /归档列表未完成更新/)
  partial.dispose()
})

test('settings cleanup uses the same named confirmation and unload aborts pending requests', async () => {
  let signal, complete
  const bed = fixture((_url, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve }) })
  bed.requestDelete({ id: 'synthetic', title: 'Disposable settings target' })
  assert.equal(bed.dialog().children[0].children[0], 'Disposable settings target')
  const pending = bed.dialog().props.footer.children[1].props.onClick()
  bed.dispose(); assert.equal(signal.aborted, true)
  complete({ ok: true, json: async () => ({ ok: true }) }); await pending
  assert.equal(bed.counts().refreshed, 0)
})

test('generated client loads with only React and public primitives imports', () => {
  let entry
  vm.runInNewContext(buildOfficialSlotClient(), { window: { __ModuleLoader__: { load: value => { entry = value } } } })
  const imports = []
  const plugin = entry.factory(name => { imports.push(name); return {} })
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(imports, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
})
