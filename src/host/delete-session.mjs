import { lstat, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const failure = (code, message) => ({ ok: false, error: { code, message } })
const MAX_REQUEST_BYTES = 8 * 1024

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
  && left?.isSeeded === right?.isSeeded
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
  && left.size === right.size
  && left.birthtimeNs === right.birthtimeNs
)

// Opening the official write lease may add a lock file to this directory.
// Directory identity excludes entry-count/size; transcript identity includes size.
const sameDirectory = (left, right) => (
  left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
  && left.birthtimeNs === right.birthtimeNs
)

const locationPaths = (sessionRoot, location) => {
  if (location?.kind !== 'jsonl' || typeof location.path !== 'string') return undefined
  const root = resolve(sessionRoot)
  const transcript = resolve(location.path)
  if (!isAbsolute(root) || !isAbsolute(transcript) || !inside(root, transcript)) return undefined
  const parts = relative(root, transcript).split(sep).filter(Boolean)
  if (parts.length !== 3 || !/^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(parts[2])) return undefined
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

// Reservations protect only concurrent requests made by this plugin. Official
// single-writer persistence ownership excludes host resume/create operations.
const pendingByBackend = new WeakMap()

/** Permanently delete only an unloaded, archived, current-format JSONL session. */
export async function deleteSessionSafely(deps, { sessionRoot, sessionId }) {
  const persistence = deps.sessionPersistence
  if (persistence?.name !== 'session-persistence-jsonl'
    || typeof persistence.open !== 'function' || typeof persistence.stat !== 'function'
    || typeof persistence.resolveCurrentLog !== 'function') {
    return failure('unsupported-backend', '当前存储不支持经过验证的 JSONL 独占写入句柄。')
  }
  let pending = pendingByBackend.get(persistence)
  if (!pending) pendingByBackend.set(persistence, pending = new Set())
  if (pending.has(sessionId)) return failure('deletion-in-progress', '该会话正在删除中，请等待当前操作完成。')
  pending.add(sessionId)
  let handle
  try {
    return await deleteReservedSession(deps, { sessionRoot, sessionId }, acquired => { handle = acquired })
  } finally {
    try { await handle?.close() }
    finally { pending.delete(sessionId) }
  }
}

async function deleteReservedSession(deps, { sessionRoot, sessionId }, ownHandle) {
  const persistence = deps.sessionPersistence
  const archived = () => Array.isArray(deps.workspaceRegistry?.archivedSessionIds)
    && deps.workspaceRegistry.archivedSessionIds.includes(sessionId)
  const live = () => deps.sessions.get(sessionId) !== undefined || deps.agents.get(sessionId) !== undefined
  if (!archived()) return failure('session-not-archived', '请先使用 DSH 的归档操作归档该会话。')
  if (live()) return failure('session-active', '该会话仍被宿主加载，未删除任何内容。停止或归档不一定会释放宿主所有权。')
  const before = await persistence.stat(sessionId)
  if (before === undefined) {
    // A stale archive marker is cleaned only after independent physical absence
    // checks. A corrupt or inaccessible directory must never count as absence.
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return failure('session-not-found', '无法验证会话是否已经不存在。')
    const projects = await readdir(sessionRoot, { withFileTypes: true })
    for (const project of projects) {
      if (project.isSymbolicLink()) return failure('storage-state-unknown', '无法确认会话存储状态。')
      if (!project.isDirectory()) continue
      const entries = await readdir(join(sessionRoot, project.name))
      if (entries.some(name => name === sessionId || name.startsWith(sessionId + '.'))) {
        return failure('storage-state-unknown', '会话目录仍然存在，未清理其归档标记。')
      }
    }
    if (await persistence.stat(sessionId) === undefined && !live() && archived()) {
      return { ok: true, value: { deleted: false, alreadyAbsent: true } }
    }
    return failure('storage-state-unknown', '无法确认会话存储状态。')
  }
  // open(write) may publish a migration. Refuse historical/unknown formats
  // before opening, and require the backend's current-generation raw location.
  if (before.formatStatus !== 'current') return failure('unsupported-format', '只支持当前格式的会话；不会为了删除而迁移会话。')
  const header = before.header
  if (header?.id !== sessionId) return failure('unsafe-location', '会话存储身份未通过校验。')
  const transcript = await persistence.resolveCurrentLog(sessionId)
  const paths = locationPaths(sessionRoot, { kind: 'jsonl', path: transcript })
  if (paths === undefined || (before.location !== undefined
    && (before.location.kind !== 'jsonl' || typeof before.location.path !== 'string' || resolve(before.location.path) !== paths.transcript))) {
    return failure('unsafe-location', '无法验证该会话的独立 JSONL 存储位置。')
  }
  let validated
  try { validated = await validateExistingLocation(paths) }
  catch (error) { return failure(missing(error) ? 'session-not-found' : 'storage-error', '读取会话存储失败，未删除任何文件。') }
  if (validated === undefined) return failure('unsafe-location', '会话存储位置未通过安全校验。')
  let handle
  try {
    handle = await persistence.open(sessionId, 'write')
    ownHandle(handle)
  } catch {
    return failure('storage-state-unknown', '无法取得该会话的独占写入权限，未删除任何内容。')
  }
  const after = await persistence.stat(sessionId)
  const currentPath = await persistence.resolveCurrentLog(sessionId)
  if (after?.formatStatus !== 'current' || !sameHeader(header, after.header)
    || !sameHeader(header, handle.header) || currentPath !== transcript
    || (before.revision !== undefined && !Object.is(before.revision, after.revision))) {
    return failure('unsafe-location', '会话在取得写入权限期间发生变化，未删除任何文件。')
  }
  let revalidated
  try { revalidated = await validateExistingLocation(paths) }
  catch { return failure('unsafe-location', '会话存储在校验期间发生变化。') }
  if (revalidated === undefined || !sameDirectory(validated.directory, revalidated.directory)
    || !sameFile(validated.transcript, revalidated.transcript)) {
    return failure('unsafe-location', '会话存储身份发生变化，未删除任何文件。')
  }
  if (live()) return failure('session-reopened', '该会话在删除过程中被重新加载，已取消删除。')
  if (!archived()) return failure('session-not-archived', '该会话已取消归档，已取消删除。')

  let quarantineRoot
  let quarantinedDirectory
  let detached = false
  try {
    const moveDirectory = deps.moveDirectory ?? rename
    quarantineRoot = await mkdtemp(join(dirname(validated.root), '.dsh-session-delete-'))
    quarantinedDirectory = join(quarantineRoot, basename(validated.resolvedDirectory))
    if (live() || !archived()) {
      await rm(quarantineRoot, { recursive: true, force: true })
      return failure('session-reopened', '该会话已重新加载或取消归档，已取消删除。')
    }
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
      || !sameDirectory(validated.directory, directoryAfter)
      || !sameFile(validated.transcript, transcriptAfter)
    ) {
      if (await pathExists(validated.resolvedDirectory)) {
        return failure('storage-partial', '原路径已被重新占用，隔离区已保留，无法确认删除成功。')
      }
      await moveDirectory(quarantinedDirectory, validated.resolvedDirectory)
      detached = false
      await rm(quarantineRoot, { recursive: true, force: true })
      return failure('unsafe-location', '会话目录在删除期间发生了身份变化，未删除任何文件。')
    }

    if (live() || !archived()) {
      if (await pathExists(validated.resolvedDirectory)) {
        return failure('storage-partial', '会话已重新加载且原路径被占用，隔离区已保留。')
      }
      await moveDirectory(quarantinedDirectory, validated.resolvedDirectory)
      detached = false
      await rm(quarantineRoot, { recursive: true, force: true })
      return failure('session-reopened', '该会话已重新加载或取消归档，已恢复原目录。')
    }
    const removeDirectory = deps.removeDirectory
      ?? (directory => rm(directory, { recursive: true, force: false }))
    await removeDirectory(quarantinedDirectory)
    if (await pathExists(quarantinedDirectory)) {
      return failure('storage-partial', '会话目录已移入隔离区，但存储清理未完成，不能确认永久删除成功。')
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
        return failure('storage-partial', '会话目录已移入隔离区，但存储清理未完成，不能确认永久删除成功。')
      }
      if (quarantineRoot !== undefined) await rm(quarantineRoot, { recursive: true, force: true }).catch(() => undefined)
      return { ok: true, value: { deleted: true } }
    }
    if (quarantineRoot !== undefined) await rm(quarantineRoot, { recursive: true, force: true }).catch(() => undefined)
    if (missing(error)) return failure('session-not-found', '会话不存在或已经删除。')
    return failure('storage-error', '存储删除失败，未删除任何文件。')
  }
}

