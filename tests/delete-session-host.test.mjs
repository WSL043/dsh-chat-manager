import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  createDeleteRequestHandler,
  deleteSessionSafely,
  installAgentHandleTracker,
} from '../src/host/delete-session.mjs'

const HEADER = Object.freeze({
  version: 0,
  id: 'session-delete-test',
  createdAt: 1_700_000_000_000,
  cwd: 'C:\\workspace',
})

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const root = join(base, 'sessions')
  const sessionDirectory = join(root, '--C-workspace--', HEADER.id)
  const transcript = join(sessionDirectory, 'session.jsonl')
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(transcript, `${JSON.stringify({ type: 'session', ...HEADER })}\n`, 'utf8')
  return { base, root, sessionDirectory, transcript }
}

function dependencies({
  transcript,
  live = false,
  agentLive = false,
  supportsRawArtifacts = true,
  listed = [HEADER],
  rawMeta = HEADER,
  sessionGet,
  agentGet,
  disposeAgent,
  inspect,
  listSessions,
  reserve,
  moveDirectory,
  removeDirectory,
}) {
  return {
    sessions: { get: sessionGet ?? (() => live ? { id: HEADER.id } : undefined) },
    agents: { get: agentGet ?? (() => agentLive ? { id: HEADER.id, status: 'idle' } : undefined) },
    agentHandles: {
      dispose: disposeAgent ?? (async () => false),
      reserve: reserve ?? (() => () => {}),
    },
    ...(moveDirectory === undefined ? {} : { moveDirectory }),
    ...(removeDirectory === undefined ? {} : { removeDirectory }),
    sessionPersistence: {
      supportsRawArtifacts,
      list: listSessions ?? (async () => listed),
      locate: () => ({ kind: 'jsonl', path: transcript }),
      readRaw: async () => ({ meta: rawMeta, filename: 'session.jsonl', content: 'fixture' }),
      inspect: inspect ?? (async () => ({ meta: rawMeta, events: [] })),
    },
  }
}

test('deletes only the exact cold JSONL session directory', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({ transcript: paths.transcript }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.deepEqual(result, { ok: true, value: { deleted: true } })
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
})

test('disposes an opened idle agent before deleting its session', async (t) => {
  const paths = await fixture()
  let liveAgent = { id: HEADER.id, status: 'idle' }
  let liveSession = { id: HEADER.id }
  let disposed = 0
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      agentLive: true,
      sessionGet: () => liveSession,
      agentGet: () => liveAgent,
      disposeAgent: async () => {
        disposed += 1
        liveAgent = undefined
        liveSession = undefined
        return true
      },
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.deepEqual(result, { ok: true, value: { deleted: true } })
  assert.equal(disposed, 1)
  assert.equal(liveAgent, undefined)
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
})

test('disposes a running agent before deleting its session', async (t) => {
  const paths = await fixture()
  let live = true
  let statusAtDispose
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const deps = dependencies({
    transcript: paths.transcript,
    sessionGet: () => live ? { id: HEADER.id } : undefined,
    agentGet: () => live ? { id: HEADER.id, status: 'running' } : undefined,
    disposeAgent: async () => {
      statusAtDispose = deps.agents.get(HEADER.id)?.status
      live = false
      return true
    },
  })
  const result = await deleteSessionSafely(
    deps,
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, true)
  assert.equal(statusAtDispose, 'running')
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
})

