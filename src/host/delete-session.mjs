import { lstat, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'

const failure = (code, message) => ({ ok: false, error: { code, message } })
const MAX_REQUEST_BYTES = 8 * 1024

/**
 * Retain the lifecycle capabilities returned by the public AgentRegistry API.
 * DSH intentionally exposes only a bare Agent from get(); deletion needs the
 * original handle so the host can cancel, drain, unregister, and detach in its
 * own supported order.
 */
export function installAgentHandleTracker(agents) {
  const handles = new Map()
  const originalCreate = agents.create
  const originalResume = agents.resume

  const track = (handle) => {
    if (handle?.agent?.id !== undefined && typeof handle.dispose === 'function') {
      handles.set(handle.agent.id, handle)
    }
    return handle
  }
  const wrappedCreate = async function (...args) {
    return track(await Reflect.apply(originalCreate, this, args))
  }
  const wrappedResume = async function (...args) {
    return track(await Reflect.apply(originalResume, this, args))
  }

  agents.create = wrappedCreate
  agents.resume = wrappedResume
  let released = false

  return {
    async dispose(sessionId) {
      const handle = handles.get(sessionId)
      if (handle === undefined || agents.get(sessionId) !== handle.agent) {
        handles.delete(sessionId)
        return false
      }
      await handle.dispose()
      handles.delete(sessionId)
      return true
    },
    release() {
      if (released) return
      released = true
      handles.clear()
      if (agents.create === wrappedCreate) agents.create = originalCreate
      if (agents.resume === wrappedResume) agents.resume = originalResume
    },
  }
}

const sendJson = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

const readJsonBody = async (req) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('request-too-large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const sameHeader = (left, right) => (
  left?.id === right?.id
  && left?.version === right?.version
  && left?.createdAt === right?.createdAt
  && left?.cwd === right?.cwd
)

const inside = (root, target) => {
  const path = relative(root, target)
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)
}

/**
 * Permanently remove one JSONL session directory. A live Agent is first torn
 * down through its owned host handle; persistence retirement is then awaited
 * before the same path and identity checks used for a cold session.
 */
export async function deleteSessionSafely(deps, { sessionRoot, sessionId }) {
  if (!deps.sessionPersistence.supportsRawArtifacts) {
    return failure('unsupported-backend', '当前会话存储不是可逐会话删除的 JSONL 后端。')
  }

  let header = (await deps.sessionPersistence.list()).find(item => item.id === sessionId)
    ?? deps.sessions.get(sessionId)?.header
  if (header === undefined) return failure('session-not-found', '会话不存在或已经删除。')

  if (deps.agents.get(sessionId) !== undefined) {
    let disposed
    try {
      disposed = await deps.agentHandles.dispose(sessionId)
    } catch {
      return failure('lifecycle-error', 'DSH 未能安全停止并摘载该会话，未删除任何内容。')
    }
    if (!disposed) {
      return failure('lifecycle-unavailable', '无法取得该会话的宿主生命周期句柄，未删除任何内容。请确认插件已更新并在更新后重启 DeepSeek Harness。')
    }
  }

  if (deps.sessions.get(sessionId) !== undefined || deps.agents.get(sessionId) !== undefined) {
    return failure('lifecycle-unavailable', '宿主未能完整摘载该会话，未删除任何内容。')
  }

  // inspect() waits for the persistence backend's asynchronous retirement
  // drain. A never-materialized blank session is already fully removed here.
  try {
    const inspected = await deps.sessionPersistence.inspect(sessionId)
    if (!sameHeader(header, inspected.meta)) {
      return failure('unsafe-location', '会话在摘载期间发生了身份变化，未删除任何文件。')
    }
    header = inspected.meta
  } catch (error) {
    const stillStored = (await deps.sessionPersistence.list()).some(item => item.id === sessionId)
    if (!stillStored && deps.sessions.get(sessionId) === undefined && deps.agents.get(sessionId) === undefined) {
      return { ok: true, value: { deleted: true } }
    }
    throw error
  }

  const location = deps.sessionPersistence.locate(header)
  const raw = await deps.sessionPersistence.readRaw(sessionId)
  if (location?.kind !== 'jsonl' || raw === undefined || !sameHeader(header, raw.meta)) {
    return failure('unsafe-location', '无法验证该会话的独立 JSONL 存储位置。')
  }

  try {
    const [resolvedRoot, resolvedTranscript] = await Promise.all([
      realpath(sessionRoot),
      realpath(location.path),
    ])
    const sessionDirectory = dirname(resolvedTranscript)
    const transcriptName = basename(resolvedTranscript)
    const relativeDirectory = relative(resolvedRoot, sessionDirectory)
    const depth = relativeDirectory.split(sep).filter(Boolean).length
    const [directoryInfo, transcriptInfo] = await Promise.all([
      lstat(sessionDirectory),
      lstat(location.path),
    ])

    if (
      !inside(resolvedRoot, sessionDirectory)
      || depth < 2
      || !['session.jsonl', 'session.jsonl.zstd'].includes(transcriptName)
      || !directoryInfo.isDirectory()
      || directoryInfo.isSymbolicLink()
      || !transcriptInfo.isFile()
      || transcriptInfo.isSymbolicLink()
    ) {
      return failure('unsafe-location', '会话存储位置未通过安全校验，未删除任何文件。')
    }

    if (deps.sessions.get(sessionId) !== undefined || deps.agents.get(sessionId) !== undefined) {
      return failure('session-reopened', '该会话在删除过程中被重新打开，已取消删除。')
    }

    await rm(sessionDirectory, { recursive: true, force: false })
    return { ok: true, value: { deleted: true } }
  } catch (error) {
    if (error?.code === 'ENOENT') return failure('session-not-found', '会话不存在或已经删除。')
    return failure('storage-error', '存储删除失败，未删除任何文件。')
  }
}

// Kept as an import-compatible alias for 0.1.0 consumers.
export const deleteColdSession = deleteSessionSafely

/**
 * HTTP boundary for the destructive operation. The native client must make a
 * same-origin JSON POST and include a confirmation-only header that ordinary
 * links and HTML forms cannot add.
 */
export function createDeleteRequestHandler({ deleteSession }) {
  return async (req, res) => {
    const host = req.headers.host
    const origin = req.headers.origin
    const contentType = req.headers['content-type']
    const confirmation = req.headers['x-dsh-session-delete-confirmation']

    if (req.method !== 'POST') {
      sendJson(res, 405, failure('method-not-allowed', '只允许使用 POST 删除会话。'))
      return
    }
    if (
      typeof host !== 'string'
      || origin !== `http://${host}`
      || confirmation !== 'delete-session'
    ) {
      sendJson(res, 403, failure('forbidden', '删除请求未通过同源与确认校验。'))
      return
    }
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, failure('unsupported-media-type', '删除请求必须使用 JSON。'))
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request-too-large'
      sendJson(
        res,
        tooLarge ? 413 : 400,
        failure(tooLarge ? 'request-too-large' : 'invalid-json', tooLarge ? '删除请求过大。' : '删除请求不是有效 JSON。'),
      )
      return
    }
    if (typeof body?.sessionId !== 'string' || body.sessionId.length === 0 || body.sessionId.length > 512) {
      sendJson(res, 400, failure('invalid-session-id', '会话 ID 无效。'))
      return
    }

    try {
      const result = await deleteSession(body.sessionId)
      sendJson(res, result.ok ? 200 : 409, result)
    } catch {
      sendJson(res, 500, failure('internal', '删除过程中发生未预期错误，未确认删除成功。'))
    }
  }
}
