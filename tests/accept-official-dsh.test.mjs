import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parseOfficialAcceptanceArgs, buildAcceptanceFixtureSource } from '../scripts/accept-official-dsh.mjs'
import { ARCHIVE_SETTINGS_ID, archiveActionPattern } from '../scripts/accept-modern-official.mjs'

test('official candidate acceptance defaults to fixed Alpha2 and requires a candidate package', () => {
  assert.deepEqual(parseOfficialAcceptanceArgs(['--package', '/synthetic/plugin.tgz']), { dshVersion: '0.2.2-alpha.2', packagePath: '/synthetic/plugin.tgz', port: 14191 })
  assert.deepEqual(parseOfficialAcceptanceArgs(['--dsh-version', '0.2.2-alpha.2', '--package', '/synthetic/plugin.tgz', '--port', '14193']), { dshVersion: '0.2.2-alpha.2', packagePath: '/synthetic/plugin.tgz', port: 14193 })
  assert.throws(() => parseOfficialAcceptanceArgs([]), /--package is required/)
  for (const version of ['next', '0.2.1-rc.4', '1.0.0']) assert.throws(() => parseOfficialAcceptanceArgs(['--dsh-version', version, '--package', '/synthetic/plugin.tgz']), /fixed 0.2.2-alpha.2/)
})

test('generated own-agent fixture is source-only and never intercepts another owner', () => {
  assert.throws(() => buildAcceptanceFixtureSource({}), /isolated fixture configuration/)
  const source = buildAcceptanceFixtureSource({ workspace: '/synthetic/workspace', statePath: '/synthetic/state.json', nonce: 'fixture-nonce', provider: 'fixture-provider', sessions: {} })
  new vm.Script('(async function(){' + source.replace(/^import[^\n]*\n/m, '').replace(/^export /gm, '') + '})')
  assert.match(source, /ctx\.agents\.create/)
  assert.match(source, /handle\.dispose\(\)/)
  assert.match(source, /stopActivity: true/)
  assert.match(source, /fixture did not reach genuine running activity/)
  assert.doesNotMatch(source, /cordis\.original|agentHandles|requireState|setState|fetch\(/)
})

test('public settings actions escape exact target names rather than using ambiguous title matching', () => {
  assert.equal(ARCHIVE_SETTINGS_ID, 'dsh-chat-manager.archive-search')
  const title = 'Fixture [one] (two) + $3?'
  assert.equal(archiveActionPattern('delete', title).test('Delete permanently ' + title), true)
  assert.equal(archiveActionPattern('restore', title).test('取消归档 ' + title), true)
  assert.equal(archiveActionPattern('delete', title).test('Delete permanently Fixture one two + $3?'), false)
  assert.throws(() => archiveActionPattern('other', title), /unknown archive action/)
})

test('real runners target public settings and keep positive deletion as an actual button click', async () => {
  const files = ['scripts/accept-modern-official.mjs', 'scripts/smoke-ui.mjs', 'scripts/accept-official-dsh.mjs']
  const sources = await Promise.all(files.map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))
  for (const source of sources) assert.doesNotMatch(source, /__DSH_PORTABLE_SETTINGS__|#archived-sessions|endpoint\('restore'\)|dsh-session-delete\/restore/)
  assert.match(sources[0], /positive target was never loaded/)
  assert.match(sources[0], /await remove\.click\(\)/)
  assert.match(sources[0], /neighbor transcript remains byte-for-byte intact/)
  assert.match(sources[0], /does not promise cancellation of already-started destructive storage work/)
  assert.match(sources[1], /simulated: options\.simulateDeleteSuccess === true/)
})
