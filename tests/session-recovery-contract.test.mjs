import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8')

test('package identity and bundle expose only the session recovery component', async () => {
  const [manifest, patch] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('cordis.patch.yml'),
  ])
  assert.equal(manifest.name, 'dsh-chat-manager')
  assert.equal(manifest.version, '1.3.0-beta.0')
  assert.deepEqual(manifest.files.filter(name => /delete|archive-manager/.test(name)), [])
  assert.match(patch, /name:\s*dsh-chat-manager/)
  assert.match(patch, /id:\s*ui-workspace-session-delete/)
  assert.doesNotMatch(patch, /id:\s*ui-workspace\b[\s\S]*disabled:\s*true/)
})

test('client contributes a recovery tab without replacing the official workspace UI', async () => {
  const [client, host] = await Promise.all([
    read('src/client.jsx'),
    read('src/index.js'),
  ])
  assert.match(client, /settings\.plugins\.tab/)
  assert.match(client, /SessionRecoverySettingsTab/)
  assert.match(client, /\/plugins\/dsh-chat-manager\/restore/)
  assert.match(client, /archivedSessionIds/)
  assert.match(client, /sessions\.list/)
  assert.match(client, /workspaces\.list/)
  assert.doesNotMatch(`${client}\n${host}`, /delete-session|permanent.delete|archive-search|searchArchivedSessions/i)
})
