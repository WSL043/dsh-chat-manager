import {
  createRestoreRequestHandler,
  restoreArchivedSession,
} from './host/session-recovery.mjs'

export const name = 'dsh-chat-manager'
export const inject = ['webServer', 'workspaceRegistry']

export function apply(ctx) {
  const handler = createRestoreRequestHandler({
    restore: sessionId => restoreArchivedSession(ctx.workspaceRegistry, sessionId),
  })
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-chat-manager/restore',
      handler,
    }),
    'dsh-chat-manager: archived session restore route',
  )
}

export { createRestoreRequestHandler, restoreArchivedSession }
