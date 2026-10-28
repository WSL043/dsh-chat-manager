import { registerArchiveSettings } from './archive-settings.mjs'

// Unreleased v2: additive actions on the fixed Alpha2 public slot contract.
// Own only this menu entry and dialog; never replace the workspace or its CSS.
export function registerOfficialSessionActions(ctx, React, ui) {
  const h = React.createElement
  const listeners = new Set()
  let state = { target: null, busy: false, error: '' }, disposed = false
  const controller = new AbortController()
  const publish = value => {
    if (disposed) return
    state = { ...state, ...value }
    for (const listener of listeners) listener()
  }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  const snapshot = () => state
  const text = (zh, en) => ctx.locale.getSnapshot().active === 'zh' ? zh : en
  const danger = { color: 'var(--dsw-alias-state-error-primary)' }
  function DeleteMenuItem({ sessionId, displayTitle, useMenuOpenState, useWorkspaces }) {
    const archived = useWorkspaces(s => s.archivedSessionIds.includes(sessionId))
    const [, closeMenu] = useMenuOpenState()
    if (!archived) return null
    return h(ui.MenuItemButton, {
      danger: true,
      icon: h(ui.IconTrashOutlineRegular, {}),
      onSelect: () => {
        closeMenu(false)
        if (!disposed && !state.busy) publish({ target: { id: sessionId, title: displayTitle || sessionId }, error: '' })
      },
    }, text('永久删除', 'Delete permanently'))
  }
  async function confirm() {
    if (disposed || state.busy || !state.target) return
    const target = state.target
    publish({ busy: true, error: '' })
    try {
      const response = await fetch('/plugins/dsh-session-delete/delete', {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-dsh-session-delete-confirmation': 'delete-session' },
        body: JSON.stringify({ sessionId: target.id }),
      })
      const result = await response.json()
      if (!response.ok || result?.ok !== true) throw Error(result?.error?.message || `HTTP ${response.status}`)
      if (disposed) return
      const sessions = ctx.get('sessions')
      // Archive changes arrive through the official observable; only sessions expose refresh.
      const refreshed = await Promise.allSettled([sessions.refresh()])
      if (result.value?.archiveReconciled === false) {
        publish({ error: text('记录已删除，但归档列表未完成更新。请刷新列表后重试清理归档标记。', 'The record was deleted, but its archive marker could not be cleared. Refresh and retry marker cleanup.') })
      }
      else publish({ target: null })
      for (const item of refreshed) if (item.status === 'rejected') console.warn('Session deleted; list refresh failed:', item.reason)
    } catch (error) { publish({ error: error.message || String(error) }) }
    finally { publish({ busy: false }) }
  }
  function DeleteDialog() {
    const current = React.useSyncExternalStore(subscribe, snapshot, snapshot)
    if (!current.target) return null
    const close = () => { if (!state.busy) publish({ target: null, error: '' }) }
    return h(ui.Modal, {
      open: true, onClose: close, closeLabel: text('取消', 'Cancel'),
      title: text('永久删除会话？', 'Permanently delete session?'),
      description: text('只删除已归档且未加载的本机会话记录，无法恢复。已加载或运行中的会话会被拒绝。', 'Only an unloaded, archived local session can be deleted. This cannot be undone. Loaded or running sessions are refused.'),
      footer: h('div', { style: { display: 'flex', gap: 8 } },
        h(ui.Button, { variant: 'outline', disabled: current.busy, onClick: close }, text('取消', 'Cancel')),
        h(ui.Button, { variant: 'outline', style: danger, disabled: current.busy, onClick: confirm },
          current.busy ? text('正在删除…', 'Deleting…') : text('确认永久删除', 'Confirm permanent deletion'))),
    }, h('p', null, current.target.title), current.error && h('p', { role: 'alert' }, current.error))
  }
  ctx.effect(() => () => {
    disposed = true
    controller.abort()
    listeners.clear()
  }, 'chat-manager: session deletion lifecycle')
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item', id: 'dsh-chat-manager.delete', order: 500,
  }, DeleteMenuItem))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-chat-manager.delete-dialog',
  }, DeleteDialog))
  registerArchiveSettings(ctx, React, ui, { requestDelete: row => {
    if (!disposed && !state.busy) publish({ target: { id: row.id, title: row.title }, error: '' })
  } })
}

export function buildOfficialSlotClient() {
  return `// DSH Chat Manager unreleased v2: public Alpha2 slots; no workspace copy.\nwindow.__ModuleLoader__.load({
  id: "dsh-chat-manager",
  factory: require => {
    const React = require("react");
    const ui = require("@deepseek-ai/dsh-client-ui-primitives");
    const register = ${registerOfficialSessionActions.toString()};
    const registerArchiveSettings = ${registerArchiveSettings.toString()};
    return { inject: ["slots", "sessions", "workspaces", "locale"], apply(ctx) {
      register(ctx, React, ui);

    } };
  }
});\n`
}
