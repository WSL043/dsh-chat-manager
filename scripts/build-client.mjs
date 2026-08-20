import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(here, '../lib/client.js')
const compatibility = JSON.parse(readFileSync(resolve(here, '../compatibility.json'), 'utf8'))
const LATEST_UPSTREAM_VERSION = compatibility.latestTested
const SUPPORTED_UPSTREAM_VERSIONS = new Set(compatibility.supported)

export const resolveUpstreamClient = () => require.resolve('@deepseek-ai/dsh-client-ui-workspace/client')
export const resolveUpstreamManifest = () => require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`upstream marker mismatch: ${label}`)
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`
}

const findFunctionSignature = (source, functionName) => {
  const pattern = new RegExp(`function ${functionName}\\(\\{[^}]+\\}\\) \\{`, 'g')
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) throw new Error(`upstream marker mismatch: ${functionName} signature`)
  return matches[0][0]
}

/**
 * Add one narrow feature to the shipped workspace client while preserving the
 * rest of the official bundle byte-for-byte after a modification notice.
 * Exact markers turn upstream UI drift into a build failure instead of a
 * silently malformed client.
 */
export function patchWorkspaceClient(upstream, upstreamVersion = LATEST_UPSTREAM_VERSION) {
  if (!SUPPORTED_UPSTREAM_VERSIONS.has(upstreamVersion)) {
    throw new Error(`unsupported @deepseek-ai/dsh-client-ui-workspace version: ${upstreamVersion}`)
  }
  const sessionTreeSignature = findFunctionSignature(upstream, 'SessionTree')
  const workspaceBrowserSignature = findFunctionSignature(upstream, 'WorkspaceBrowser')
  if (!sessionTreeSignature.includes('onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore,')) {
    throw new Error('upstream marker mismatch: SessionTree delete insertion point')
  }
  if (!workspaceBrowserSignature.includes('deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore,')) {
    throw new Error('upstream marker mismatch: WorkspaceBrowser delete insertion point')
  }
  let source = upstream
  const patch = (before, after, label) => {
    source = replaceOnce(source, before, after, label)
  }

  patch(
    'id: "@deepseek-ai/dsh-client-ui-workspace",',
    'id: "dsh-native-session-delete",',
    'client module id',
  )
  patch(
    'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t }) {',
    'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onDelete, drag, flat = false, t }) {',
    'session row props',
  )
  patch(
    `\t\t\t\t{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}\n`,
    `\t\t\t\t{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "delete-session",\n\t\t\t\t\tlabel: t("menu.deleteSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\t\tdanger: true\n\t\t\t\t}\n`,
    'session delete menu item',
  )
  patch(
    '\t\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n',
    '\t\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\t\t\tif (id === "delete-session") onDelete(node.id, title);\n',
    'session delete menu selection',
  )
  patch(
    sessionTreeSignature,
    sessionTreeSignature.replace(
      'onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore,',
      'onDeleteRequest, onSessionRename, onSessionArchive, onSessionDelete, insertWorkspaceBefore,',
    ),
    'session tree props',
  )
  patch(
    '\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n',
    '\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\tonDelete: onSessionDelete,\n',
    'tree row delete prop',
  )
  patch(
    'function FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {',
    'function FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, onSessionDelete, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {',
    'flat list props',
  )
  patch(
    '\t\t\t\t\t\t\tonFork: forkSession,\n\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tflat: true,\n',
    '\t\t\t\t\t\t\tonFork: forkSession,\n\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tonDelete: onSessionDelete,\n\t\t\t\t\t\t\tflat: true,\n',
    'flat row delete prop',
  )
  patch(
    workspaceBrowserSignature,
    workspaceBrowserSignature.replace(
      'deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore,',
      'deleteWorkspace, insertWorkspaceBefore, archiveSession, deleteSession, insertSessionBefore,',
    ),
    'workspace browser delete action prop',
  )
  patch(
    `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};\n`,
    `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst [sessionDeleteTarget, setSessionDeleteTarget] = (0, react.useState)(null);\n\t\t\tconst [sessionDeleting, setSessionDeleting] = (0, react.useState)(false);\n\t\t\tconst [sessionDeleteError, setSessionDeleteError] = (0, react.useState)(null);\n\t\t\tconst onSessionDelete = (sessionId, title) => {\n\t\t\t\tsetSessionDeleteTarget({ sessionId, title });\n\t\t\t\tsetSessionDeleteError(null);\n\t\t\t};\n\t\t\tconst closeSessionDelete = () => {\n\t\t\t\tif (sessionDeleting) return;\n\t\t\t\tsetSessionDeleteTarget(null);\n\t\t\t\tsetSessionDeleteError(null);\n\t\t\t};\n\t\t\tconst confirmSessionDelete = () => {\n\t\t\t\tif (sessionDeleting || sessionDeleteTarget === null) return;\n\t\t\t\tsetSessionDeleting(true);\n\t\t\t\tsetSessionDeleteError(null);\n\t\t\t\tdeleteSession(sessionDeleteTarget.sessionId).then(() => {\n\t\t\t\t\tsetSessionDeleting(false);\n\t\t\t\t\tsetSessionDeleteTarget(null);\n\t\t\t\t\tsetSessionDeleteError(null);\n\t\t\t\t}).catch((reason) => {\n\t\t\t\t\tsetSessionDeleting(false);\n\t\t\t\t\tsetSessionDeleteError(reason instanceof Error ? reason.message : String(reason));\n\t\t\t\t});\n\t\t\t};\n`,
    'session delete dialog state',
  )
  patch(
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tarchivedSessionIds,\n',
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tarchivedSessionIds,\n',
    'flat list delete handler',
  )
  patch(
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tforkSession,\n',
    '\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tforkSession,\n',
    'session tree delete handler',
  )
  patch(
    `\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n`,
    `\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: sessionDeleteTarget !== null,\n\t\t\t\t\t\tonClose: closeSessionDelete,\n\t\t\t\t\t\tcloseLabel: t("close"),\n\t\t\t\t\t\ttitle: t("delete.session.title"),\n\t\t\t\t\t\t...sessionDeleteTarget === null ? {} : { description: t("delete.session.desc", { name: sessionDeleteTarget.title }) },\n\t\t\t\t\t\tfooter: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {\n\t\t\t\t\t\t\tvariant: "outline",\n\t\t\t\t\t\t\tdisabled: sessionDeleting,\n\t\t\t\t\t\t\tonClick: closeSessionDelete,\n\t\t\t\t\t\t\tchildren: t("cancel")\n\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {\n\t\t\t\t\t\t\tvariant: "outline",\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteAction,\n\t\t\t\t\t\t\tdisabled: sessionDeleting,\n\t\t\t\t\t\t\tonClick: confirmSessionDelete,\n\t\t\t\t\t\t\tchildren: t("delete.session.confirm")\n\t\t\t\t\t\t})] }),\n\t\t\t\t\t\tchildren: [sessionDeleting && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteStatus,\n\t\t\t\t\t\t\trole: "status",\n\t\t\t\t\t\t\tchildren: t("delete.session.pending")\n\t\t\t\t\t\t}), sessionDeleteError !== null && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameError,\n\t\t\t\t\t\t\trole: "alert",\n\t\t\t\t\t\t\tchildren: sessionDeleteError\n\t\t\t\t\t\t})]\n\t\t\t\t\t}),\n\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n`,
    'session delete confirmation modal',
  )
  patch(
    '\t\t\t"menu.archiveSession": "归档会话",\n',
    '\t\t\t"menu.archiveSession": "归档会话",\n\t\t\t"menu.deleteSession": "删除会话",\n\t\t\t"delete.session.title": "永久删除会话？",\n\t\t\t"delete.session.desc": "“{name}”的会话记录将从本机永久删除，且无法恢复。正在运行的任务会先安全停止。",\n\t\t\t"delete.session.confirm": "永久删除",\n\t\t\t"delete.session.pending": "正在永久删除会话…",\n',
    'Chinese delete locale',
  )
  patch(
    '\t\t\t"menu.archiveSession": "Archive session",\n',
    '\t\t\t"menu.archiveSession": "Archive session",\n\t\t\t"menu.deleteSession": "Delete session",\n\t\t\t"delete.session.title": "Permanently delete session?",\n\t\t\t"delete.session.desc": "The local record for “{name}” will be permanently deleted and cannot be recovered. Running work will be stopped safely before deletion.",\n\t\t\t"delete.session.confirm": "Delete permanently",\n\t\t\t"delete.session.pending": "Permanently deleting session…",\n',
    'English delete locale',
  )
  patch(
    `\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},\n`,
    `\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},\n\t\t\t\tdeleteSession: async (sessionId) => {\n\t\t\t\t\tconst response = await fetch("/plugins/dsh-session-delete/delete", {\n\t\t\t\t\t\tmethod: "POST",\n\t\t\t\t\t\theaders: {\n\t\t\t\t\t\t\t"content-type": "application/json",\n\t\t\t\t\t\t\t"x-dsh-session-delete-confirmation": "delete-session"\n\t\t\t\t\t\t},\n\t\t\t\t\t\tbody: JSON.stringify({ sessionId })\n\t\t\t\t\t});\n\t\t\t\t\tconst payload = await response.json().catch(() => null);\n\t\t\t\t\tif (!response.ok || payload?.ok !== true) {\n\t\t\t\t\t\tthrow new Error(payload?.error?.message ?? \`Delete failed (HTTP \${response.status})\`);\n\t\t\t\t\t}\n\t\t\t\t\tif (ctx.sessions.list.getSnapshot().current === sessionId) ctx.sessions.clear();\n\t\t\t\t\tconst refreshes = await Promise.allSettled([\n\t\t\t\t\t\tctx.sessions.refresh(),\n\t\t\t\t\t\tctx.workspaces.refresh()\n\t\t\t\t\t]);\n\t\t\t\t\tfor (const refresh of refreshes) {\n\t\t\t\t\t\tif (refresh.status === "rejected") console.warn("session deletion succeeded but runtime refresh failed:", refresh.reason);\n\t\t\t\t\t}\n\t\t\t\t},\n`,
    'browser delete request',
  )
  const homePathCall = '(0, _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath)(row.cwd, home)'
  if (source.includes(homePathCall)) {
    patch(
      homePathCall,
      'typeof _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath === "function" ? (0, _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath)(row.cwd, home) : row.cwd',
      'home path compatibility fallback',
    )
  }

  const notice = `// Modified from @deepseek-ai/dsh-client-ui-workspace ${upstreamVersion} by DSH Session Delete. See THIRD_PARTY_NOTICES.md.\n`
  return `${notice}${source}`
}

export async function buildClient() {
  const manifest = JSON.parse(await readFile(resolveUpstreamManifest(), 'utf8'))
  if (manifest.version !== LATEST_UPSTREAM_VERSION) {
    throw new Error(
      `unsupported @deepseek-ai/dsh-client-ui-workspace version: ${manifest.version ?? 'unknown'}`,
    )
  }
  const upstream = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(upstream, manifest.version)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, patched, 'utf8')
  return output
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(`${await buildClient()}\n`)
}