/**
 * HTTP boundary for the destructive operation. The native client must make a
 * same-origin JSON POST and include a confirmation-only header that ordinary
 * links and HTML forms cannot add.
 */
export function sameOriginRequest(req) {
  const host = req.headers.host
  return typeof host === 'string' && req.headers.origin === `http://${host}`
}

/**
 * Require the Host's own request fence (authority, cross-site, and Host session cookie checks).
 * The official desktop app forwards dsh-app:// requests to the Host without an Origin header, so a
 * plain same-origin check cannot replace admission. Until the fixed Alpha2 service is ready, refuse.
 * Return true only for admission; preserve the Host's 401/403 rejection status for the HTTP boundary.
 */
export function hostRequestFence(connection) {
  if (typeof connection?.requestRejection !== 'function') return () => false
  return req => {
    const rejection = connection.requestRejection(req)
    return rejection === undefined ? true : rejection
  }
}

export function createDeleteRequestHandler({ deleteSession, isTrustedRequest = () => false }) {
  return async (req, res) => {
    const contentType = req.headers['content-type']
    const confirmation = req.headers['x-dsh-session-delete-confirmation']

    if (req.method !== 'POST') {
      sendJson(res, 405, failure('method-not-allowed', '只允许使用 POST 删除会话。'))
      return
    }
    const admission = isTrustedRequest(req)
    if (admission !== true || confirmation !== 'delete-session') {
      sendJson(res, admission === 401 ? 401 : 403, failure('forbidden', '删除请求未通过宿主认证与确认校验。'))
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
    if (
      typeof body?.sessionId !== 'string'
      || body.sessionId.length === 0
      || body.sessionId.length > 512
      || body.sessionId.includes('\0')
    ) {
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
