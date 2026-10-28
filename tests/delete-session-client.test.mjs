import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildOfficialSlotClient } from '../scripts/official-session-actions.mjs'

test('v2 client contributes only public slots and public store operations', () => {
  const source = buildOfficialSlotClient()
  for (const slot of ['sidebar.workspaces.session.menu.item', 'shell.overlay', 'settings.section']) assert.ok(source.includes(slot))
  assert.match(source, /dsh-chat-manager\.archive-search/)
  assert.match(source, /ctx\.workspaces\.unarchiveSession/)
  assert.doesNotMatch(source, /clearMain|\.selection|sessions\.clear|__DSH_PORTABLE_SETTINGS__|settings-ready|header\.action|new UiWorkspaceService|stableFactory|previewFactory|modernFactory/)
})

test('build entry never reads or copies an upstream workspace bundle', async () => {
  const source = await readFile(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /readFile|require\.resolve|patchWorkspace|composeCompatible|build-modern/)
  assert.match(source, /writeFile\(target, buildOfficialSlotClient\(\)/)
})
