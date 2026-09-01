const SEARCH_LIMIT = 20
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
const MAX_REQUEST_BYTES = 8 * 1024

const assertSessionId = sessionId => {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 512 || sessionId.includes('\0')) {
    throw new TypeError('invalid archived session id')
  }
  return sessionId
}

const archiveIds = workspaceRegistry => {
  const ids = workspaceRegistry?.archivedSessionIds
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    throw new Error('unsupported workspace registry archive snapshot')
  }
  return [...ids]
}

const plainSnippet = (text, query) => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 240) return compact
  const matchAt = compact.toLowerCase().indexOf(query.toLowerCase())
  const start = Math.max(0, (matchAt === -1 ? 0 : matchAt) - 80)
  const end = Math.min(compact.length, start + 240)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

const scanArchivedEvents = async (sessionQuery, archivedSessionIds, query, signal) => {
  if (typeof sessionQuery?.filterEvents !== 'function') {
    throw new Error('archived history scan is unavailable')
  }
  const filters = [
    { kind: 'type', values: ['user/message', 'assistant/message'] },
    { kind: 'surface', values: ['current'] },
    { kind: 'text', text: query },
  ]
  const items = []
  for (let offset = 0; offset < archivedSessionIds.length && items.length <= SEARCH_LIMIT; offset += 4) {
    signal?.throwIfAborted()
    const batch = archivedSessionIds.slice(offset, offset + 4)
    const matches = await Promise.all(batch.map(sessionId => sessionQuery.filterEvents(sessionId, filters)))
    for (let index = 0; index < batch.length; index += 1) {
      const match = Array.isArray(matches[index])
        ? matches[index].find(event => typeof event?.text === 'string' && event.text.trim().length > 0)
        : undefined
      if (match !== undefined) items.push({ sessionId: batch[index], snippet: plainSnippet(match.text, query) })
      if (items.length > SEARCH_LIMIT) break
    }
  }
  return { items: items.slice(0, SEARCH_LIMIT), hasMore: items.length > SEARCH_LIMIT }
}

/**
 * Remove one id from DSH's registry-global archive set without touching the
 * session log or its workspace accounting position. DSH does not expose a
 * public unarchive method yet, so every private seam is checked before use.
 */
export async function restoreArchivedSession(workspaceRegistry, sessionId) {
  const id = assertSessionId(sessionId)
  if (
    typeof workspaceRegistry?.enqueueOperation !== 'function'
    || typeof workspaceRegistry?.requireState !== 'function'
    || typeof workspaceRegistry?.setState !== 'function'
  ) {
    throw new Error('unsupported workspace registry restore seam')
  }

  return workspaceRegistry.enqueueOperation(async () => {
    const state = workspaceRegistry.requireState()
    if (!Array.isArray(state?.archivedSessionIds)) {
      throw new Error('unsupported workspace registry restore state')
    }
    if (!state.archivedSessionIds.includes(id)) {
      return { restored: false, archivedSessionIds: [...state.archivedSessionIds] }
    }
    const archivedSessionIds = state.archivedSessionIds.filter(candidate => candidate !== id)
    await workspaceRegistry.setState({ ...state, archivedSessionIds })
    return { restored: true, archivedSessionIds }
  })
}

/** Keep DSH's archive registry free of ids whose storage was permanently removed. */
export async function deleteSessionAndReconcileArchive({ workspaceRegistry, deleteSession, warn = console.warn }, sessionId) {
  const result = await deleteSession(sessionId)
  if (result?.ok !== true) return result
  try {
    await restoreArchivedSession(workspaceRegistry, sessionId)
    return { ok: true, value: { ...result.value, archiveReconciled: true } }
  } catch (error) {
    warn('session storage was deleted but its archive marker could not be reconciled:', error)
    return { ok: true, value: { ...result.value, archiveReconciled: false } }
  }
}

