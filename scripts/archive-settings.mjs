// Embedded into the client factory. The public slot restores the official
// section automatically when this plugin is disabled.
export function registerArchiveSettings(ctx, React, ui, dangerClass, options = {}) {
  const h = React.createElement
  const text = (zh, en) => ctx.locale.getSnapshot().active === 'zh' ? zh : en
  const service = (name, direct) => {
    if (direct !== undefined) return direct
    if (typeof ctx.get !== 'function') return undefined
    try { return ctx.get(name) } catch { return undefined }
  }
  async function request(action, sessionId) {
    const response = await fetch(`/plugins/dsh-session-delete/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        ...(action === 'delete' ? { 'x-dsh-session-delete-confirmation': 'delete-session' }
          : { 'x-dsh-session-manager-action': 'restore-session' }) },
      body: JSON.stringify({ sessionId }),
    })
    const body = await response.json()
    if (!response.ok || body?.ok !== true) throw Error(body?.error?.message || `HTTP ${response.status}`)
    const sessions = service('sessions', ctx.sessions)
    const workspaces = service('workspaces', ctx.workspaces)
    const uiWorkspace = service('uiWorkspace', ctx.uiWorkspace)
    const snapshot = sessions?.list?.getSnapshot?.() || {}
    const current = snapshot.current
      ?? Object.values(snapshot.byId || {}).find(summary => summary?.id === sessionId
        && (summary.retainedBy?.mainView ?? 0) > 0)?.id
    if (action === 'delete' && current === sessionId) {
      if (typeof sessions?.clear === 'function') sessions.clear()
      else if (typeof uiWorkspace?.clearMain === 'function') uiWorkspace.clearMain()
    }
    const refreshes = await Promise.allSettled([
      typeof sessions?.refresh === 'function' ? sessions.refresh() : Promise.resolve(),
      typeof workspaces?.refresh === 'function' ? workspaces.refresh() : Promise.resolve(),
    ])
    for (const result of refreshes) if (result.status === 'rejected') console.warn('Archive action succeeded; list refresh failed:', result.reason)
  }
  function ArchiveSettings({ useSessions, useWorkspaces }) {
    const sessions = useSessions(s => s)
    const workspaces = useWorkspaces(s => s)
    const [query, setQuery] = React.useState('')
    const [target, setTarget] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [matches, setMatches] = React.useState([])
    const normalized = query.trim().toLowerCase()
    React.useEffect(() => {
      setMatches([])
      if (!normalized) return
      const abort = new AbortController()
      const timer = setTimeout(async () => {
        try {
          const response = await fetch('/plugins/dsh-session-delete/archive-search', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: normalized }), signal: abort.signal,
          })
          const body = await response.json()
          if (!response.ok || !body.ok) throw Error(body?.error?.message || `HTTP ${response.status}`)
          if (!abort.signal.aborted) setMatches(body.value.items)
        } catch (reason) { if (!abort.signal.aborted) setError(String(reason.message || reason)) }
      }, 250)
      return () => { clearTimeout(timer); abort.abort() }
    }, [normalized])
    const owners = new Map()
    for (const workspace of workspaces.items) for (const id of workspace.sessionIds) owners.set(id, workspace.title)
    const rows = [...workspaces.archivedSessionIds].reverse().map(id => ({
      id, title: sessions.byId[id]?.displayTitle || id,
      workspace: owners.get(id) || text('未分组', 'Ungrouped'),
    })).filter(row => !normalized || `${row.title} ${row.workspace}`.toLowerCase().includes(normalized)
      || matches.some(match => match.sessionId === row.id))
    async function perform(action, row) {
      if (busy) return
      setBusy(true); setError('')
      try { await request(action, row.id); setTarget(null) }
      catch (reason) { setError(String(reason.message || reason)) }
      finally { setBusy(false) }
    }
    const close = () => { if (!busy) setTarget(null) }
    return h('div', { style: { display: 'grid', gap: 16 } },
      h('input', { type: 'search', value: query, maxLength: 500,
        'aria-label': text('搜索已归档会话', 'Search archived sessions'),
        placeholder: text('搜索名称、工作区或聊天内容', 'Search names, workspaces or messages'),
        onChange: e => { setQuery(e.target.value); setError('') },
        style: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8,
          background: 'var(--dsw-alias-bg-base)', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2)' } }),
      error && h('p', { role: 'alert' }, error),
      rows.length === 0 && h('p', null, text('暂无匹配的归档会话', 'No matching archived sessions')),
      ...rows.map(row => h('div', { key: row.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' } },
        h('div', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } },
          h('div', null, row.title), h('small', { style: { opacity: .65 } }, row.workspace)),
        h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy,
          onClick: () => perform('restore', row), 'aria-label': text('取消归档 ', 'Unarchive ') + row.title }, text('取消归档', 'Unarchive')),
        h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy,
          className: dangerClass, onClick: () => { setTarget(row); setError('') }, 'aria-label': text('永久删除 ', 'Delete permanently ') + row.title }, text('永久删除', 'Delete permanently')))),
      h(ui.Modal, { open: target !== null, onClose: close, closeLabel: text('取消', 'Cancel'),
        title: text('永久删除会话？', 'Permanently delete session?'),
        description: text('删除后无法恢复。', 'This cannot be undone.'),
        footer: h('div', { style: { display: 'flex', gap: 8 } },
          h(ui.Button, { variant: 'outline', disabled: busy, onClick: close }, text('取消', 'Cancel')),
          h(ui.Button, { variant: 'outline', className: dangerClass, disabled: busy || !target, onClick: () => perform('delete', target) }, text('确认永久删除', 'Confirm permanent deletion'))) },
        h('p', null, target?.title), error && h('p', { role: 'alert' }, error)))
  }
  let registered = false
  const register = () => {
    if (registered || (!options.always && typeof window.__DSH_PORTABLE_SETTINGS__?.open !== 'function')) return
    registered = true
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'archived-sessions', priority: -10, order: 25,
      label: () => text('已归档会话', 'Archived sessions'),
    }, ArchiveSettings))
  }
  ctx.effect(() => {
    window.addEventListener('dsh-portable/settings-ready', register)
    register()
    return () => window.removeEventListener('dsh-portable/settings-ready', register)
  }, 'chat-manager: unified archive settings')
}
