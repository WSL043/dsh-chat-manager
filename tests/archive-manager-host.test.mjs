import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  createArchiveRequestHandlers,
  deleteSessionAndReconcileArchive,
  restoreArchivedSession,
  searchArchivedSessions,
} from '../src/host/archive-manager.mjs'

const A = 'session-archive-a'
const B = 'session-archive-b'

function registry(ids = [A, B]) {
  let state = { initialized: true, workspaceIds: ['workspace-a'], archivedSessionIds: [...ids] }
  return {
    get archivedSessionIds() {
      return state.archivedSessionIds
    },
    enqueueOperation: operation => operation(),
    requireState: () => state,
    setState: async next => {
      state = next
    },
    snapshot: () => state,
  }
}

test('restores exactly one archived session while preserving registry order', async () => {
  const workspaceRegistry = registry()

  const result = await restoreArchivedSession(workspaceRegistry, A)

  assert.deepEqual(result, { restored: true, archivedSessionIds: [B] })
  assert.deepEqual(workspaceRegistry.snapshot(), {
    initialized: true,
    workspaceIds: ['workspace-a'],
    archivedSessionIds: [B],
  })
})

test('restoring an active session is an idempotent no-op', async () => {
  const workspaceRegistry = registry([B])

  const result = await restoreArchivedSession(workspaceRegistry, A)

  assert.deepEqual(result, { restored: false, archivedSessionIds: [B] })
  assert.deepEqual(workspaceRegistry.snapshot().archivedSessionIds, [B])
})

test('restore fails closed when the tested workspace registry seam drifts', async () => {
  await assert.rejects(
    restoreArchivedSession({ archivedSessionIds: [A] }, A),
    /unsupported workspace registry restore seam/,
  )
})

test('searches only archived current user and assistant history with a bounded result page', async () => {
  const calls = []
  const signal = AbortSignal.timeout(5_000)
  const workspaceRegistry = registry()
  const sessionQuery = {
    searchSessions: async (request, exec) => {
      calls.push({ request, exec })
      return {
        items: [
          {
            header: { id: A },
            bestMatch: {
              sessionId: A,
              type: 'assistant/message',
              surface: 'current',
              snippet: 'the archived answer',
            },
          },
          {
            header: { id: 'not-archived' },
            bestMatch: {
              sessionId: 'not-archived',
              type: 'user/message',
              surface: 'current',
              snippet: 'must not escape the archive filter',
            },
          },
        ],
        nextCursor: 'more-results',
      }
    },
  }

  const result = await searchArchivedSessions({ workspaceRegistry, sessionQuery }, '  archived  ', signal)

  assert.deepEqual(result, {
    items: [{ sessionId: A, snippet: 'the archived answer' }],
    hasMore: true,
  })
  assert.deepEqual(calls[0].request, {
    query: 'archived',
    sessionFilters: [{ kind: 'id', values: [A, B] }],
    eventFilters: [
      { kind: 'type', values: ['user/message', 'assistant/message'] },
      { kind: 'surface', values: ['current'] },
    ],
    limit: 20,
  })
  assert.equal(calls[0].exec.signal, signal)
})

test('archived search returns no results without invoking the provider when the archive is empty', async () => {
  let called = false
  const result = await searchArchivedSessions({
    workspaceRegistry: registry([]),
    sessionQuery: { searchSessions: async () => { called = true } },
  }, 'needle', new AbortController().signal)

  assert.deepEqual(result, { items: [], hasMore: false })
  assert.equal(called, false)
})

test('falls back to DSH event filtering when the optional full-text index is disabled', async () => {
  const workspaceRegistry = registry([A, B])
  const calls = []
  const sessionQuery = {
    async searchSessions() {
      const error = new Error('search disabled')
      error.code = 'SESSION_QUERY_SEARCH_DISABLED'
      throw error
    },
    async filterEvents(sessionId, filters) {
      calls.push({ sessionId, filters })
      return sessionId === A
        ? [{ sessionId: A, type: 'assistant/message', surface: 'current', text: 'A useful archived implementation detail' }]
        : []
    },
  }

  const result = await searchArchivedSessions({ workspaceRegistry, sessionQuery }, 'implementation')

  assert.deepEqual(result, {
    items: [{ sessionId: A, snippet: 'A useful archived implementation detail' }],
    hasMore: false,
  })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].filters, [
    { kind: 'type', values: ['user/message', 'assistant/message'] },
    { kind: 'surface', values: ['current'] },
    { kind: 'text', text: 'implementation' },
  ])
})