/** Search current user/assistant message history inside the archive set only. */
export async function searchArchivedSessions({ workspaceRegistry, sessionQuery }, query, signal) {
  const normalized = typeof query === 'string' ? query.trim() : ''
  if (normalized.length === 0 || normalized.length > 500 || normalized.includes('\0')) {
    throw new TypeError('invalid archive search query')
  }
  if (typeof sessionQuery?.searchSessions !== 'function') {
    throw new Error('archived history search is unavailable')
  }

  const archivedSessionIds = archiveIds(workspaceRegistry)
  if (archivedSessionIds.length === 0) return { items: [], hasMore: false }

  let page
  try {
    page = await sessionQuery.searchSessions({
      query: normalized,
      sessionFilters: [{ kind: 'id', values: archivedSessionIds }],
      eventFilters: [
        { kind: 'type', values: ['user/message', 'assistant/message'] },
        { kind: 'surface', values: ['current'] },
      ],
      limit: SEARCH_LIMIT,
    }, { signal })
  } catch (error) {
    if (error?.code !== 'SESSION_QUERY_SEARCH_DISABLED') throw error
    return scanArchivedEvents(sessionQuery, archivedSessionIds, normalized, signal)
  }

  const archived = new Set(archivedSessionIds)
  const items = []
  const included = new Set()
  for (const hit of Array.isArray(page?.items) ? page.items : []) {
    const sessionId = hit?.header?.id
    const match = hit?.bestMatch
    if (
      typeof sessionId !== 'string'
      || !archived.has(sessionId)
      || included.has(sessionId)
      || match?.sessionId !== sessionId
      || match?.surface !== 'current'
      || !MESSAGE_TYPES.has(match?.type)
      || typeof match?.snippet !== 'string'
    ) continue
    included.add(sessionId)
    items.push({ sessionId, snippet: match.snippet })
    if (items.length >= SEARCH_LIMIT) break
  }

  return { items, hasMore: page?.nextCursor !== undefined }
}

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

const failure = (code, message) => ({ ok: false, error: { code, message } })

const readJsonBody = async req => {
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

const acceptJsonPost = (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, failure('method-not-allowed', '只允许使用 POST 管理归档会话。'))
    return false
  }
  const host = req.headers.host
  if (typeof host !== 'string' || req.headers.origin !== `http://${host}`) {
    sendJson(res, 403, failure('forbidden', '归档管理请求未通过同源校验。'))
    return false
  }
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, failure('unsupported-media-type', '归档管理请求必须使用 JSON。'))
    return false
  }
  return true
}

const parseBody = async (req, res) => {
  try {
    return await readJsonBody(req)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'request-too-large'
    sendJson(
      res,
      tooLarge ? 413 : 400,
      failure(tooLarge ? 'request-too-large' : 'invalid-json', tooLarge ? '归档管理请求过大。' : '归档管理请求不是有效 JSON。'),
    )
    return undefined
  }
}

/** Same-origin HTTP boundary consumed by the native archive manager UI. */
export function createArchiveRequestHandlers({ restore, search, warn = console.warn }) {
  return {
    restore: async (req, res) => {
      if (!acceptJsonPost(req, res)) return
      if (req.headers['x-dsh-session-manager-action'] !== 'restore-session') {
        sendJson(res, 403, failure('forbidden', '恢复请求缺少明确的操作标记。'))
        return
      }
      const body = await parseBody(req, res)
      if (body === undefined) return
      try {
        const sessionId = assertSessionId(body?.sessionId)
        sendJson(res, 200, { ok: true, value: await restore(sessionId) })
      } catch (error) {
        if (error instanceof TypeError) {
          sendJson(res, 400, failure('invalid-session-id', '会话 ID 无效。'))
        } else {
          sendJson(res, 500, failure('restore-failed', '取消归档失败，归档状态未确认改变。'))
        }
      }
    },
    search: async (req, res) => {
      if (!acceptJsonPost(req, res)) return
      const body = await parseBody(req, res)
      if (body === undefined) return
      const query = typeof body?.query === 'string' ? body.query.trim() : ''
      if (query.length === 0 || query.length > 500 || query.includes('\0')) {
        sendJson(res, 400, failure('invalid-query', '搜索内容无效。'))
        return
      }
      const controller = new AbortController()
      const abort = () => controller.abort(new Error('archive search request closed'))
      req.once('aborted', abort)
      if (typeof res.once === 'function') res.once('close', abort)
      try {
        const value = await search(query, controller.signal)
        sendJson(res, 200, { ok: true, value })
      } catch (error) {
        if (controller.signal.aborted) return
        warn('archived history search failed:', error)
        sendJson(res, 503, failure('search-unavailable', '归档内容搜索暂不可用。'))
      } finally {
        req.off('aborted', abort)
        if (typeof res.off === 'function') res.off('close', abort)
      }
    },
  }
}
