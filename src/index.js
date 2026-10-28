import {
  createDeleteRequestHandler,
  deleteSessionSafely,
  hostRequestFence,
} from './host/delete-session.mjs'
import {
  createArchiveRequestHandlers,
  deleteSessionAndReconcileArchive,
  searchArchivedSessions,
} from './host/archive-manager.mjs'

export const name = 'dsh-session-delete'
export const inject = ['webServer', 'sessionPersistence', 'sessions', 'agents', 'workspaceRegistry']

export function currentConnection(ctx) {
  return typeof ctx.get === 'function' ? ctx.get('connection') : undefined
}

export function apply(ctx) {
  const sessionRoot = ctx.sessionPersistence?.config?.root ?? ctx.sessionPersistence?.root
  if (typeof sessionRoot !== 'string' || sessionRoot.length === 0) {
    throw new Error('dsh-session-delete requires the per-session JSONL persistence backend')
  }

  const deleteSession = sessionId => deleteSessionSafely({
    sessions: ctx.sessions,
    agents: ctx.agents,
    workspaceRegistry: ctx.workspaceRegistry,
    sessionPersistence: ctx.sessionPersistence,
  }, { sessionRoot, sessionId })
  // The official fence also admits the desktop app's forwarded requests; see hostRequestFence.
  // `connection` is not injected: some hosts register it after this plugin applies, and reading an
  // uninjected property throws in Cordis 4. Resolve it per request so a late connection is honored.
  const isTrustedRequest = req => hostRequestFence(currentConnection(ctx))(req)
  const handler = createDeleteRequestHandler({
    isTrustedRequest,
    deleteSession: sessionId => deleteSessionAndReconcileArchive({
      workspaceRegistry: ctx.workspaceRegistry,
      deleteSession,
    }, sessionId),
  })
  const archiveHandlers = createArchiveRequestHandlers({
    isTrustedRequest,
    search: (query, signal) => searchArchivedSessions({
      workspaceRegistry: ctx.workspaceRegistry,
      sessionQuery: ctx.get('sessionQuery'),
    }, query, signal),
  })

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-delete/delete',
      handler,
    }),
    'dsh-session-delete: confirmed permanent deletion route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-delete/archive-search',
      handler: archiveHandlers.search,
    }),
    'dsh-session-delete: archived history search route',
  )
}

export {
  createDeleteRequestHandler,
  deleteSessionSafely,
} from './host/delete-session.mjs'

export {
  createArchiveRequestHandlers,
  deleteSessionAndReconcileArchive,
  restoreArchivedSession,
  searchArchivedSessions,
} from './host/archive-manager.mjs'
