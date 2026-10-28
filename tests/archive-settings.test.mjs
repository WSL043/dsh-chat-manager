import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { registerArchiveSettings } from '../scripts/archive-settings.mjs'

function fixture(fetch = () => { throw Error('unexpected HTTP request') }) {
  const registrations = [], values = [], effects = [], timers = new Map(), deleted = [], calls = []
  let cursor = 0, effectCursor = 0, timerId = 0
  const snapshot = { items: [{ title: 'Workspace', sessionIds: ['archive', 'active'] }], archivedSessionIds: ['archive'] }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const key = cursor++; if (!(key in values)) values[key] = initial; return [values[key], value => { values[key] = value }] },
    useRef: initial => { const key = cursor++; if (!(key in values)) values[key] = { current: initial }; return values[key] },
    useEffect: (fn, deps) => { const key = effectCursor++; if (JSON.stringify(effects[key]?.deps) !== JSON.stringify(deps)) { effects[key]?.cleanup?.(); effects[key] = { deps, cleanup: fn() } } },
  }
  const ctx = { locale: { getSnapshot: () => ({ active: 'en' }) },
    workspaces: { unarchiveSession: async id => {
      calls.push('unarchive:' + id)
      snapshot.archivedSessionIds = snapshot.archivedSessionIds.filter(value => value !== id)
    } },
    slots: { inject: (_name, fn) => fn(), register: (meta, component) => registrations.push({ meta, component }) },
  }
  vm.runInNewContext('(' + registerArchiveSettings.toString() + ')(ctx,React,ui,{requestDelete})', {
    ctx, React, ui: { Button: 'Button' }, requestDelete: row => deleted.push(row.id), fetch, AbortController,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id),
  })
  const render = () => { cursor = 0; effectCursor = 0; return registrations[0].component({
    useSessions: select => select({ byId: { archive: { displayTitle: 'Old notes' }, active: { displayTitle: 'Active' } } }),
    useWorkspaces: select => select(snapshot),
  }) }
  return { registrations, deleted, calls, render,
    runTimers: async () => { const work = [...timers.values()]; timers.clear(); await Promise.all(work.map(fn => fn())) },
    dispose: () => effects.forEach(effect => effect.cleanup?.()),
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...tree.children.flatMap(nodes)]
}

test('independent public settings section needs no Portable global and uses public restoration', async () => {
  const bed = fixture()
  assert.equal(bed.registrations.length, 1)
  assert.equal(bed.registrations[0].meta.name, 'settings.section')
  assert.equal(bed.registrations[0].meta.id, 'dsh-chat-manager.archive-search')
  const tree = bed.render()
  const buttons = nodes(tree).filter(node => node.type === 'Button')
  assert.equal(buttons.length, 2)
  buttons[1].props.onClick()
  assert.deepEqual(bed.deleted, ['archive'])
  await buttons[0].props.onClick()
  assert.deepEqual(bed.calls, ['unarchive:archive'])
  const restored = bed.render()
  assert.equal(nodes(restored).filter(node => node.props.role === 'alert').length, 0)
  assert.match(JSON.stringify(restored), /No matching archived sessions/)
  bed.dispose()
})

test('content search exposes snippets and truncation while cancelling superseded results', async () => {
  const requests = []
  const bed = fixture((url, options) => new Promise(resolve => requests.push({ url, options, resolve })))
  const input = () => nodes(bed.render()).find(node => node.type === 'input')
  input().props.onChange({ target: { value: 'first' } }); bed.render()
  const first = bed.runTimers()
  input().props.onChange({ target: { value: 'second' } }); bed.render()
  assert.equal(requests[0].options.signal.aborted, true)
  requests[0].resolve({ ok: true, json: async () => ({ ok: true, value: { items: [{ sessionId: 'archive', snippet: 'stale snippet' }], hasMore: false } }) })
  await first
  const second = bed.runTimers()
  assert.equal(JSON.parse(requests[1].options.body).query, 'second')
  requests[1].resolve({ ok: true, json: async () => ({ ok: true, value: { items: [{ sessionId: 'archive', snippet: '<b>plain archived hit</b>' }], hasMore: true } }) })
  await second
  const text = JSON.stringify(bed.render())
  assert.match(text, /<b>plain archived hit<\/b>/)
  assert.match(text, /first 20 content matches/)
  assert.doesNotMatch(text, /stale snippet|dangerouslySetInnerHTML/)
  bed.dispose()
  assert.equal(requests[1].options.signal.aborted, true)
})
