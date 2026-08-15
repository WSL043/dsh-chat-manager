import { lstat, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'

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
)

const inside = (root, target) => {
  const path = relative(root, target)
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)
}

/**
 * Permanently remove one cold JSONL session directory after proving that the
 * persistence backend selected the exact target under the configured root.
 */
export async function deleteColdSession(deps, { sessionRoot, sessionId }) {
  if (deps.sessions.get(sessionId) !== undefined || deps.agents.get(sessionId) !== undefined) {
    return failure('session-active', '该会话仍在内存中，不能安全删除。请重启 DeepSeek Harness 后、打开它之前重试。')
  }

  if (!deps.sessionPersistence.supportsRawArtifacts) {
    return failure('unsupported-backend', '当前会话存储不是可逐会话删除的 JSONL 后端。')
  }

  const header = (await deps.sessionPersistence.list()).find(item => item.id === sessionId)
  if (header === undefined) return failure('session-not-found', '会话不存在或已经删除。')

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
      return failure('session-active', '该会话刚刚被打开，已取消删除。请重启 DeepSeek Harness 后、打开它之前重试。')
    }

    await rm(sessionDirectory, { recursive: true, force: false })
    return { ok: true, value: { deleted: true } }
  } catch (error) {
    if (error?.code === 'ENOENT') return failure('session-not-found', '会话不存在或已经删除。')
    return failure('storage-error', '存储删除失败，未删除任何文件。')
  }
}

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

    try {
      const body = await readJsonBody(req)
      if (typeof body?.sessionId !== 'string' || body.sessionId.length === 0 || body.sessionId.length > 512) {
        sendJson(res, 400, failure('invalid-session-id', '会话 ID 无效。'))
        return
      }
      const result = await deleteSession(body.sessionId)
      sendJson(res, result.ok ? 200 : 409, result)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request-too-large'
      sendJson(
        res,
        tooLarge ? 413 : 400,
        failure(tooLarge ? 'request-too-large' : 'invalid-json', tooLarge ? '删除请求过大。' : '删除请求不是有效 JSON。'),
      )
    }
  }
}
