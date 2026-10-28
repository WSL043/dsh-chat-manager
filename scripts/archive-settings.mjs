// One additive public settings page. Official navigation owns normal archives.
export function registerArchiveSettings(ctx, React, ui, { requestDelete }) {
  const h = React.createElement
  const text = (zh, en) => ctx.locale.getSnapshot().active === 'zh' ? zh : en
  function ArchiveSettings({ useSessions, useWorkspaces }) {
    const sessions = useSessions(s => s)
    const workspaces = useWorkspaces(s => s)
    const [query, setQuery] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [result, setResult] = React.useState({ items: [], hasMore: false })
    const [searching, setSearching] = React.useState(false)
    const restoring = React.useRef(false)
    const mounted = React.useRef(true)
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    const normalized = query.trim()
    React.useEffect(() => {
      setResult({ items: [], hasMore: false })
      setSearching(false)
      if (!normalized) return
      const abort = new AbortController()
      const timer = setTimeout(async () => {
        setSearching(true)
        try {
          const response = await fetch('/plugins/dsh-session-delete/archive-search', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: normalized }), signal: abort.signal,
          })
          const body = await response.json()
          if (!response.ok || body?.ok !== true) throw Error(body?.error?.message || 'Content search unavailable')
          if (!abort.signal.aborted) setResult(body.value)
        } catch (reason) { if (!abort.signal.aborted) setError(String(reason.message || reason)) }
        finally { if (!abort.signal.aborted) setSearching(false) }
      }, 250)
      return () => { clearTimeout(timer); abort.abort() }
    }, [normalized])
    const owners = new Map()
    for (const workspace of workspaces.items) for (const id of workspace.sessionIds) owners.set(id, workspace.title)
    const snippets = new Map(result.items.map(item => [item.sessionId, item.snippet]))
    const rows = [...workspaces.archivedSessionIds].reverse().map(id => ({
      id, title: sessions.byId[id]?.displayTitle || id,
      workspace: owners.get(id) || text('未分组', 'Ungrouped'),
    })).filter(row => !normalized || (row.title + ' ' + row.workspace).toLowerCase().includes(normalized.toLowerCase())
      || snippets.has(row.id))
    async function restore(row) {
      if (restoring.current) return
      restoring.current = true
      setBusy(true); setError('')
      try {
        await ctx.workspaces.unarchiveSession(row.id)
      } catch (reason) { if (mounted.current) setError(String(reason.message || reason)) }
      finally { restoring.current = false; if (mounted.current) setBusy(false) }
    }
    const card = { border: '.5px solid var(--dsw-alias-settings-card-stroke)', background: 'var(--dsw-alias-settings-card-fill)', borderRadius: 'var(--dsw-radius-xl)', padding: '0 14px' }
    return h('div', { style: { display: 'grid', gap: 16 } },
      h('h2', { style: { margin: 0, fontSize: 16 } }, text('归档内容搜索与清理', 'Archive content search and cleanup')),
      h('p', { style: { margin: 0, fontSize: 14 } }, text('按归档范围搜索聊天内容。永久删除仅限已归档且未加载的本机会话；已加载或运行中的会话会被拒绝。', 'Search messages within archives. Permanent deletion is limited to unloaded archived local sessions; loaded or running sessions are refused.')),
      h('input', { type: 'search', value: query, maxLength: 500,
        'aria-label': text('搜索已归档会话', 'Search archived sessions'),
        placeholder: text('搜索名称、工作区或聊天内容', 'Search names, workspaces or messages'),
        onChange: e => { setQuery(e.target.value); setError('') },
        style: { width: '100%', boxSizing: 'border-box', height: 36, padding: '0 14px', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-base)', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2)' } }),
      searching && h('p', { role: 'status' }, text('正在搜索归档内容…', 'Searching archived messages…')),
      result.hasMore && h('p', { role: 'status' }, text('仅显示前 20 条内容匹配，请缩小搜索范围。', 'Showing the first 20 content matches. Narrow your search.')),
      error && h('p', { role: 'alert' }, error),
      rows.length === 0 && h('p', null, text('暂无匹配的归档会话', 'No matching archived sessions')),
      rows.length > 0 && h('div', { style: card },
        ...rows.map((row, index) => h('div', { key: row.id, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '16px 0', borderBottom: index === rows.length - 1 ? 'none' : '.5px solid var(--dsw-alias-border-l2)' } },
          h('div', { style: { flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' } },
            h('div', null, row.title), h('div', { style: { fontSize: 12 } }, row.workspace),
            snippets.has(row.id) && h('p', { style: { margin: '6px 0 0', whiteSpace: 'pre-wrap' } }, snippets.get(row.id))),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto', maxWidth: '100%' } },
            h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => restore(row), 'aria-label': text('取消归档 ', 'Unarchive ') + row.title }, text('取消归档', 'Unarchive')),
            h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy, style: { color: 'var(--dsw-alias-state-error-primary)' }, onClick: () => requestDelete(row), 'aria-label': text('永久删除 ', 'Delete permanently ') + row.title }, text('永久删除', 'Delete permanently')))))))
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-chat-manager.archive-search', order: 25,
    label: () => text('归档内容搜索与清理', 'Archive content search and cleanup'),
  }, ArchiveSettings))
}
