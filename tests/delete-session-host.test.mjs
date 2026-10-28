import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { createDeleteRequestHandler, deleteSessionSafely, hostRequestFence, sameOriginRequest } from '../src/host/delete-session.mjs'

const HEADER = Object.freeze({ version: 3, id: 'session-delete-test', createdAt: 1700000000000, cwd: 'fixture-workspace' })
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const root = join(base, 'sessions')
  const sessionDirectory = join(root, 'fixture-project', HEADER.id)
  const transcript = join(sessionDirectory, 'session.jsonl')
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(transcript, JSON.stringify({ type: 'session', ...HEADER }) + '\n')
  return { base, root, sessionDirectory, transcript }
}
function dependencies({ transcript, sessionGet = () => undefined, agentGet = () => undefined,
  formatStatus = 'current', rawMeta = HEADER, snapshot, open, moveDirectory, removeDirectory } = {}) {
  return {
    sessions: { get: sessionGet }, agents: { get: agentGet },
    workspaceRegistry: { archivedSessionIds: [HEADER.id] },
    ...(moveDirectory ? { moveDirectory } : {}), ...(removeDirectory ? { removeDirectory } : {}),
    sessionPersistence: {
      name: 'session-persistence-jsonl',
      stat: snapshot ?? (async () => ({ header: HEADER, formatStatus, revision: 'fixture-v1', location: { kind: 'jsonl', path: transcript } })),
      open: open ?? (async () => ({ header: rawMeta, close: async () => {} })),
      resolveCurrentLog: async () => transcript,
    },
  }
}
const args = paths => ({ sessionRoot: paths.root, sessionId: HEADER.id })
const fixtureFence = hostRequestFence({ requestRejection: req => !sameOriginRequest(req) ? 403
  : req.headers.cookie === 'fixture-auth' ? undefined : 401 })

test('deletes only the exact cold archived directory while retaining write ownership through removal', async t => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))
  const neighbor = join(paths.root, 'fixture-project', 'keep')
  await mkdir(neighbor)
  await writeFile(join(neighbor, 'session.jsonl'), 'keep')
  let owned = false, closed = 0
  const deps = dependencies({ transcript: paths.transcript,
    open: async (id, access) => { assert.equal(id, HEADER.id); assert.equal(access, 'write'); owned = true
      return { header: HEADER, close: async () => { owned = false; closed++ } } },
    removeDirectory: async directory => { assert.equal(owned, true); await rm(directory, { recursive: true }) },
  })
  assert.deepEqual(await deleteSessionSafely(deps, args(paths)), { ok: true, value: { deleted: true } })
  assert.equal(owned, false); assert.equal(closed, 1)
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
  assert.equal(await readFile(join(neighbor, 'session.jsonl'), 'utf8'), 'keep')
})

test('requires archive membership before opening a write handle', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  const deps = dependencies({ transcript: paths.transcript, open: () => { throw Error('must not open') } })
  deps.workspaceRegistry.archivedSessionIds = []
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'session-not-archived')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses loaded idle and running sessions without touching foreign owner capabilities', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  for (const status of ['idle', 'running']) {
    const deps = dependencies({ transcript: paths.transcript, agentGet: () => ({ status }),
      open: () => { throw Error('must not claim live storage') } })
    Object.defineProperty(deps.agents, 'dispose', { get() { throw Error('foreign ownership') } })
    assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'session-active')
  }
  const deps = dependencies({ transcript: paths.transcript, sessionGet: () => ({ id: HEADER.id }) })
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'session-active')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses historical and unknown format before write open can migrate anything', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  for (const formatStatus of ['migration-required', null, 'future']) {
    let opens = 0
    const deps = dependencies({ transcript: paths.transcript, formatStatus, open: () => { opens++; throw Error('must not migrate') } })
    assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'unsupported-format')
    assert.equal(opens, 0)
  }
  const deps = dependencies({ transcript: paths.transcript })
  deps.sessionPersistence.stat = async () => ({ header: HEADER })
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'unsupported-format')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('a busy writer preserves all bytes and permits a later retry after refusal', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  const deps = dependencies({ transcript: paths.transcript, open: async () => { throw Error('another writer owns this session') } })
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'storage-state-unknown')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
  deps.sessionPersistence.open = async () => ({ header: HEADER, close: async () => {} })
  assert.equal((await deleteSessionSafely(deps, args(paths))).ok, true)
})

