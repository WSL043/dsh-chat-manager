import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  patchWorkspaceClient,
  resolveUpstreamClient,
  resolveUpstreamManifest,
} from '../scripts/build-client.mjs'

const require = createRequire(import.meta.url)
const compatibility = JSON.parse(await readFile(new URL('../compatibility.json', import.meta.url), 'utf8'))

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
    assert.match(patched, /ctx\.sessions\.refresh\(\)/)
    assert.doesNotMatch(patched, /window\.location\.reload/)
  })
}
