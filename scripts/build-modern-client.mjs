import { registerArchiveSettings } from './archive-settings.mjs'

export const MODERN_WORKSPACE_VERSION = '0.1.6-alpha.2'

// Reuse the official native/browser picker through its public slot registry.
// The extension owns only the forwarding registrations, never the providers.
export function mirrorDirectoryFlow(ctx) {
  const source = 'sidebar.workspaces.directoryFlow'
  const target = 'dsh-chat-manager.directoryFlow'
  ctx.slots.inject(source, () => ctx.slots.inject(target, () => {
    let disposers = []
    const clear = () => { for (const dispose of disposers.splice(0)) dispose() }
    const sync = () => {
      clear()
      for (const entry of ctx.slots.entries(source)) {
        disposers.push(ctx.slots.register({ name: target, ...entry.options,
          inject: entry.inject, locale: entry.locale }, entry.component))
      }
    }
    sync()
    const unsubscribe = ctx.slots.subscribe(source, sync)
    return () => { unsubscribe(); clear() }
  }))
}

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`modern alpha2 marker mismatch: ${label}`)
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`
}

const countExact = (source, marker) => source.split(marker).length - 1

const replaceAllExact = (source, before, after, expected, label) => {
  const count = countExact(source, before)
  if (count !== expected) throw new Error(`modern alpha2 marker mismatch: ${label} (expected ${expected}, found ${count})`)
  return source.replaceAll(before, after)
}

const findFunctionSignature = (source, functionName) => {
  const pattern = new RegExp(`function ${functionName}\\(\\{[^}]+\\}\\) \\{`, 'g')
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) throw new Error(`modern alpha2 marker mismatch: ${functionName} signature`)
  return matches[0][0]
}

const modernShape = (source) => {
  if (typeof source !== 'string') return false
  const required = [
    'var UiWorkspaceService = class extends',
    'mainReference;',
    'this.sessions.retain(target, { source: "mainView" })',
    'replaceMain(target, signal, beforeOpen)',
    'function apply(ctx) {',
    'id: "@deepseek-ai/dsh-client-ui-workspace",',
  ]
  if (required.some(marker => !source.includes(marker))) return false
  try {
    const row = findFunctionSignature(source, 'SessionNodeItem')
    const tree = findFunctionSignature(source, 'SessionTree')
    const flat = findFunctionSignature(source, 'FlatList')
    const browser = findFunctionSignature(source, 'WorkspaceBrowser')
    return row.includes('onFork, onArchive, onReveal,')
      && tree.includes('onSessionRename, onSessionArchive, insertWorkspaceBefore,')
      && flat.includes('onSessionRename, onSessionArchive, usePanelInfo,')
      && browser.includes('archiveSession, createWorkspace,')
      && countExact(source, 'onArchive: onSessionArchive,\n') === 2
  } catch {
    return false
  }
}

export function isModernWorkspaceClient(source) {
  return modernShape(source)
}

const assertModernShape = (source, version) => {
  if (version !== MODERN_WORKSPACE_VERSION) {
    throw new Error(`unsupported modern @deepseek-ai/dsh-client-ui-workspace version: ${version}`)
  }
  if (!modernShape(source)) throw new Error('modern alpha2 client shape is not recognized')
}

const deleteAction = `
\t\t\t\tdeleteSession: async (sessionId) => {
\t\t\t\t\tconst response = await fetch("/plugins/dsh-session-delete/delete", {
\t\t\t\t\t\tmethod: "POST",
\t\t\t\t\t\theaders: {
\t\t\t\t\t\t\t"content-type": "application/json",
\t\t\t\t\t\t\t"x-dsh-session-delete-confirmation": "delete-session"
\t\t\t\t\t\t},
\t\t\t\t\t\tbody: JSON.stringify({ sessionId })
\t\t\t\t\t});
\t\t\t\t\tconst payload = await response.json().catch(() => null);
\t\t\t\t\tif (!response.ok || payload?.ok !== true) {
\t\t\t\t\t\tthrow new Error(payload?.error?.message ?? \`Delete failed (HTTP \${response.status})\`);
\t\t\t\t\t}
\t\t\t\t\tconst current = Object.values(sessions.list.getSnapshot().byId ?? {}).find((summary) => summary?.id === sessionId && (summary.retainedBy?.mainView ?? 0) > 0);
\t\t\t\t\tif (current !== void 0) uiWorkspace.clearMain();
\t\t\t\t\tconst refreshes = await Promise.allSettled([
\t\t\t\t\t\tsessions.refresh(),
\t\t\t\t\t\ttypeof workspaces.refresh === "function" ? workspaces.refresh() : Promise.resolve()
\t\t\t\t\t]);
\t\t\t\t\tfor (const refresh of refreshes) {
\t\t\t\t\t\tif (refresh.status === "rejected") console.warn("session deletion succeeded but runtime refresh failed:", refresh.reason);
\t\t\t\t\t}
\t\t\t\t},
`

const sessionDeleteState = `
\t\t\tconst [sessionDeleteTarget, setSessionDeleteTarget] = (0, react.useState)(null);
\t\t\tconst [sessionDeleting, setSessionDeleting] = (0, react.useState)(false);
\t\t\tconst [sessionDeleteError, setSessionDeleteError] = (0, react.useState)(null);
\t\t\tconst onSessionDelete = (sessionId, title) => {
\t\t\t\tsetSessionDeleteTarget({ sessionId, title });
\t\t\t\tsetSessionDeleteError(null);
\t\t\t};
\t\t\tconst closeSessionDelete = () => {
\t\t\t\tif (sessionDeleting) return;
\t\t\t\tsetSessionDeleteTarget(null);
\t\t\t\tsetSessionDeleteError(null);
\t\t\t};
\t\t\tconst confirmSessionDelete = () => {
\t\t\t\tif (sessionDeleting || sessionDeleteTarget === null) return;
\t\t\t\tsetSessionDeleting(true);
\t\t\t\tsetSessionDeleteError(null);
\t\t\t\tdeleteSession(sessionDeleteTarget.sessionId).then(() => {
\t\t\t\t\tsetSessionDeleting(false);
\t\t\t\t\tsetSessionDeleteTarget(null);
\t\t\t\t\tsetSessionDeleteError(null);
\t\t\t\t}).catch((reason) => {
\t\t\t\t\tsetSessionDeleting(false);
\t\t\t\t\tsetSessionDeleteError(reason instanceof Error ? reason.message : String(reason));
\t\t\t\t});
\t\t\t};
`

const sessionDeleteModal = `
\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
\t\t\t\t\t\topen: sessionDeleteTarget !== null,
\t\t\t\t\t\tonClose: closeSessionDelete,
\t\t\t\t\t\tcloseLabel: t("close"),
\t\t\t\t\t\ttitle: t("delete.session.title"),
\t\t\t\t\t\t...sessionDeleteTarget === null ? {} : { description: t("delete.session.desc", { name: sessionDeleteTarget.title }) },
\t\t\t\t\t\tfooter: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\tdisabled: sessionDeleting,
\t\t\t\t\t\t\tonClick: closeSessionDelete,
\t\t\t\t\t\t\tchildren: t("cancel")
\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteAction,
\t\t\t\t\t\t\tdisabled: sessionDeleting,
\t\t\t\t\t\t\tonClick: confirmSessionDelete,
\t\t\t\t\t\t\tchildren: t("delete.session.confirm")
\t\t\t\t\t\t})] }),
\t\t\t\t\t\tchildren: [sessionDeleting && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteStatus,
\t\t\t\t\t\t\trole: "status",
\t\t\t\t\t\t\tchildren: t("delete.session.pending")
\t\t\t\t\t\t}), sessionDeleteError !== null && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameError,
\t\t\t\t\t\t\trole: "alert",
\t\t\t\t\t\t\tchildren: sessionDeleteError
\t\t\t\t\t\t})]
\t\t\t\t\t}),
`

const addLocale = (source, language, before, after) => replaceOnce(source, before, `${before}${after}`, `${language} delete locale`)

export function patchModernWorkspaceClient(upstream, upstreamVersion = MODERN_WORKSPACE_VERSION) {
  assertModernShape(upstream, upstreamVersion)
  const sessionRowSignature = findFunctionSignature(upstream, 'SessionNodeItem')
  const sessionTreeSignature = findFunctionSignature(upstream, 'SessionTree')
  const flatListSignature = findFunctionSignature(upstream, 'FlatList')
  const workspaceBrowserSignature = findFunctionSignature(upstream, 'WorkspaceBrowser')
  let source = upstream

  source = replaceOnce(source, 'id: "@deepseek-ai/dsh-client-ui-workspace",', 'id: "dsh-chat-manager",', 'client module id')
  source = replaceOnce(
    source,
    sessionRowSignature,
    sessionRowSignature.replace('onFork, onArchive, onReveal,', 'onFork, onArchive, onDelete, onReveal,'),
    'session row props',
  )
  source = replaceOnce(
    source,
    `\t\t\t\t{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}\n`,
    `\t\t\t\t{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "delete-session",\n\t\t\t\t\tlabel: t("menu.deleteSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\t\tdanger: true\n\t\t\t\t}\n`,
    'session delete menu item',
  )
  source = replaceOnce(
    source,
    '\t\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n',
    '\t\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\t\t\tif (id === "delete-session") onDelete(node.id, title);\n',
    'session delete menu selection',
  )
  source = replaceOnce(
    source,
    sessionTreeSignature,
    sessionTreeSignature.replace(
      'onSessionRename, onSessionArchive, insertWorkspaceBefore,',
      'onSessionRename, onSessionArchive, onSessionDelete, insertWorkspaceBefore,',
    ),
    'session tree props',
  )
  source = replaceOnce(
    source,
    flatListSignature,
    flatListSignature.replace(
      'onSessionRename, onSessionArchive, usePanelInfo,',
      'onSessionRename, onSessionArchive, onSessionDelete, usePanelInfo,',
    ),
    'flat list props',
  )
  const rowArchivePattern = /^(\t+)onArchive: onSessionArchive,\n(?=\1onReveal:)/gm
  const rowArchiveMatches = [...source.matchAll(rowArchivePattern)]
  if (rowArchiveMatches.length !== 2) {
    throw new Error(`modern alpha2 marker mismatch: session row delete props (expected 2, found ${rowArchiveMatches.length})`)
  }
  source = source.replace(rowArchivePattern, (match, indent) => `${match}${indent}onDelete: onSessionDelete,\n`)
  source = replaceOnce(
    source,
    workspaceBrowserSignature,
    workspaceBrowserSignature.replace('archiveSession, createWorkspace,', 'archiveSession, deleteSession, createWorkspace,'),
    'workspace browser delete action prop',
  )
  source = replaceOnce(
    source,
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tsetSessionOrder: saveSessionOrder,\n',
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tsetSessionOrder: saveSessionOrder,\n',
    'flat list delete handler',
  )
  source = replaceOnce(
    source,
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tforkSession,\n',
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tforkSession,\n',
    'session tree delete handler',
  )
  source = replaceOnce(
    source,
    `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};\n`,
    `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};${sessionDeleteState}`,
    'session delete state',
  )
  source = replaceOnce(
    source,
    '\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n',
    `${sessionDeleteModal}\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n`,
    'session delete confirmation modal',
  )
  source = replaceOnce(source, '\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait uiWorkspace.archiveSession(sessionId);\n\t\t\t\t},\n', `${'\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait uiWorkspace.archiveSession(sessionId);\n\t\t\t\t},\n'}${deleteAction}`, 'browser delete request')
  source = addLocale(
    source,
    'Chinese',
    '\t\t\t"menu.archiveSession": "归档会话",\n',
    '\t\t\t"menu.deleteSession": "删除会话",\n\t\t\t"delete.session.title": "永久删除会话？",\n\t\t\t"delete.session.desc": "“{name}”的会话记录将从本机永久删除，且无法恢复。正在运行的任务会先安全停止。",\n\t\t\t"delete.session.confirm": "永久删除",\n\t\t\t"delete.session.pending": "正在永久删除会话…",\n',
  )
  source = addLocale(
    source,
    'English',
    '\t\t\t"menu.archiveSession": "Archive session",\n',
    '\t\t\t"menu.deleteSession": "Delete session",\n\t\t\t"delete.session.title": "Permanently delete session?",\n\t\t\t"delete.session.desc": "The local record for “{name}” will be permanently deleted and cannot be recovered. Running work will be stopped safely before deletion.",\n\t\t\t"delete.session.confirm": "Delete permanently",\n\t\t\t"delete.session.pending": "Permanently deleting session…",\n',
  )
  source = replaceOnce(
    source,
    'function apply(ctx) {',
    `${registerArchiveSettings.toString()}\nfunction apply(ctx) {\nregisterArchiveSettings(ctx, react, _deepseek_ai_dsh_client_ui_primitives, WorkspaceBrowser_module_css_default.deleteAction);`,
    'archive settings registration',
  )

  // The official workspace owns retained sessions. Replacing that service during
  // bundle HMR releases the session behind the still-mounted composer. Enhance
  // its view slots instead; disabling this plugin then removes only our views.
  source = replaceOnce(source,
    'const uiWorkspace = new UiWorkspaceService(ctx, ctx.remote.directoryPicker, workspaces, sessions);',
    'const uiWorkspace = ctx.get("uiWorkspace");', 'reuse official workspace owner')
  source = replaceOnce(source,
    'ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } });',
    '// Root hooks remain owned by the official workspace.', 'preserve official workspace root hooks')
  source = replaceOnce(source, 'const NS = "workspace";',
    'const NS = "dsh-chat-manager-workspace";', 'isolate extension dictionaries')
  source = replaceOnce(source, '"remote.directoryPicker",\n\t\t\t"layout"',
    '"remote.directoryPicker",\n\t\t\t"uiWorkspace",\n\t\t\t"layout"', 'require official workspace owner')
  source = replaceOnce(source, 'name: "sidebar.workspaces",',
    'name: "sidebar.workspaces",\n                priority: -10,', 'enhance workspace browser')
  source = source.replaceAll('sidebar.workspaces.directoryFlow', 'dsh-chat-manager.directoryFlow')
  const pickerStart = source.indexOf('\t\t\tctx.slots.inject("conversation.hero.workspace",')
  const pickerClose = source.indexOf('}, WorkspacePicker));', pickerStart)
  if (pickerStart < 0 || pickerClose < pickerStart) throw new Error('missing official picker registration')
  const pickerEnd = pickerClose + '}, WorkspacePicker));'.length
  source = source.slice(0, pickerStart) + source.slice(pickerEnd)
  source = replaceOnce(source, 'const uiWorkspace = ctx.get("uiWorkspace");',
    'const uiWorkspace = ctx.get("uiWorkspace");\n(' + mirrorDirectoryFlow.toString() + ')(ctx);', 'reuse official directory flow providers')


  source = replaceOnce(source,
    'children: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {',
    'children: [typeof window.__DSH_PORTABLE_SETTINGS__?.open === "function" && (0, react_jsx_runtime.jsx)("button", { type: "button", id: "archived-sessions", className: WorkspaceBrowser_module_css_default.iconButton, "aria-label": t("archive.open"), title: t("archive.open"), onClick: () => window.__DSH_PORTABLE_SETTINGS__?.open("archived-sessions"), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 }) }), wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {',
    'archive settings shortcut');
  source = replaceOnce(source, '"menu.archiveSession": "归档会话",', '"archive.open": "已归档会话",\n\t\t\t"menu.archiveSession": "归档会话",', 'archive shortcut Chinese');
  source = replaceOnce(source, '"menu.archiveSession": "Archive session",', '"archive.open": "Archived sessions",\n\t\t\t"menu.archiveSession": "Archive session",', 'archive shortcut English');

  // The official header reserves 60px for two 28px actions and one gap.
  // Archive adds a third action; retain the zero-width search-expanded rule.
  const headerWidth = /([.][\w-]+_headerActions\{[^}]*?)max-width:60px;/g
  if ([...source.matchAll(headerWidth)].length !== 1) throw new Error('missing official header action width')
  source = source.replace(headerWidth, '$1max-width:92px;')

  // Both clients coexist; official CSS tag identities would suppress our added
  // danger-button rules when the official module has loaded first.
  source = source.replaceAll('@deepseek-ai/dsh-client-ui-workspace/', 'dsh-chat-manager/')
    .replaceAll('tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace"', 'tag.dataset.plugin = "dsh-chat-manager"')
  const notice = `// Modified from @deepseek-ai/dsh-client-ui-workspace ${upstreamVersion} by DSH Chat Manager. See THIRD_PARTY_NOTICES.md.\n`
  return `${notice}${source}`
}