test('duplicate deletion stays reserved until the write handle has closed', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  let entered, finish
  const closing = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { finish = resolve })
  const deps = dependencies({ transcript: paths.transcript,
    open: async () => ({ header: HEADER, close: async () => { entered(); await blocked } }) })
  const pending = deleteSessionSafely(deps, args(paths))
  await closing
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'deletion-in-progress')
  finish(); assert.equal((await pending).ok, true)
})

test('rechecks host liveness and archive membership after acquiring ownership', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  let calls = 0
  const deps = dependencies({ transcript: paths.transcript, sessionGet: () => ++calls === 1 ? undefined : {} })
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'session-reopened')
  deps.sessions.get = () => undefined
  deps.sessionPersistence.open = async () => { deps.workspaceRegistry.archivedSessionIds = []; return { header: HEADER, close: async () => {} } }
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'session-not-archived')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('header or revision changes after write acquisition refuse filesystem removal', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  const wrongHandle = dependencies({ transcript: paths.transcript, rawMeta: { ...HEADER, cwd: 'changed' } })
  assert.equal((await deleteSessionSafely(wrongHandle, args(paths))).error.code, 'unsafe-location')
  let calls = 0
  const changed = dependencies({ transcript: paths.transcript, snapshot: async () => ({ header: HEADER, formatStatus: 'current', revision: ++calls === 1 ? 'before' : 'after' }) })
  assert.equal((await deleteSessionSafely(changed, args(paths))).error.code, 'unsafe-location')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('stale archive markers require verified physical absence; corrupt directories remain', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  const deps = dependencies({ transcript: paths.transcript, snapshot: async () => undefined })
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'storage-state-unknown')
  await rm(paths.sessionDirectory, { recursive: true })
  assert.deepEqual(await deleteSessionSafely(deps, args(paths)), { ok: true, value: { deleted: false, alreadyAbsent: true } })
})

test('unsupported backends never open storage', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  const deps = dependencies({ transcript: paths.transcript }); deps.sessionPersistence.name = 'other'
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'unsupported-backend')
})

test('refuses a persistence location outside the configured session root', async (t) => {
  const paths = await fixture()
  const outsideDirectory = join(paths.base, 'outside', HEADER.id)
  const outsideTranscript = join(outsideDirectory, 'session.jsonl')
  await mkdir(outsideDirectory, { recursive: true })
  await writeFile(outsideTranscript, 'outside\n', 'utf8')
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({ transcript: outsideTranscript }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unsafe-location')
  assert.equal(await readFile(outsideTranscript, 'utf8'), 'outside\n')
})

test('refuses a same-root directory junction without deleting its target', async (t) => {
  const paths = await fixture()
  const targetDirectory = join(paths.root, '--C-workspace--', 'junction-target')
  const targetTranscript = join(targetDirectory, 'session.jsonl')
  await mkdir(targetDirectory, { recursive: true })
  await writeFile(targetTranscript, `${JSON.stringify({ type: 'session', ...HEADER })}\n`, 'utf8')
  await rm(paths.sessionDirectory, { recursive: true, force: true })
  try {
    await symlink(targetDirectory, paths.sessionDirectory, 'junction')
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('creating a Windows junction is not permitted in this environment')
      return
    }
    throw error
  }
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({ transcript: paths.transcript }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'unsafe-location')
  assert.match(await readFile(targetTranscript, 'utf8'), /session-delete-test/)
})

test('refuses an unexpected transcript filename inside the session directory', async (t) => {
  const paths = await fixture()
  const unexpected = join(paths.sessionDirectory, 'notes.jsonl')
  await writeFile(unexpected, 'keep\n', 'utf8')
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({ transcript: unexpected }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'unsafe-location')
  assert.equal(await readFile(unexpected, 'utf8'), 'keep\n')
})

test('refuses deletion when the detached transcript identity has changed', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      moveDirectory: async (source, destination) => {
        await rename(source, destination)
        await rm(join(destination, 'session.jsonl'))
        await writeFile(join(destination, 'session.jsonl'), 'replacement\n', 'utf8')
      },
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'unsafe-location')
  assert.equal(await readFile(paths.transcript, 'utf8'), 'replacement\n')
})

