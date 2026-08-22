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
      'deleteWorkspace, insertWorkspaceBefore, archiveSession, deleteSession, restoreSession, searchArchivedSessions, insertSessionBefore,',
    ),
    'workspace browser delete action prop',
  )
  patch(
    `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};\n`,
    `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst [sessionDeleteTarget, setSessionDeleteTarget] = (0, react.useState)(null);\n\t\t\tconst [sessionDeleting, setSessionDeleting] = (0, react.useState)(false);\n\t\t\tconst [sessionDeleteError, setSessionDeleteError] = (0, react.useState)(null);\n\t\t\tconst onSessionDelete = (sessionId, title) => {\n\t\t\t\tsetSessionDeleteTarget({ sessionId, title });\n\t\t\t\tsetSessionDeleteError(null);\n\t\t\t};\n\t\t\tconst closeSessionDelete = () => {\n\t\t\t\tif (sessionDeleting) return;\n\t\t\t\tsetSessionDeleteTarget(null);\n\t\t\t\tsetSessionDeleteError(null);\n\t\t\t};\n\t\t\tconst confirmSessionDelete = () => {\n\t\t\t\tif (sessionDeleting || sessionDeleteTarget === null) return;\n\t\t\t\tsetSessionDeleting(true);\n\t\t\t\tsetSessionDeleteError(null);\n\t\t\t\tdeleteSession(sessionDeleteTarget.sessionId).then(() => {\n\t\t\t\t\tsetSessionDeleting(false);\n\t\t\t\t\tsetSessionDeleteTarget(null);\n\t\t\t\t\tsetSessionDeleteError(null);\n\t\t\t\t}).catch((reason) => {\n\t\t\t\t\tsetSessionDeleting(false);\n\t\t\t\t\tsetSessionDeleteError(reason instanceof Error ? reason.message : String(reason));\n\t\t\t\t});\n\t\t\t};\n`,
    'session delete dialog state',
  )
  patch(
    'const [sessionDeleteTarget, setSessionDeleteTarget] = (0, react.useState)(null);',
    `const archiveSessionList = useSessions((state) => state);
\t\t\tconst [archiveManagerOpen, setArchiveManagerOpen] = (0, react.useState)(false);
\t\t\tconst [archiveQuery, setArchiveQuery] = (0, react.useState)("");
\t\t\tconst [archiveSearch, setArchiveSearch] = (0, react.useState)({ query: "", status: "idle", items: [], hasMore: false });
\t\t\tconst [archiveBusyId, setArchiveBusyId] = (0, react.useState)(null);
\t\t\tconst [archiveError, setArchiveError] = (0, react.useState)(null);
\t\t\tconst normalizedArchiveQuery = archiveQuery.trim();
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (!archiveManagerOpen || normalizedArchiveQuery === "") {
\t\t\t\t\tsetArchiveSearch({ query: "", status: "idle", items: [], hasMore: false });
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst controller = new AbortController();
\t\t\t\tsetArchiveSearch({ query: normalizedArchiveQuery, status: "loading", items: [], hasMore: false });
\t\t\t\tconst timer = window.setTimeout(() => {
\t\t\t\t\tsearchArchivedSessions(normalizedArchiveQuery, controller.signal).then((result) => {
\t\t\t\t\t\tif (!controller.signal.aborted) setArchiveSearch({ query: normalizedArchiveQuery, status: "ready", items: result.items, hasMore: result.hasMore });
\t\t\t\t\t}).catch(() => {
\t\t\t\t\t\tif (!controller.signal.aborted) setArchiveSearch({ query: normalizedArchiveQuery, status: "error", items: [], hasMore: false });
\t\t\t\t\t});
\t\t\t\t}, 250);
\t\t\t\treturn () => { window.clearTimeout(timer); controller.abort(); };
\t\t\t}, [archiveManagerOpen, normalizedArchiveQuery, searchArchivedSessions]);
\t\t\tconst archiveWorkspaceBySession = (0, react.useMemo)(() => {
\t\t\t\tconst result = /* @__PURE__ */ new Map();
\t\t\t\tfor (const workspace of workspaces) for (const sessionId of workspace.sessionIds) if (!result.has(sessionId)) result.set(sessionId, workspace.title);
\t\t\t\treturn result;
\t\t\t}, [workspaces]);
\t\t\tconst archiveSnippets = (0, react.useMemo)(() => new Map(archiveSearch.items.map((item) => [item.sessionId, item.snippet])), [archiveSearch.items]);
\t\t\tconst archiveRows = (0, react.useMemo)(() => {
\t\t\t\tconst query = normalizedArchiveQuery.toLowerCase();
\t\t\t\tconst remoteIds = new Set(archiveSearch.items.map((item) => item.sessionId));
\t\t\t\tconst rows = archivedSessionIds.map((sessionId) => {
\t\t\t\t\tconst summary = archiveSessionList.byId[sessionId];
\t\t\t\t\treturn {
\t\t\t\t\t\tid: sessionId,
\t\t\t\t\t\ttitle: summary === void 0 ? sessionId : sessionTitle(summary),
\t\t\t\t\t\tworkspace: archiveWorkspaceBySession.get(sessionId) ?? t("group.ungrouped"),
\t\t\t\t\t\tupdatedAt: summary?.updatedAt ?? 0
\t\t\t\t\t};
\t\t\t\t});
\t\t\t\trows.sort((a, b) => b.updatedAt - a.updatedAt);
\t\t\t\tif (query === "") return rows;
\t\t\t\treturn rows.filter((row) => row.title.toLowerCase().includes(query) || row.workspace.toLowerCase().includes(query) || remoteIds.has(row.id));
\t\t\t}, [archiveSessionList, archivedSessionIds, archiveSearch.items, archiveWorkspaceBySession, normalizedArchiveQuery, t]);
\t\t\tconst onArchiveRestore = (sessionId) => {
\t\t\t\tif (archiveBusyId !== null) return;
\t\t\t\tsetArchiveBusyId(sessionId);
\t\t\t\tsetArchiveError(null);
\t\t\t\trestoreSession(sessionId).then(() => setArchiveBusyId(null)).catch((reason) => {
\t\t\t\t\tsetArchiveBusyId(null);
\t\t\t\t\tsetArchiveError(reason instanceof Error ? reason.message : String(reason));
\t\t\t\t});
\t\t\t};
\t\t\tconst [sessionDeleteTarget, setSessionDeleteTarget] = (0, react.useState)(null);`,
    'archive manager state',
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
    'children: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {',
    `children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
\t\t\t\t\t\t\t\t\tlabel: t("archive.manager.title"),
\t\t\t\t\t\t\t\t\tside: "bottom",
\t\t\t\t\t\t\t\t\tdelayMs: 500,
\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\t\t\tid: "archived-sessions",
\t\t\t\t\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.iconButton,
\t\t\t\t\t\t\t\t\t\t"aria-label": t("archive.manager.title"),
\t\t\t\t\t\t\t\t\t\tonClick: () => { setArchiveError(null); setArchiveManagerOpen(true); },
\t\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: wide ? 16 : 18 })
\t\t\t\t\t\t\t\t\t})
\t\t\t\t\t\t\t\t}), wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {`,
    'archive manager header action',
  )
  patch(
    `\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n`,
    `\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
\t\t\t\t\t\topen: archiveManagerOpen,
\t\t\t\t\t\tonClose: () => { if (archiveBusyId === null) setArchiveManagerOpen(false); },
\t\t\t\t\t\tcloseLabel: t("close"),
\t\t\t\t\t\ttitle: t("archive.manager.title"),
\t\t\t\t\t\tdescription: t("archive.manager.description", { n: archivedSessionIds.length }),
\t\t\t\t\t\tfooter: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\tdisabled: archiveBusyId !== null,
\t\t\t\t\t\t\tonClick: () => setArchiveManagerOpen(false),
\t\t\t\t\t\t\tchildren: t("close")
\t\t\t\t\t\t}),
\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("input", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameInput,
\t\t\t\t\t\t\ttype: "search",
\t\t\t\t\t\t\tvalue: archiveQuery,
\t\t\t\t\t\t\tmaxLength: SEARCH_QUERY_MAX_CODE_UNITS,
\t\t\t\t\t\t\tplaceholder: t("archive.manager.searchPlaceholder"),
\t\t\t\t\t\t\t"aria-label": t("archive.manager.searchPlaceholder"),
\t\t\t\t\t\t\tonChange: (event) => { setArchiveQuery(event.target.value); setArchiveError(null); }
\t\t\t\t\t\t}), archiveSearch.status === "loading" && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteStatus,
\t\t\t\t\t\t\trole: "status",
\t\t\t\t\t\t\tstyle: { marginTop: 8 },
\t\t\t\t\t\t\tchildren: t("archive.manager.searching")
\t\t\t\t\t\t}), archiveSearch.status === "error" && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameError,
\t\t\t\t\t\t\trole: "status",
\t\t\t\t\t\t\tchildren: t("archive.manager.searchUnavailable")
\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tstyle: { display: "flex", flexDirection: "column", gap: 8, maxHeight: "52vh", overflowY: "auto", marginTop: 12 },
\t\t\t\t\t\t\tchildren: archiveRows.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteStatus,
\t\t\t\t\t\t\t\tchildren: normalizedArchiveQuery === "" ? t("archive.manager.empty") : t("archive.manager.noMatches")
\t\t\t\t\t\t\t}) : archiveRows.map((row) => (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\tstyle: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8 },
\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\t\tstyle: { minWidth: 0 },
\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\t\t\tstyle: { color: "var(--dsw-alias-label-primary)", fontSize: 13, fontWeight: 500, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: "18px" },
\t\t\t\t\t\t\t\t\t\tchildren: row.title
\t\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\t\t\tstyle: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginTop: 2 },
\t\t\t\t\t\t\t\t\t\tchildren: row.workspace
\t\t\t\t\t\t\t\t\t}), archiveSnippets.has(row.id) && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\t\t\tstyle: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px", marginTop: 6 },
\t\t\t\t\t\t\t\t\t\tchildren: archiveSnippets.get(row.id)
\t\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\t\tstyle: { display: "flex", justifyContent: "flex-end", gap: 8 },
\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\t\t\tstyle: { minHeight: 28, height: 28, paddingInline: 10, fontSize: 12 },
\t\t\t\t\t\t\t\t\tdisabled: archiveBusyId !== null,
\t\t\t\t\t\t\t\t\tonClick: () => onArchiveRestore(row.id),
\t\t\t\t\t\t\t\t\tchildren: archiveBusyId === row.id ? t("archive.manager.restoring") : t("archive.manager.restore")
\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteAction,
\t\t\t\t\t\t\t\t\tstyle: { minHeight: 28, height: 28, paddingInline: 10, fontSize: 12 },
\t\t\t\t\t\t\t\t\tdisabled: archiveBusyId !== null,
\t\t\t\t\t\t\t\t\tonClick: () => onSessionDelete(row.id, row.title),
\t\t\t\t\t\t\t\t\tchildren: t("archive.manager.delete")
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t}, row.id))
\t\t\t\t\t\t}), archiveSearch.hasMore && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteStatus,
\t\t\t\t\t\t\tstyle: { marginTop: 8 },
\t\t\t\t\t\t\tchildren: t("archive.manager.hasMore")
\t\t\t\t\t\t}), archiveError !== null && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameError,
\t\t\t\t\t\t\trole: "alert",
\t\t\t\t\t\t\tchildren: archiveError
\t\t\t\t\t\t})]
\t\t\t\t\t}),
\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
\t\t\t\t\t\topen: deleteTarget !== null,
`,
    'archive manager modal',
  )
  patch(
    `\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n`,
    `\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: sessionDeleteTarget !== null,\n\t\t\t\t\t\tonClose: closeSessionDelete,\n\t\t\t\t\t\tcloseLabel: t("close"),\n\t\t\t\t\t\ttitle: t("delete.session.title"),\n\t\t\t\t\t\t...sessionDeleteTarget === null ? {} : { description: t("delete.session.desc", { name: sessionDeleteTarget.title }) },\n\t\t\t\t\t\tfooter: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {\n\t\t\t\t\t\t\tvariant: "outline",\n\t\t\t\t\t\t\tdisabled: sessionDeleting,\n\t\t\t\t\t\t\tonClick: closeSessionDelete,\n\t\t\t\t\t\t\tchildren: t("cancel")\n\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {\n\t\t\t\t\t\t\tvariant: "outline",\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteAction,\n\t\t\t\t\t\t\tdisabled: sessionDeleting,\n\t\t\t\t\t\t\tonClick: confirmSessionDelete,\n\t\t\t\t\t\t\tchildren: t("delete.session.confirm")\n\t\t\t\t\t\t})] }),\n\t\t\t\t\t\tchildren: [sessionDeleting && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.deleteStatus,\n\t\t\t\t\t\t\trole: "status",\n\t\t\t\t\t\t\tchildren: t("delete.session.pending")\n\t\t\t\t\t\t}), sessionDeleteError !== null && (0, react_jsx_runtime.jsx)("div", {\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameError,\n\t\t\t\t\t\t\trole: "alert",\n\t\t\t\t\t\t\tchildren: sessionDeleteError\n\t\t\t\t\t\t})]\n\t\t\t\t\t}),\n\t\t\t\t\t(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: deleteTarget !== null,\n`,
    'session delete confirmation modal',
  )
  patch(
    '\t\t\t"menu.archiveSession": "归档会话",\n',
    '\t\t\t"menu.archiveSession": "归档会话",\n\t\t\t"archive.manager.title": "归档会话",\n\t\t\t"archive.manager.description": "共 {n} 个归档会话。可按名称、工作区或聊天内容搜索。",\n\t\t\t"archive.manager.searchPlaceholder": "搜索归档名称、工作区或聊天内容…",\n\t\t\t"archive.manager.searching": "正在搜索归档聊天记录…",\n\t\t\t"archive.manager.searchUnavailable": "内容搜索暂不可用，仅显示名称与工作区匹配。",\n\t\t\t"archive.manager.empty": "暂无归档会话",\n\t\t\t"archive.manager.noMatches": "没有匹配的归档会话",\n\t\t\t"archive.manager.hasMore": "仅显示前 20 条内容匹配，请缩小搜索范围。",\n\t\t\t"archive.manager.restore": "恢复",\n\t\t\t"archive.manager.restoring": "恢复中…",\n\t\t\t"archive.manager.delete": "永久删除",\n\t\t\t"menu.deleteSession": "删除会话",\n\t\t\t"delete.session.title": "永久删除会话？",\n\t\t\t"delete.session.desc": "“{name}”的会话记录将从本机永久删除，且无法恢复。正在运行的任务会先安全停止。",\n\t\t\t"delete.session.confirm": "永久删除",\n\t\t\t"delete.session.pending": "正在永久删除会话…",\n',
    'Chinese delete locale',
  )
  patch(
    '\t\t\t"menu.archiveSession": "Archive session",\n',
    '\t\t\t"menu.archiveSession": "Archive session",\n\t\t\t"archive.manager.title": "Archived sessions",\n\t\t\t"archive.manager.description": "{n} archived sessions. Search by name, workspace, or conversation content.",\n\t\t\t"archive.manager.searchPlaceholder": "Search archived names, workspaces, or conversation content…",\n\t\t\t"archive.manager.searching": "Searching archived conversation history…",\n\t\t\t"archive.manager.searchUnavailable": "Content search is temporarily unavailable. Showing name and workspace matches.",\n\t\t\t"archive.manager.empty": "No archived sessions",\n\t\t\t"archive.manager.noMatches": "No matching archived sessions",\n\t\t\t"archive.manager.hasMore": "Showing the first 20 content matches. Narrow your search.",\n\t\t\t"archive.manager.restore": "Restore",\n\t\t\t"archive.manager.restoring": "Restoring…",\n\t\t\t"archive.manager.delete": "Delete permanently",\n\t\t\t"menu.deleteSession": "Delete session",\n\t\t\t"delete.session.title": "Permanently delete session?",\n\t\t\t"delete.session.desc": "The local record for “{name}” will be permanently deleted and cannot be recovered. Running work will be stopped safely before deletion.",\n\t\t\t"delete.session.confirm": "Delete permanently",\n\t\t\t"delete.session.pending": "Permanently deleting session…",\n',
    'English delete locale',
  )
  patch(
    `\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},\n`,
    `\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},\n\t\t\t\tdeleteSession: async (sessionId) => {\n\t\t\t\t\tconst response = await fetch("/plugins/dsh-session-delete/delete", {\n\t\t\t\t\t\tmethod: "POST",\n\t\t\t\t\t\theaders: {\n\t\t\t\t\t\t\t"content-type": "application/json",\n\t\t\t\t\t\t\t"x-dsh-session-delete-confirmation": "delete-session"\n\t\t\t\t\t\t},\n\t\t\t\t\t\tbody: JSON.stringify({ sessionId })\n\t\t\t\t\t});\n\t\t\t\t\tconst payload = await response.json().catch(() => null);\n\t\t\t\t\tif (!response.ok || payload?.ok !== true) {\n\t\t\t\t\t\tthrow new Error(payload?.error?.message ?? \`Delete failed (HTTP \${response.status})\`);\n\t\t\t\t\t}\n\t\t\t\t\tif (ctx.sessions.list.getSnapshot().current === sessionId) ctx.sessions.clear();\n\t\t\t\t\tconst refreshes = await Promise.allSettled([\n\t\t\t\t\t\tctx.sessions.refresh(),\n\t\t\t\t\t\tctx.workspaces.refresh()\n\t\t\t\t\t]);\n\t\t\t\t\tfor (const refresh of refreshes) {\n\t\t\t\t\t\tif (refresh.status === "rejected") console.warn("session deletion succeeded but runtime refresh failed:", refresh.reason);\n\t\t\t\t\t}\n\t\t\t\t},\n`,
    'browser delete request',
  )
  patch(
    '\t\t\t\tinsertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {\n',
    `\t\t\t\trestoreSession: async (sessionId) => {
\t\t\t\t\tconst response = await fetch("/plugins/dsh-session-delete/restore", {
\t\t\t\t\t\tmethod: "POST",
\t\t\t\t\t\theaders: {
\t\t\t\t\t\t\t"content-type": "application/json",
\t\t\t\t\t\t\t"x-dsh-session-manager-action": "restore-session"
\t\t\t\t\t\t},
\t\t\t\t\t\tbody: JSON.stringify({ sessionId })
\t\t\t\t\t});
\t\t\t\t\tconst payload = await response.json().catch(() => null);
\t\t\t\t\tif (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? \`Restore failed (HTTP \${response.status})\`);
\t\t\t\t\tconst refreshes = await Promise.allSettled([ctx.sessions.refresh(), ctx.workspaces.refresh()]);
\t\t\t\t\tfor (const refresh of refreshes) if (refresh.status === "rejected") console.warn("session restore succeeded but runtime refresh failed:", refresh.reason);
\t\t\t\t},
\t\t\t\tsearchArchivedSessions: async (query, signal) => {
\t\t\t\t\tconst response = await fetch("/plugins/dsh-session-delete/archive-search", {
\t\t\t\t\t\tmethod: "POST",
\t\t\t\t\t\theaders: { "content-type": "application/json" },
\t\t\t\t\t\tbody: JSON.stringify({ query }),
\t\t\t\t\t\tsignal
\t\t\t\t\t});
\t\t\t\t\tconst payload = await response.json().catch(() => null);
\t\t\t\t\tif (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? \`Archived search failed (HTTP \${response.status})\`);
\t\t\t\t\treturn payload.value;
\t\t\t\t},
\t\t\t\tinsertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
`,
    'browser archive manager requests',
  )
  const homePathCall = '(0, _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath)(row.cwd, home)'
  if (source.includes(homePathCall)) {
    patch(
      homePathCall,
      'typeof _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath === "function" ? (0, _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath)(row.cwd, home) : row.cwd',
      'home path compatibility fallback',
    )
  }

  const notice = `// Modified from @deepseek-ai/dsh-client-ui-workspace ${upstreamVersion} by DSH Native Session Manager. See THIRD_PARTY_NOTICES.md.\n`
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