test('fails closed when an already-live agent has no owned lifecycle handle', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({ transcript: paths.transcript, live: true, agentLive: true }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'lifecycle-unavailable')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('reports lifecycle teardown failure without touching storage', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      live: true,
      agentLive: true,
      disposeAgent: async () => { throw new Error('teardown failed') },
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'lifecycle-error')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses unsupported storage and a missing session', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const unsupported = await deleteSessionSafely(
    dependencies({ transcript: paths.transcript, supportsRawArtifacts: false }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )
  assert.equal(unsupported.error.code, 'unsupported-backend')

  const missing = await deleteSessionSafely(
    dependencies({ transcript: paths.transcript, listed: [] }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )
  assert.equal(missing.error.code, 'session-not-found')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses a transcript whose persisted header does not match the listing', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      rawMeta: { ...HEADER, cwd: 'C:\\different' },
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'unsafe-location')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
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

test('does not report success when inspect loses the listing but the artifact remains', async (t) => {
  const paths = await fixture()
  let lists = 0
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      inspect: async () => { throw new Error('inspection failed') },
      listSessions: async () => (++lists === 1 ? [HEADER] : []),
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'storage-state-unknown')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
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

test('rechecks liveness immediately before removal', async (t) => {
  const paths = await fixture()
  let calls = 0
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteSessionSafely(
    dependencies({
      transcript: paths.transcript,
      sessionGet: () => (++calls === 1 ? undefined : { id: HEADER.id }),
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'session-reopened')
  assert.equal(calls, 2)
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('tracks handles returned by agent create and resume and restores methods on release', async () => {
  const disposed = []
  const originalCreate = async ({ sessionId }) => ({
    agent: { id: sessionId },
    dispose: async () => { disposed.push(`create:${sessionId}`) },
  })
  const originalResume = async ({ resumeSessionId }) => ({
    agent: { id: resumeSessionId },
    dispose: async () => { disposed.push(`resume:${resumeSessionId}`) },
  })
  const registry = {
    create: originalCreate,
    resume: originalResume,
    get(id) { return this.current?.id === id ? this.current : undefined },
  }
  const tracker = installAgentHandleTracker(registry)

  const created = await registry.create({ sessionId: 'created' })
  registry.current = created.agent
  assert.equal(await tracker.dispose('created'), true)

  const resumed = await registry.resume({ resumeSessionId: 'resumed' })
  registry.current = resumed.agent
  assert.equal(await tracker.dispose('resumed'), true)

  assert.deepEqual(disposed, ['create:created', 'resume:resumed'])
  tracker.release()
  assert.equal(registry.create, originalCreate)
  assert.equal(registry.resume, originalResume)
})

test('reserves a session against duplicate deletion and every session or agent re-entry path', async () => {
  const originalSessionEnter = () => () => {}
  const originalAgentEnter = () => () => {}
  const sessions = { enter: originalSessionEnter }
  const agents = {
    create: async ({ sessionId }) => ({ agent: { id: sessionId }, dispose: async () => {} }),
    resume: async ({ resumeSessionId }) => ({ agent: { id: resumeSessionId }, dispose: async () => {} }),
    enter: originalAgentEnter,
    get: () => undefined,
  }
  const tracker = installAgentHandleTracker(agents, sessions)
  const release = tracker.reserve(HEADER.id)

  assert.equal(typeof release, 'function')
  assert.equal(tracker.reserve(HEADER.id), undefined)
  assert.throws(() => sessions.enter({ id: HEADER.id }), /permanently deleted/)
  assert.throws(() => agents.enter({ id: HEADER.id }), /permanently deleted/)
  await assert.rejects(agents.create({ sessionId: HEADER.id }), /permanently deleted/)
  await assert.rejects(agents.resume({ resumeSessionId: HEADER.id }), /permanently deleted/)
  assert.doesNotThrow(() => sessions.enter({ id: 'unrelated' }))

  release()
  assert.doesNotThrow(() => sessions.enter({ id: HEADER.id }))
  tracker.release()
  assert.equal(sessions.enter, originalSessionEnter)
  assert.equal(agents.enter, originalAgentEnter)
})

test('keeps an in-flight reservation active until asynchronous tracker release can finish', async () => {
  const originalSessionEnter = () => () => {}
  const sessions = { enter: originalSessionEnter }
  const agents = {
    create: async ({ sessionId }) => ({ agent: { id: sessionId }, dispose: async () => {} }),
    resume: async ({ resumeSessionId }) => ({ agent: { id: resumeSessionId }, dispose: async () => {} }),
    get: () => undefined,
  }
  const tracker = installAgentHandleTracker(agents, sessions)
  const finishDeletion = tracker.reserve(HEADER.id)

  const released = tracker.release()
  assert.notEqual(sessions.enter, originalSessionEnter)
  assert.throws(() => sessions.enter({ id: HEADER.id }), /permanently deleted/)
  assert.equal(tracker.reserve('new-delete'), undefined)

  finishDeletion()
  await released
  assert.equal(sessions.enter, originalSessionEnter)
  assert.doesNotThrow(() => sessions.enter({ id: HEADER.id }))
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

test('rejects a missing deletion confirmation header', async () => {
  let called = false
  const handler = createDeleteRequestHandler({
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

  const oversized = response()
  await handler(request(JSON.stringify({ sessionId: 'x'.repeat(9 * 1024) })), oversized)
  assert.equal(oversized.status, 413)
  assert.equal(calls, 0)
})

test('returns a conflict response when the storage operation is refused', async () => {
  const handler = createDeleteRequestHandler({
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
    deleteSession: async () => { throw new Error('unexpected') },
  })
  const res = response()
  await handler(request(JSON.stringify({ sessionId: HEADER.id })), res)

  assert.equal(res.status, 500)
  assert.equal(JSON.parse(res.body).error.code, 'internal')
})
