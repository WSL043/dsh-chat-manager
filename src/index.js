import {
  createDeleteRequestHandler,
  deleteSessionSafely,
  hostRequestFence,
  installAgentHandleTracker,
} from './host/delete-session.mjs'
import {
  createArchiveRequestHandlers,
  deleteSessionAndReconcileArchive,
  restoreArchivedSession,
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

  const agentHandles = installAgentHandleTracker(ctx.agents, ctx.sessions)
  ctx.effect(() => () => agentHandles.release(), 'dsh-session-delete: agent lifecycle tracking')

  const deleteSession = sessionId => deleteSessionSafely({
    sessions: ctx.sessions,
    agents: ctx.agents,
    agentHandles,
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
    restore: sessionId => restoreArchivedSession(ctx.workspaceRegistry, sessionId),
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
      path: '/plugins/dsh-session-delete/restore',
      handler: archiveHandlers.restore,
    }),
    'dsh-session-delete: archived session restore route',
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
  deleteColdSession,
  deleteSessionSafely,
  installAgentHandleTracker,
} from './host/delete-session.mjs'

export {
  createArchiveRequestHandlers,
  deleteSessionAndReconcileArchive,
  restoreArchivedSession,
  searchArchivedSessions,
} from './host/archive-manager.mjs'