test('reports an incomplete cleanup honestly after the live directory was atomically detached', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      removeDirectory: async (directory) => {
        await rm(join(directory, 'session.jsonl'))
        throw new Error('simulated cleanup failure')
      },
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'storage-partial')
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
})

test('recognizes a complete deletion even if the remover throws after cleanup', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      removeDirectory: async (directory) => {
        await rm(directory, { recursive: true, force: false })
        throw new Error('late remover failure')
      },
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.deepEqual(result, { ok: true, value: { deleted: true } })
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
})

function request(body, headers = {}) {
  const stream = Readable.from([body])
  stream.method = 'POST'
  stream.headers = {
    host: '127.0.0.1:14171',
    origin: 'http://127.0.0.1:14171',
    cookie: 'fixture-auth',
    'content-type': 'application/json',
    'x-dsh-session-delete-confirmation': 'delete-session',
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

test('accepts only a same-origin explicitly confirmed POST', async () => {
  const calls = []
  const handler = createDeleteRequestHandler({
    isTrustedRequest: fixtureFence,
    deleteSession: async (sessionId) => {
      calls.push(sessionId)
      return { ok: true, value: { deleted: true } }
    },
  })
  const accepted = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id })), accepted)
  assert.equal(accepted.status, 200)
  assert.deepEqual(JSON.parse(accepted.body), { ok: true, value: { deleted: true } })
  assert.deepEqual(calls, [HEADER.id])

  const rejected = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id }), {
    origin: 'https://attacker.example',
  }), rejected)
  assert.equal(rejected.status, 403)
  assert.equal(calls.length, 1)
})

test('the official desktop app, which forwards without Origin, is admitted through the Host fence', async () => {
  const calls = []
  const seen = []
  const connection = { requestRejection: req => { seen.push(req.headers.origin); return req.headers.cookie === 'dsh-auth-x=ok' ? undefined : 401 } }
  const handler = createDeleteRequestHandler({
    isTrustedRequest: hostRequestFence(connection),
    deleteSession: async sessionId => { calls.push(sessionId); return { ok: true, value: { deleted: true } } },
  })
  const desktop = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id }), { origin: undefined, cookie: 'dsh-auth-x=ok' }), desktop)
  assert.equal(desktop.status, 200)
  const unauthenticated = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id }), { origin: undefined }), unauthenticated)
  assert.equal(unauthenticated.status, 401)
  const unconfirmed = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id }), { origin: undefined, cookie: 'dsh-auth-x=ok', 'x-dsh-session-delete-confirmation': undefined }), unconfirmed)
  assert.equal(unconfirmed.status, 403)
  assert.deepEqual(calls, [HEADER.id])
  assert.deepEqual(seen, [undefined, undefined, undefined])
})

test('missing or unsupported Host fences reject forged same-origin deletion before business work', async () => {
  for (const isTrustedRequest of [undefined, hostRequestFence(undefined), hostRequestFence({})]) {
    let calls = 0
    const handler = createDeleteRequestHandler({ isTrustedRequest, deleteSession: async () => { calls++ } })
    const res = response()
    await handler(request(JSON.stringify({ sessionId: HEADER.id })), res)
    assert.equal(res.status, 403)
    assert.equal(calls, 0)
  }
})

test('rejects a missing deletion confirmation header', async () => {
  let called = false
  const handler = createDeleteRequestHandler({
    isTrustedRequest: fixtureFence,
    deleteSession: async () => {
      called = true
      return { ok: true, value: { deleted: true } }
    },
  })
  const res = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id }), {
    'x-dsh-session-delete-confirmation': undefined,
  }), res)
  assert.equal(res.status, 403)
  assert.equal(called, false)
})

