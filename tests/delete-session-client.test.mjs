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

test('patches the official workspace client with a native confirmed delete flow', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const patched = patchWorkspaceClient(source)

  assert.match(patched, /^\/\/ Modified from @deepseek-ai\/dsh-client-ui-workspace 0\.1\.0-rc\.8/)
  assert.match(patched, /id: "@deepseek-ai\/dsh-client-ui-workspace"/)
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
  assert.doesNotMatch(patched, /id: "dsh-session-delete"/)
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

test('refuses to silently patch an unknown upstream client shape', () => {
  assert.throws(() => patchWorkspaceClient('unknown upstream'), /upstream marker/)
})

test('refuses a renamed upstream component even when its prop fragment is unchanged', async () => {
  const source = await readFile(resolveUpstreamClient(), 'utf8')
  const renamed = source.replace('function SessionTree(', 'function FutureSessionTree(')

  assert.throws(() => patchWorkspaceClient(renamed), /session tree props/)
})

test('build dependency is pinned to the supported upstream workspace version', async () => {
  const manifest = JSON.parse(await readFile(resolveUpstreamManifest(), 'utf8'))
  assert.equal(manifest.name, '@deepseek-ai/dsh-client-ui-workspace')
  assert.equal(manifest.version, '0.1.0-rc.8')
})

test('native patch markers remain compatible with the Portable rc.6 workspace client', async () => {
  const source = await readFile(require.resolve('dsh-ui-workspace-rc6/client'), 'utf8')
  const patched = patchWorkspaceClient(source, '0.1.0-rc.6')

  assert.match(patched, /^\/\/ Modified from @deepseek-ai\/dsh-client-ui-workspace 0\.1\.0-rc\.6/)
  assert.match(patched, /id: "delete-session",[\s\S]{0,240}danger: true/)
  assert.match(patched, /"menu\.deleteSession": "删除会话"/)
  assert.match(patched, /ctx\.sessions\.refresh\(\)/)
  assert.doesNotMatch(patched, /window\.location\.reload/)
})

test('native patch markers remain compatible with the installed rc.7 workspace client', async () => {
  const source = await readFile(require.resolve('dsh-ui-workspace-rc7/client'), 'utf8')
  const patched = patchWorkspaceClient(source, '0.1.0-rc.7')

  assert.match(patched, /^\/\/ Modified from @deepseek-ai\/dsh-client-ui-workspace 0\.1\.0-rc\.7/)
  assert.match(patched, /id: "delete-session",[\s\S]{0,240}danger: true/)
  assert.match(patched, /ctx\.sessions\.refresh\(\)/)
  assert.doesNotMatch(patched, /window\.location\.reload/)
})