test('archived search rejects empty, oversized, and NUL-bearing queries', async () => {
  const deps = { workspaceRegistry: registry(), sessionQuery: { searchSessions: async () => ({ items: [] }) } }
  const signal = new AbortController().signal

  await assert.rejects(searchArchivedSessions(deps, '   ', signal), /invalid archive search query/)
  await assert.rejects(searchArchivedSessions(deps, 'x'.repeat(501), signal), /invalid archive search query/)
  await assert.rejects(searchArchivedSessions(deps, 'bad\0query', signal), /invalid archive search query/)
})

test('permanent deletion removes a stale archive marker only after storage deletion succeeds', async () => {
  const workspaceRegistry = registry()
  const result = await deleteSessionAndReconcileArchive({
    workspaceRegistry,
    deleteSession: async () => ({ ok: true, value: { deleted: true } }),
  }, A)

  assert.deepEqual(result, { ok: true, value: { deleted: true, archiveReconciled: true } })
  assert.deepEqual(workspaceRegistry.snapshot().archivedSessionIds, [B])

  const untouched = registry()
  const refused = await deleteSessionAndReconcileArchive({
    workspaceRegistry: untouched,
    deleteSession: async () => ({ ok: false, error: { code: 'storage-error', message: 'refused' } }),
  }, A)
  assert.deepEqual(refused, { ok: false, error: { code: 'storage-error', message: 'refused' } })
  assert.deepEqual(untouched.snapshot().archivedSessionIds, [A, B])
})

function request(body, headers = {}) {
  const stream = Readable.from([body])
  stream.method = 'POST'
  stream.headers = {
    host: '127.0.0.1:14171',
    origin: 'http://127.0.0.1:14171',
    'content-type': 'application/json',
    ...headers,
  }
  return stream
}

function response() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body += body
    },
  }
}

test('archive HTTP routes accept only same-origin JSON and require an explicit restore action', async () => {
  const calls = []
  const handlers = createArchiveRequestHandlers({
    restore: async sessionId => {
      calls.push(['restore', sessionId])
      return { restored: true, archivedSessionIds: [B] }
    },
    search: async query => {
      calls.push(['search', query])
      return { items: [{ sessionId: A, snippet: 'match' }], hasMore: false }
    },
  })

  const restored = response()
  await handlers.restore(request(JSON.stringify({ sessionId: A }), {
    'x-dsh-session-manager-action': 'restore-session',
  }), restored)
  assert.equal(restored.status, 200)

  const searched = response()
  await handlers.search(request(JSON.stringify({ query: 'needle' })), searched)
  assert.equal(searched.status, 200)
  assert.deepEqual(JSON.parse(searched.body).value.items, [{ sessionId: A, snippet: 'match' }])
  assert.deepEqual(calls, [['restore', A], ['search', 'needle']])

  const missingAction = response()
  await handlers.restore(request(JSON.stringify({ sessionId: A })), missingAction)
  assert.equal(missingAction.status, 403)

  const crossOrigin = response()
  await handlers.search(request(JSON.stringify({ query: 'needle' }), {
    origin: 'https://attacker.example',
  }), crossOrigin)
  assert.equal(crossOrigin.status, 403)
  assert.equal(calls.length, 2)
})

test('archive HTTP routes reject malformed inputs without invoking storage or search', async () => {
  let calls = 0
  const handlers = createArchiveRequestHandlers({
    restore: async () => { calls += 1 },
    search: async () => { calls += 1 },
  })

  const invalidSession = response()
  await handlers.restore(request(JSON.stringify({ sessionId: '' }), {
    'x-dsh-session-manager-action': 'restore-session',
  }), invalidSession)
  assert.equal(invalidSession.status, 400)

  const invalidQuery = response()
  await handlers.search(request(JSON.stringify({ query: '   ' })), invalidQuery)
  assert.equal(invalidQuery.status, 400)

  const malformed = response()
  await handlers.search(request('{'), malformed)
  assert.equal(malformed.status, 400)
  assert.equal(calls, 0)
})

test('archive search cancels bounded fallback work when the browser abandons the request', async () => {
  let observedSignal
  const handlers = createArchiveRequestHandlers({
    restore: async () => {},
    search: async (_query, signal) => {
      observedSignal = signal
      await new Promise((resolvePromise, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
    warn: () => {},
  })
  const req = request(JSON.stringify({ query: 'needle' }))
  const res = response()
  const pending = handlers.search(req, res)
  await new Promise(resolvePromise => setImmediate(resolvePromise))
  req.emit('aborted')
  await pending

  assert.equal(observedSignal.aborted, true)
  assert.equal(res.status, undefined)
})
