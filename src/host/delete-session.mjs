import { lstat, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const failure = (code, message) => ({ ok: false, error: { code, message } })
const MAX_REQUEST_BYTES = 8 * 1024

/**
 * Retain the lifecycle capabilities returned by the public AgentRegistry API.
 * DSH intentionally exposes only a bare Agent from get(); deletion needs the
 * original handle so the host can cancel, drain, unregister, and detach in its
 * own supported order.
 */
export function installAgentHandleTracker(agents, sessions) {
  const handles = new Map()
  const reservations = new Set()
  const originalCreate = agents.create
  const originalResume = agents.resume
  const originalAgentEnter = agents.enter
  const originalSessionEnter = sessions?.enter

  const assertAvailable = (sessionId) => {
    if (typeof sessionId === 'string' && reservations.has(sessionId)) {
      throw new Error(`session "${sessionId}" is being permanently deleted`)
    }
  }

  const track = (handle) => {
    if (handle?.agent?.id !== undefined && typeof handle.dispose === 'function') {
      handles.set(handle.agent.id, handle)
    }
    return handle
  }
  const wrappedCreate = async function (...args) {
    assertAvailable(args[0]?.sessionId)
    return track(await Reflect.apply(originalCreate, this, args))
  }
  const wrappedResume = async function (...args) {
    assertAvailable(args[0]?.resumeSessionId)
    return track(await Reflect.apply(originalResume, this, args))
  }
  const wrappedAgentEnter = typeof originalAgentEnter === 'function'
    ? function (...args) {
        assertAvailable(args[0]?.id)
        return Reflect.apply(originalAgentEnter, this, args)
      }
    : undefined
  const wrappedSessionEnter = typeof originalSessionEnter === 'function'
    ? function (...args) {
        assertAvailable(args[0]?.id)
        return Reflect.apply(originalSessionEnter, this, args)
      }
    : undefined

  agents.create = wrappedCreate
  agents.resume = wrappedResume
  if (wrappedAgentEnter !== undefined) agents.enter = wrappedAgentEnter
  if (wrappedSessionEnter !== undefined) sessions.enter = wrappedSessionEnter
  let releaseStarted = false
  let released = false
  let resolveRelease
  let releaseTask

  const finishRelease = () => {
    if (!releaseStarted || released || reservations.size !== 0) return
    released = true
    handles.clear()
    if (agents.create === wrappedCreate) agents.create = originalCreate
    if (agents.resume === wrappedResume) agents.resume = originalResume
    if (wrappedAgentEnter !== undefined && agents.enter === wrappedAgentEnter) agents.enter = originalAgentEnter
    if (wrappedSessionEnter !== undefined && sessions.enter === wrappedSessionEnter) sessions.enter = originalSessionEnter
    resolveRelease?.()
  }

  return {
    reserve(sessionId) {
      if (releaseStarted || reservations.has(sessionId)) return undefined
      reservations.add(sessionId)
      let active = true
      return () => {
        if (!active) return
        active = false
        reservations.delete(sessionId)
        finishRelease()
      }
    },
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
      if (released) return releaseTask
      if (!releaseStarted) {
        releaseStarted = true
        releaseTask = new Promise(resolve => { resolveRelease = resolve })
        finishRelease()
      }
      return releaseTask
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
  && left?.parentSession === right?.parentSession
  && left?.seedLength === right?.seedLength
  && left?.origin === right?.origin
  && (left?.delegationDepth ?? 0) === (right?.delegationDepth ?? 0)
  && left?.agentPreset === right?.agentPreset
)

const inside = (root, target) => {
  const path = relative(root, target)
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)
}

const missing = error => error?.code === 'ENOENT'

const sameFile = (left, right) => (
  left.dev === right.dev
  && left.ino === right.ino
  && left.mode === right.mode
)

const locationPaths = (sessionRoot, location) => {
  if (location?.kind !== 'jsonl' || typeof location.path !== 'string') return undefined
  const root = resolve(sessionRoot)
  const transcript = resolve(location.path)
  if (!isAbsolute(root) || !isAbsolute(transcript) || !inside(root, transcript)) return undefined
  const parts = relative(root, transcript).split(sep).filter(Boolean)
  if (parts.length !== 3 || !['session.jsonl', 'session.jsonl.zstd'].includes(parts[2])) return undefined
  return {
    root,
    projectDirectory: join(root, parts[0]),
    sessionDirectory: join(root, parts[0], parts[1]),
    transcript,
  }
}

const validateExistingLocation = async (paths) => {
  const [root, project, directory, transcript] = await Promise.all([
    realpath(paths.root),
    lstat(paths.projectDirectory, { bigint: true }),
    lstat(paths.sessionDirectory, { bigint: true }),
    lstat(paths.transcript, { bigint: true }),
  ])
  if (
    !project.isDirectory()
    || project.isSymbolicLink()
    || !directory.isDirectory()
    || directory.isSymbolicLink()
    || !transcript.isFile()
    || transcript.isSymbolicLink()
  ) return undefined

  const [resolvedProject, resolvedDirectory, resolvedTranscript] = await Promise.all([
    realpath(paths.projectDirectory),
    realpath(paths.sessionDirectory),
    realpath(paths.transcript),
  ])
  if (
    !inside(root, resolvedProject)
    || !inside(root, resolvedDirectory)
    || dirname(resolvedTranscript) !== resolvedDirectory
  ) return undefined
  return { root, resolvedDirectory, directory, transcript }
}

const pathExists = async (path) => {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (missing(error)) return false
    throw error
  }
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

  const releaseReservation = deps.agentHandles.reserve?.(sessionId)
  if (typeof deps.agentHandles.reserve === 'function' && releaseReservation === undefined) {
    return failure('deletion-in-progress', '该会话正在删除中，请等待当前操作完成。')
  }

  try {
    return await deleteReservedSession(deps, { sessionRoot, sessionId })
  } finally {
    releaseReservation?.()
  }
}

