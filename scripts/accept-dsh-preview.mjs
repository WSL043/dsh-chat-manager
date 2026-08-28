import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { patchWorkspaceClient } from './build-client.mjs'

const sourceRoot = process.argv.slice(2).find(value => value !== '--') ?? process.env.DSH_PREVIEW_SOURCE_ROOT
if (sourceRoot === undefined || sourceRoot.trim() === '') {
  throw new Error('usage: pnpm accept:preview -- <deepseek-harness source root>')
}

const root = resolve(sourceRoot)
const compatibility = JSON.parse(await readFile(new URL('../compatibility.json', import.meta.url), 'utf8'))
const manifestPath = resolve(root, 'packages/client/ui-workspace/package.json')
const clientPath = resolve(root, 'packages/client/ui-workspace/lib/client.js')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

assert.equal(manifest.name, '@deepseek-ai/dsh-client-ui-workspace')
assert.ok(compatibility.previews.includes(manifest.version), `unreviewed DSH preview ${String(manifest.version)}`)

const patched = patchWorkspaceClient(await readFile(clientPath, 'utf8'), manifest.version)
assert.match(patched, /id: "dsh-chat-manager"/)
assert.match(patched, /require\("@deepseek-ai\/dsh-client-store"\)/)
assert.doesNotMatch(patched, /require\("@deepseek-ai\/dsh-client-runtime\/client"\)/)
assert.match(patched, /id: "delete-session"/)
assert.match(patched, /id: "archived-sessions"/)
assert.match(patched, /typeof ctx\.workspaces\.refresh === "function"/)
assert.doesNotMatch(patched, /dsh-css:[^\r\n]*?[\\/]packages[\\/]client[\\/]ui-workspace/)
assert.match(patched, /dcmRows_projectRow/)
assert.match(patched, /dcmPicker_/)
assert.match(patched, /dcmBrowser_root/)

process.stdout.write(`DSH preview ${manifest.version}: Chat Manager client patch accepted\n`)
