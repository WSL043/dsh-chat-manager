import { createDeleteRequestHandler, deleteColdSession } from './host/delete-session.mjs'

export const name = 'dsh-session-delete'
export const inject = ['webServer', 'sessionPersistence', 'sessions', 'agents']

export function apply(ctx) {
  const sessionRoot = ctx.sessionPersistence?.root
  if (typeof sessionRoot !== 'string' || sessionRoot.length === 0) {
    throw new Error('dsh-session-delete requires the per-session JSONL persistence backend')
  }

  const handler = createDeleteRequestHandler({
    deleteSession: sessionId => deleteColdSession({
      sessions: ctx.sessions,
      agents: ctx.agents,
      sessionPersistence: ctx.sessionPersistence,
    }, { sessionRoot, sessionId }),
  })

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-delete/delete',
      handler,
    }),
    'dsh-session-delete: confirmed permanent deletion route',
  )
}

export { createDeleteRequestHandler, deleteColdSession } from './host/delete-session.mjs'
