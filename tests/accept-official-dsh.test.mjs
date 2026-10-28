import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { parseOfficialAcceptanceArgs, buildAcceptanceFixtureSource, waitForAcceptanceFixture, sanitizeAcceptanceDiagnostic } from '../scripts/accept-official-dsh.mjs'
import { ARCHIVE_SETTINGS_ID, archiveActionPattern, openPluginManager } from '../scripts/accept-modern-official.mjs'

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
  assert.match(source, /ctx\.sessionTitle\.rename\(handle\.agent\.session, spec\.title\)/)
  assert.match(source, /inject = \[[^\]]*'sessionTitle'/)
  assert.doesNotMatch(source, /session\.append\('session\/title'/)
  assert.match(source, /inject = \[[^\]]*'agentLoop'/)
  assert.match(source, /phase: 'applying'/)
  assert.match(source, /phase: 'ready'/)
  assert.match(source, /phase: 'failed'/)
  assert.match(source, /handle\.dispose\(\)/)
  assert.match(source, /stopActivity: true/)
  assert.match(source, /if \(key === 'cold' \|\| key === 'neighbor' \|\| key === 'idle'\) \{\s*handle\.agent\.followup\(message\(spec\.prompt\)\)\s*await handle\.agent\.whenIdle\(\)/)
  assert.match(source, /if \(key === 'cold' \|\| key === 'neighbor'\) \{\s*await handle\.dispose\(\)/)
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

async function readinessFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'chat-v2-ready-unit-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const config = { nonce: 'synthetic-ready-nonce', statePath: join(base, 'fixture-state.json'), statusPath: join(base, 'fixture-status.json'), sessionRoot: join(base, 'sessions'), sessions: {} }
  const snapshot = { fixtures: {}, states: {} }
  for (const key of ['cold', 'neighbor', 'idle', 'running']) {
    const spec = { id: key + '-synthetic', title: key + ' fixture', prompt: key + ' probe' }
    config.sessions[key] = spec
    const transcriptPath = join(config.sessionRoot, key, 'session.v3.jsonl')
    await mkdir(join(config.sessionRoot, key), { recursive: true }); await writeFile(transcriptPath, 'synthetic unit bytes')
    snapshot.fixtures[key] = { ...spec, transcriptPath }
    const cold = key === 'cold' || key === 'neighbor'
    snapshot.states[key] = { agentStatus: cold ? null : 'idle', sessionLoaded: !cold, archived: cold }
  }
  return { config, snapshot }
}

test('fixture readiness waits for the explicit complete marker and all four generated host states', async t => {
  const { config, snapshot } = await readinessFixture(t)
  await writeFile(config.statusPath, JSON.stringify({ phase: 'applying' }))
  const publishing = (async () => { await new Promise(resolve => setTimeout(resolve, 20)); await writeFile(config.statePath, JSON.stringify(snapshot)); await writeFile(config.statusPath, JSON.stringify({ phase: 'ready' })) })()
  const [ready] = await Promise.all([waitForAcceptanceFixture(config, { child: { exitCode: null }, timeoutMs: 1000 }), publishing])
  assert.deepEqual(ready, snapshot)
})

test('fixture errors and process exits propagate before readiness instead of accepting server URL', async t => {
  const { config } = await readinessFixture(t)
  await writeFile(config.statusPath, JSON.stringify({ phase: 'failed', error: 'create failed at https://127.0.0.1:1/?token=private-token nonce=' + config.nonce }))
  await assert.rejects(waitForAcceptanceFixture(config, { timeoutMs: 100 }), error => {
    assert.match(error.message, /fixture initialization failed: create failed/)
    assert.doesNotMatch(error.message, /private-token|synthetic-ready-nonce/); return true
  })
  await assert.rejects(waitForAcceptanceFixture(config, { child: { exitCode: 23 }, timeoutMs: 100 }), /exited before fixture readiness.*23/)
})

test('a missing marker, incomplete state, nonisolated path or incorrect loaded state never passes readiness', async t => {
  const { config, snapshot } = await readinessFixture(t)
  await assert.rejects(waitForAcceptanceFixture(config, { timeoutMs: 60 }), /timed out.*phase=not-started/)
  await writeFile(config.statusPath, JSON.stringify({ phase: 'ready' }))
  for (const fault of ['missing-neighbor', 'outside-root', 'loaded-cold', 'premature-running']) {
    const invalid = structuredClone(snapshot)
    if (fault === 'missing-neighbor') delete invalid.fixtures.neighbor
    if (fault === 'outside-root') invalid.fixtures.cold.transcriptPath = config.statePath
    if (fault === 'loaded-cold') invalid.states.cold.sessionLoaded = true
    if (fault === 'premature-running') invalid.states.running.agentStatus = 'running'
    await writeFile(config.statePath, JSON.stringify(invalid))
    await assert.rejects(waitForAcceptanceFixture(config, { timeoutMs: 100 }), /ready fixture/, fault)
  }
})

test('fixture installation declares a real bundle and diagnostics redact nonce, credentials and URL queries', async () => {
  const source = await readFile(new URL('../scripts/accept-official-dsh.mjs', import.meta.url), 'utf8')
  assert.match(source, /dsh: \{ bundle: \{ patch: '\.\/cordis\.patch\.yml'/)
  assert.match(source, /id: chat-manager-acceptance-fixture/)
  assert.match(source, /installed as a plain dependency, not a profile layer/)
  assert.match(source, /await waitForAcceptanceFixture\(config, \{ child: server \}\)/)
  const safe = sanitizeAcceptanceDiagnostic('nonce=synthetic-ready-nonce https://127.0.0.1:1/?token=private-token&other=secret Cookie: "sid=cookie-secret" Authorization: Bearer bearer-secret', ['synthetic-ready-nonce'])
  assert.doesNotMatch(safe, /synthetic-ready-nonce|private-token|other=secret|cookie-secret|bearer-secret/)
  assert.match(safe, /https:\/\/127\.0\.0\.1:1\//)
})


test('HMR navigation opens the official sidebar manager, Installed tab and exact package switch', async () => {
  const calls = []
  const toggle = { waitFor: async () => calls.push('switch-visible') }
  const panel = { waitFor: async () => calls.push('panel-visible'), count: async () => 1,
    getByRole: (role, options) => { assert.equal(role, 'tab'); assert.equal(options.name.test('Installed'), true); return { count: async () => 1, click: async () => calls.push('installed-click') } },
    locator: selector => { assert.equal(selector, '[data-plugin-package="dsh-chat-manager"]'); return { getByRole: role => { assert.equal(role, 'switch'); return toggle } } },
  }
  const page = { getByRole: (role, options) => {
    if (role === 'dialog') return { isVisible: async () => false }
    assert.equal(role, 'button'); assert.equal(options.name.test('Plugins'), true)
    return { waitFor: async () => {}, count: async () => 1, click: async () => calls.push('sidebar-click') }
  }, locator: selector => { assert.equal(selector, '[data-plugin-panel]'); return panel }, waitForFunction: async () => calls.push('panel-ready') }
  assert.equal(await openPluginManager(page), panel)
  assert.deepEqual(calls, ['sidebar-click', 'panel-visible', 'panel-ready', 'installed-click', 'switch-visible'])
  const source = await readFile(new URL('../scripts/accept-modern-official.mjs', import.meta.url), 'utf8')
  assert.match(source, /const plugins = await openPluginManager\(page\)/)
  assert.match(source, /contribution\.waitFor\(\{ state: wasEnabled \? 'detached' : 'visible' \}\)/)
  assert.match(source, /await row\(fixtures\.idle\)\.click\(\)/)
  assert.doesNotMatch(source, /openSettingsSection\(page, \/\^\(Plugins/)
})

test('Windows cmd runner preserves spaced paths with Node-style outer quotes and verbatim arguments', async () => {
  const source = await readFile(new URL('../scripts/accept-official-dsh.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function spawnPortable('), end = source.indexOf('function run(', start)
  let captured
  const spawn = (...args) => { captured = args; return { synthetic: true } }
  const context = { spawn, process: { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } } }
  const invoke = vm.runInNewContext(source.slice(start, end) + '; spawnPortable', context)
  invoke('C:\\Program Files\\pnpm\\pnpm.cmd', ['plugin', '--package', 'D:\\Fixture With Spaces\\candidate.tgz'], { windowsHide: true })
  assert.equal(captured[0], 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(Array.from(captured[1]).slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(captured[1][3], '""C:\\Program Files\\pnpm\\pnpm.cmd" plugin --package "D:\\Fixture With Spaces\\candidate.tgz""')
  assert.equal(captured[2].shell, false); assert.equal(captured[2].windowsVerbatimArguments, true); assert.equal(captured[2].windowsHide, true)
  assert.throws(() => invoke('pnpm.cmd', ['bad&argument'], {}), /unsafe Windows command argument/)
})
