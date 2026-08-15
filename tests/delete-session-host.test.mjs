import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  createDeleteRequestHandler,
  deleteColdSession,
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
}) {
  return {
    sessions: { get: sessionGet ?? (() => live ? { id: HEADER.id } : undefined) },
    agents: { get: () => agentLive ? { id: HEADER.id } : undefined },
    sessionPersistence: {
      supportsRawArtifacts,
      list: async () => listed,
      locate: () => ({ kind: 'jsonl', path: transcript }),
      readRaw: async () => ({ meta: rawMeta, filename: 'session.jsonl', content: 'fixture' }),
    },
  }
}

test('deletes only the exact cold JSONL session directory', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteColdSession(
    dependencies({ transcript: paths.transcript }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.deepEqual(result, { ok: true, value: { deleted: true } })
  await assert.rejects(readFile(paths.transcript), { code: 'ENOENT' })
})

test('refuses a session that is still live in memory', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteColdSession(
    dependencies({ transcript: paths.transcript, live: true }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'session-active')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses a session owned by a live agent', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteColdSession(
    dependencies({ transcript: paths.transcript, agentLive: true }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'session-active')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses unsupported storage and a missing session', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const unsupported = await deleteColdSession(
    dependencies({ transcript: paths.transcript, supportsRawArtifacts: false }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )
  assert.equal(unsupported.error.code, 'unsupported-backend')

  const missing = await deleteColdSession(
    dependencies({ transcript: paths.transcript, listed: [] }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )
  assert.equal(missing.error.code, 'session-not-found')
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
})

test('refuses a transcript whose persisted header does not match the listing', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteColdSession(
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

  const result = await deleteColdSession(
    dependencies({ transcript: outsideTranscript }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unsafe-location')
  assert.equal(await readFile(outsideTranscript, 'utf8'), 'outside\n')
})

test('refuses an unexpected transcript filename inside the session directory', async (t) => {
  const paths = await fixture()
  const unexpected = join(paths.sessionDirectory, 'notes.jsonl')
  await writeFile(unexpected, 'keep\n', 'utf8')
  t.after(() => rm(paths.base, { recursive: true, force: true }))

  const result = await deleteColdSession(
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

  const result = await deleteColdSession(
    dependencies({
      transcript: paths.transcript,
      sessionGet: () => (++calls === 1 ? undefined : { id: HEADER.id }),
    }),
    { sessionRoot: paths.root, sessionId: HEADER.id },
  )

  assert.equal(result.error.code, 'session-active')
  assert.equal(calls, 2)
  assert.match(await readFile(paths.transcript, 'utf8'), /session-delete-test/)
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
