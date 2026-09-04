import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  composeCompatibleClients,
  patchWorkspaceClient,
  resolveUpstreamClient,
  resolveUpstreamManifest,
} from '../scripts/build-client.mjs'

const require = createRequire(import.meta.url)
const compatibility = JSON.parse(await readFile(new URL('../compatibility.json', import.meta.url), 'utf8'))

test('one client artifact selects stable or preview implementation from the runtime module table', () => {
  const moduleSource = (label, dependency) => `window.__ModuleLoader__.load({\n\tid: "dsh-chat-manager",\n\tfactory: (require) => {\n\t\tconst value = require("${dependency}");\n\t\treturn { label: "${label}", value };\n\t}\n});\n`
  const artifact = composeCompatibleClients(
    moduleSource('stable', '@deepseek-ai/dsh-client-runtime/client'),
    moduleSource('preview', '@deepseek-ai/dsh-client-store'),
  )
  let factory
  const run = modules => {
    new Function('window', artifact)({ __ModuleLoader__: { load(definition) { factory = definition.factory } } })
    return factory(name => {
      if (!Object.hasOwn(modules, name)) throw new Error(`client-modules: require("${name}") missed the module table`)
      return modules[name]
    })
  }

  assert.equal(run({ '@deepseek-ai/dsh-client-runtime/client': 'stable-runtime' }).label, 'stable')
  assert.equal(run({ '@deepseek-ai/dsh-client-store': 'preview-store' }).label, 'preview')
  assert.equal(artifact.match(/id: "dsh-chat-manager"/g)?.length, 1)
})

test('patches the official workspace client with a native confirmed delete flow', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.match(patched, new RegExp(`^// Modified from @deepseek-ai/dsh-client-ui-workspace ${compatibility.latestTested.replaceAll('.', '\\.')}`))
  assert.match(patched, /id: "dsh-chat-manager"/)
  assert.doesNotMatch(patched, /id: "@deepseek-ai\/dsh-client-ui-workspace"/)
  assert.match(patched, /id: "delete-session"/)
  assert.match(patched, /id: "delete-session",[\s\S]{0,240}danger: true/)
  assert.match(patched, /menu\.deleteSession/)
  assert.match(patched, /"menu\.deleteSession": "删除会话"/)
  assert.match(patched, /"menu\.deleteSession": "Delete session"/)
  assert.doesNotMatch(patched, /"menu\.deleteSession": "(?:删除会话|Delete session)…"/)
  assert.match(patched, /delete\.session\.confirm/)
  assert.match(patched, /x-dsh-session-delete-confirmation/)
  assert.match(patched, /\/plugins\/dsh-session-delete\/delete/)
  assert.match(patched, /Running work will be stopped safely before deletion/)
  assert.match(patched, /正在运行的任务会先安全停止/)
  assert.doesNotMatch(patched, /already-opened sessions are refused/)
  assert.doesNotMatch(patched, /本次已打开的会话不会被删除/)
  assert.match(patched, /id: "archive"/)
})

test('keeps the legacy runtime implementation for pre-0.1.2 hosts', async () => {
  const legacyFixture = compatibility.legacyWorkspaceFixture
  const legacyVersion = Object.entries(compatibility.workspaceFixtures)
    .find(([, fixture]) => fixture === legacyFixture)?.[0]
  const source = await readFile(require.resolve(`${legacyFixture}/client`), 'utf8')
  const patched = patchWorkspaceClient(source, legacyVersion)

  assert.match(patched, /typeof _deepseek_ai_dsh_client_runtime_client\.abbreviateHomePath === "function"/)
})

test('settles a successful deletion in place without reloading the WebView', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.doesNotMatch(patched, /window\.location\.reload/)
  assert.match(patched, /ctx\.sessions\.clear\(\)/)
  assert.match(patched, /ctx\.sessions\.refresh\(\)/)
  assert.match(patched, /ctx\.workspaces\.refresh\(\)/)
  assert.match(patched, /setSessionDeleteTarget\(null\)/)
  assert.doesNotMatch(patched, /const wasCurrent/)
  assert.match(patched, /if \(ctx\.sessions\.list\.getSnapshot\(\)\.current === sessionId\) ctx\.sessions\.clear\(\)/)
})

test('adds a native archived-session manager with metadata and history search', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.match(patched, /id: "archived-sessions"/)
  assert.match(patched, /archive\.manager\.title/)
  assert.match(patched, /archive\.manager\.searchPlaceholder/)
  assert.match(patched, /\/plugins\/dsh-session-delete\/archive-search/)
  assert.match(patched, /\/plugins\/dsh-session-delete\/restore/)
  assert.match(patched, /x-dsh-session-manager-action/)
  assert.match(patched, /ctx\.workspaces\.refresh\(\)/)
  assert.match(patched, /ctx\.sessions\.refresh\(\)/)
  assert.doesNotMatch(patched, /window\.location\.reload/)
})

test('keeps archive, view options, and add workspace actions visible together', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.match(patched, /_headerActions\{[^}]*max-width:92px/)
  assert.doesNotMatch(patched, /_headerActions\{[^}]*max-width:60px/)
  const headerActions = patched.indexOf('WorkspaceBrowser_module_css_default.headerActions')
  const archiveAction = patched.indexOf('id: "archived-sessions"', headerActions)
  const viewOptions = patched.indexOf('wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu', archiveAction)
  const addWorkspace = patched.indexOf('"aria-label": t("workspace.add")', viewOptions)
  assert.ok(headerActions >= 0 && headerActions < archiveAction)
  assert.ok(archiveAction < viewOptions)
  assert.ok(viewOptions < addWorkspace)
})

test('archive cards preserve title width and keep actions compact below metadata', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.match(patched, /borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8/)
  assert.match(patched, /fontWeight: 500, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: "18px"/)
  assert.match(patched, /display: "flex", justifyContent: "flex-end", gap: 8/)
  assert.match(patched, /minHeight: 28, height: 28, paddingInline: 10, fontSize: 12/)
})

test('refuses to silently patch an unknown upstream client shape', () => {
  assert.throws(() => patchWorkspaceClient('unknown upstream'), /upstream marker/)
})

test('refuses a renamed upstream component even when its prop fragment is unchanged', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const renamed = source.replace('function SessionTree(', 'function FutureSessionTree(')

  assert.throws(() => patchWorkspaceClient(renamed), /SessionTree signature/)
})

test('build dependency is pinned to the supported upstream workspace version', async () => {
  const manifest = JSON.parse(await readFile(resolveUpstreamManifest(), 'utf8'))
  assert.equal(manifest.name, '@deepseek-ai/dsh-client-ui-workspace')
  assert.equal(manifest.version, compatibility.latestTested)
})

for (const [version, alias] of Object.entries(compatibility.workspaceFixtures)) {
  test(`native patch markers remain compatible with ${version}`, async () => {
    const source = await readFile(require.resolve(`${alias}/client`), 'utf8')
    const patched = patchWorkspaceClient(source, version)

    assert.match(patched, new RegExp(`^// Modified from @deepseek-ai/dsh-client-ui-workspace ${version.replaceAll('.', '\\.')}`))
    assert.match(patched, /id: "delete-session",[\s\S]{0,240}danger: true/)
    assert.match(patched, /_headerActions\{[^}]*max-width:92px/)
    assert.match(patched, /ctx\.sessions\.refresh\(\)/)
    assert.doesNotMatch(patched, /window\.location\.reload/)
  })
}
