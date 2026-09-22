import { registerArchiveSettings } from './archive-settings.mjs'

// Candidate for the official session-menu slots introduced in DSH 0.1.7.
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
  function DeleteMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
    const [, closeMenu] = useMenuOpenState()
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
      const sessions = ctx.get('sessions'), workspaces = ctx.get('workspaces')
      const current = sessions.list.getSnapshot().byId?.[target.id]
      if ((current?.retainedBy?.mainView ?? 0) > 0) ctx.get('uiWorkspace')?.clearMain?.()
      // Current official stores receive host events; older stores additionally
      // expose refresh(). Absence is not a failed deletion.
      const refreshed = await Promise.allSettled([
        typeof sessions.refresh === 'function' ? sessions.refresh() : Promise.resolve(),
        typeof workspaces.refresh === 'function' ? workspaces.refresh() : Promise.resolve(),
      ])
      publish({ target: null })
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
      description: text('本机会话记录将永久删除，无法恢复。运行中的任务会先停止。', 'The local session will be permanently deleted. Running work will be stopped first.'),
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
}

export function buildOfficialSlotClient() {
  return `// DSH Chat Manager: official 0.1.7 session slots; no workspace copy.\nwindow.__ModuleLoader__.load({
  id: "dsh-chat-manager",
  factory: require => {
    const React = require("react");
    const ui = require("@deepseek-ai/dsh-client-ui-primitives");
    const register = ${registerOfficialSessionActions.toString()};
    const archiveSettings = ${registerArchiveSettings.toString()};
    return { inject: ["slots", "sessions", "workspaces", "locale"], apply(ctx) {
      register(ctx, React, ui);
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = ".dsh-chat-manager-delete:not(:disabled){color:var(--dsw-alias-state-error-primary)}";
        document.head.appendChild(style);
        return () => style.remove();
      }, "chat-manager: archive action style");
      archiveSettings(ctx, React, ui, "dsh-chat-manager-delete", { always: true });
    } };
  }
});\n`
}
