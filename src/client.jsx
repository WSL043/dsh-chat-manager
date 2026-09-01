const React = require('react')

const copy = {
  zh: { tab: '会话恢复', title: '已归档会话', hint: '这里只补充官方界面暂时缺少的恢复入口。不会搜索内容，也不会删除会话。', empty: '没有已归档会话。', restore: '恢复', restoring: '正在恢复…', failed: '恢复失败，请稍后重试。' },
  en: { tab: 'Session Recovery', title: 'Archived sessions', hint: 'This only fills the missing restore entry. It does not search or delete session content.', empty: 'No archived sessions.', restore: 'Restore', restoring: 'Restoring…', failed: 'Restore failed. Please try again.' },
}

const languageOf = ctx => String(ctx.locale?.getLocale?.()?.active || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'

export function SessionRecoverySettingsTab({ ctx }) {
  const workspaces = React.useSyncExternalStore(ctx.workspaces.list.subscribe.bind(ctx.workspaces.list), ctx.workspaces.list.getSnapshot.bind(ctx.workspaces.list))
  const sessions = React.useSyncExternalStore(ctx.sessions.list.subscribe.bind(ctx.sessions.list), ctx.sessions.list.getSnapshot.bind(ctx.sessions.list))
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const t = copy[languageOf(ctx)]
  const archivedSessionIds = Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : []

  const restore = async sessionId => {
    setBusy(sessionId)
    setError('')
    try {
      const response = await fetch('/plugins/dsh-chat-manager/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-chat-manager-action': 'restore-session' },
        body: JSON.stringify({ sessionId }),
      })
      const body = await response.json()
      if (!response.ok || body?.ok !== true) throw new Error('restore failed')
    } catch {
      setError(t.failed)
    } finally {
      setBusy('')
    }
  }

  return React.createElement('section', { style: styles.root, 'aria-label': t.title },
    React.createElement('h2', { style: styles.heading }, t.title),
    React.createElement('p', { style: styles.hint }, t.hint),
    error && React.createElement('p', { role: 'alert', style: styles.error }, error),
    archivedSessionIds.length === 0
      ? React.createElement('p', { style: styles.empty }, t.empty)
      : React.createElement('div', { style: styles.list }, archivedSessionIds.map(sessionId => {
          const summary = sessions.byId?.[sessionId]
          const title = String(summary?.displayTitle || summary?.title || sessionId)
          return React.createElement('div', { key: sessionId, style: styles.row },
            React.createElement('div', { style: styles.text },
              React.createElement('div', { style: styles.name, title }, title),
              title === sessionId ? null : React.createElement('div', { style: styles.id }, sessionId)),
            React.createElement('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: () => restore(sessionId) }, busy === sessionId ? t.restoring : t.restore))
        })))
}

const styles = {
  root: { maxWidth: 760, padding: '8px 0 24px' }, heading: { fontSize: 18, margin: '0 0 8px' },
  hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px' },
  error: { color: 'var(--dsw-alias-status-danger)', fontSize: 13 }, empty: { color: 'var(--dsw-alias-label-secondary)', padding: '20px 0' },
  list: { display: 'grid', gap: 8 }, row: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px', borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' },
  text: { minWidth: 0, flex: 1 }, name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 },
  id: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
  button: { border: 0, borderRadius: 18, padding: '7px 14px', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-default)' },
}

export const name = 'dsh-chat-manager'
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

export function apply(ctx) {
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'session-recovery', order: 70, label: () => copy[languageOf(ctx)].tab,
  }, () => React.createElement(SessionRecoverySettingsTab, { ctx })))
}