async function deleteReservedSession(deps, { sessionRoot, sessionId }) {
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
      const missingPaths = locationPaths(sessionRoot, deps.sessionPersistence.locate(header))
      if (missingPaths !== undefined && !await pathExists(missingPaths.sessionDirectory)) {
        return { ok: true, value: { deleted: true } }
      }
      return failure('storage-state-unknown', 'DSH 已摘载会话，但无法确认其存储是否已删除。')
    }
    return failure('storage-state-unknown', '无法确认会话存储状态，未继续删除。')
  }

  const location = deps.sessionPersistence.locate(header)
  const raw = await deps.sessionPersistence.readRaw(sessionId)
  const paths = locationPaths(sessionRoot, location)
  if (paths === undefined || raw === undefined || !sameHeader(header, raw.meta)) {
    return failure('unsafe-location', '无法验证该会话的独立 JSONL 存储位置。')
  }

  let validated
  try {
    validated = await validateExistingLocation(paths)
  } catch (error) {
    if (error?.code === 'ENOENT') return failure('session-not-found', '会话不存在或已经删除。')
    return failure('storage-error', '读取会话存储失败，未删除任何文件。')
  }
  if (validated === undefined) {
    return failure('unsafe-location', '会话存储位置未通过安全校验，未删除任何文件。')
  }
  if (deps.sessions.get(sessionId) !== undefined || deps.agents.get(sessionId) !== undefined) {
    return failure('session-reopened', '该会话在删除过程中被重新打开，已取消删除。')
  }

  let quarantineRoot
  let quarantinedDirectory
  let detached = false
  try {
    const moveDirectory = deps.moveDirectory ?? rename
    quarantineRoot = await mkdtemp(join(dirname(validated.root), '.dsh-session-delete-'))
    quarantinedDirectory = join(quarantineRoot, basename(validated.resolvedDirectory))
    await moveDirectory(validated.resolvedDirectory, quarantinedDirectory)
    detached = true

    const quarantinedTranscript = join(quarantinedDirectory, basename(paths.transcript))
    const [directoryAfter, transcriptAfter] = await Promise.all([
      lstat(quarantinedDirectory, { bigint: true }),
      lstat(quarantinedTranscript, { bigint: true }),
    ])
    if (
      directoryAfter.isSymbolicLink()
      || transcriptAfter.isSymbolicLink()
      || !sameFile(validated.directory, directoryAfter)
      || !sameFile(validated.transcript, transcriptAfter)
    ) {
      await moveDirectory(quarantinedDirectory, validated.resolvedDirectory)
      detached = false
      await rm(quarantineRoot, { recursive: true, force: true })
      return failure('unsafe-location', '会话目录在删除期间发生了身份变化，未删除任何文件。')
    }

    const removeDirectory = deps.removeDirectory
      ?? (directory => rm(directory, { recursive: true, force: false }))
    await removeDirectory(quarantinedDirectory)
    if (await pathExists(quarantinedDirectory)) {
      return failure('storage-partial', '会话已从 DSH 摘载，但存储清理未完成，不能确认永久删除成功。')
    }
    await rm(quarantineRoot, { recursive: true, force: true })
    return { ok: true, value: { deleted: true } }
  } catch (error) {
    if (detached && quarantinedDirectory !== undefined) {
      let remains = true
      try {
        remains = await pathExists(quarantinedDirectory)
      } catch {
        // Inaccessible storage is not proof of cleanup; retain the quarantine.
      }
      if (remains) {
        return failure('storage-partial', '会话已从 DSH 摘载，但存储清理未完成，不能确认永久删除成功。')
      }
      if (quarantineRoot !== undefined) await rm(quarantineRoot, { recursive: true, force: true }).catch(() => undefined)
      return { ok: true, value: { deleted: true } }
    }
    if (quarantineRoot !== undefined) await rm(quarantineRoot, { recursive: true, force: true }).catch(() => undefined)
    if (missing(error)) return failure('session-not-found', '会话不存在或已经删除。')
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