test('rejects non-POST, non-JSON, malformed, oversized, and invalid-id requests', async () => {
  let calls = 0
  const handler = createDeleteRequestHandler({
    isTrustedRequest: fixtureFence,
    deleteSession: async () => {
      calls += 1
      return { ok: true, value: { deleted: true } }
    },
  })

  const wrongMethodRequest = request('{}')
  wrongMethodRequest.method = 'GET'
  const wrongMethod = response()
  await handler(wrongMethodRequest, wrongMethod)
  assert.equal(wrongMethod.status, 405)

  const wrongType = response()
  await handler(request('{}', { 'content-type': 'text/plain' }), wrongType)
  assert.equal(wrongType.status, 415)

  const malformed = response()
  await handler(request('{'), malformed)
  assert.equal(malformed.status, 400)

  const invalidId = response()
  await handler(request(JSON.stringify({ sessionId: '' })), invalidId)
  assert.equal(invalidId.status, 400)

  const nulId = response()
  await handler(request(JSON.stringify({ sessionId: `session\0id` })), nulId)
  assert.equal(nulId.status, 400)

  const oversized = response()
  await handler(request(JSON.stringify({ sessionId: 'x'.repeat(9 * 1024) })), oversized)
  assert.equal(oversized.status, 413)
  assert.equal(calls, 0)
})

test('returns a conflict response when the storage operation is refused', async () => {
  const handler = createDeleteRequestHandler({
    isTrustedRequest: fixtureFence,
    deleteSession: async () => ({
      ok: false,
      error: { code: 'session-active', message: 'still active' },
    }),
  })
  const res = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id })), res)
  assert.equal(res.status, 409)
  assert.equal(JSON.parse(res.body).error.code, 'session-active')
})

test('does not misreport an unexpected deletion failure as invalid JSON', async () => {
  const handler = createDeleteRequestHandler({
    isTrustedRequest: fixtureFence,
    deleteSession: async () => { throw new Error('unexpected') },
  })
  const res = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id })), res)

  assert.equal(res.status, 500)
  assert.equal(JSON.parse(res.body).error.code, 'internal')
})

test('the Host fence reads a late-registered connection without touching an uninjected property', async t => {
  const { currentConnection } = await import('../src/index.js')
  // A Host can register `connection` before it is ready: get() is still empty while the uninjected property throws.
  const pending = { get: () => undefined, get connection() { throw new Error('cannot get property "connection" without inject') } }
  assert.equal(currentConnection(pending), undefined)
  assert.equal(hostRequestFence(currentConnection(pending))(request('{}')), false)

  const root = new Context()
  t.after(() => root.fiber.dispose())
  const plugin = root.extend()
  const fence = req => hostRequestFence(currentConnection(plugin))(req)
  let calls = 0
  const handler = createDeleteRequestHandler({ isTrustedRequest: fence,
    deleteSession: async () => { calls++; return { ok: true, value: { deleted: true } } },
  })
  const beforeReady = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id }), { cookie: 'ok' }), beforeReady)
  assert.equal(beforeReady.status, 403)
  assert.equal(calls, 0)
  class Connection extends Service {
    constructor(ctx) { super(ctx, 'connection') }
    requestRejection(req) { return !sameOriginRequest(req) ? 403 : req.headers.cookie === 'ok' ? undefined : 401 }
  }
  await root.plugin(Connection)
  for (const [headers, status] of [[{ cookie: undefined }, 401], [{ cookie: 'ok', origin: 'https://attacker.example' }, 403], [{ cookie: 'ok' }, 200]]) {
    const res = response()
    await handler(request(JSON.stringify({ sessionId: HEADER.id }), headers), res)
    assert.equal(res.status, status)
  }
  assert.equal(calls, 1)
})

test('reopening after quarantine rename rolls back without removing the target', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  let reopened = false
  const deps = dependencies({ transcript: paths.transcript, sessionGet: () => reopened ? {} : undefined,
    moveDirectory: async (source, destination) => { await rename(source, destination); reopened = true },
    removeDirectory: () => { throw Error('must not remove a reopened session') },
  })
  assert.equal((await deleteSessionSafely(deps, args(paths))).error.code, 'session-reopened')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('opening a writer lease may add its lock file without changing directory identity', async t => {
  const paths = await fixture(); t.after(() => rm(paths.base, { recursive: true, force: true }))
  const deps = dependencies({ transcript: paths.transcript, open: async () => {
    await writeFile(join(paths.sessionDirectory, '.writer-lock'), 'fixture lock')
    return { header: HEADER, close: async () => {} }
  } })
  assert.equal((await deleteSessionSafely(deps, args(paths))).ok, true)
})
