import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('public package metadata and native replacement identity remain intentional', async () => {
  const manifest = JSON.parse(await read('package.json'))

  assert.equal(manifest.name, 'dsh-session-delete')
  assert.equal(manifest.version, '0.1.10')
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.repository.url, 'git+https://github.com/WSL043/dsh-session-delete.git')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-workspace'], '0.1.0-rc.8')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-primitives'], '0.1.0-rc.8')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-slots'], '0.1.0-rc.8')
  assert.equal(manifest.devDependencies['dsh-ui-workspace-rc6'], 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.6')
  assert.equal(manifest.devDependencies['dsh-ui-workspace-rc7'], 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.7')
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8')
  }
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-connection'))
  for (const peer of Object.keys(manifest.peerDependencies)) {
    assert.equal(manifest.peerDependenciesMeta?.[peer]?.optional, true, `${peer} should be a host-provided optional peer`)
  }
  assert.equal(manifest.scripts['smoke:ui'], 'node scripts/smoke-ui.mjs')
  assert.ok(manifest.files.includes('scripts/smoke-ui.mjs'))
  assert.ok(manifest.files.includes('dsh-session-delete.ps1'))
  assert.ok(manifest.files.includes('dsh-session-delete-setup.ps1'))
  assert.ok(manifest.files.includes('THIRD_PARTY_NOTICES.md'))
})

test('dependency installs enforce a release-age gate outside the reviewed DSH cohort', async () => {
  const workspace = await read('pnpm-workspace.yaml')

  assert.match(workspace, /^minimumReleaseAge: 1440$/m)
  assert.match(workspace, /@deepseek-ai\/dsh-client-ui-workspace@0\.1\.0-rc\.8/)
  assert.doesNotMatch(workspace, /minimumReleaseAgeExclude:[\s\S]*['"]?@deepseek-ai\/\*['"]?\s*$/m)
})

test('public artifacts contain no local workspace paths', async () => {
  const files = [
    'package.json',
    'README.md',
    'README.en.md',
    'AGENTS.md',
    'src/index.js',
    'src/host/delete-session.mjs',
    'scripts/build-client.mjs',
    'scripts/smoke-ui.mjs',
    'dsh-session-delete.ps1',
    'dsh-session-delete-setup.ps1',
  ]
  const contents = (await Promise.all(files.map(read))).join('\n')

  assert.doesNotMatch(contents, /[A-Z]:[\\/]Users[\\/]/i)
  assert.doesNotMatch(contents, /Documents[\\/]Codex/i)
})

test('documentation pins the replacement slot, release asset, and second confirmation', async () => {
  const [chinese, english, agents] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('AGENTS.md'),
  ])

  for (const document of [chinese, english, agents]) {
    assert.match(document, /@deepseek-ai\/dsh-client-ui-workspace@https:\/\/github\.com\/WSL043\/dsh-session-delete\/releases\/download\/v0\.1\.10\/dsh-session-delete\.tgz/)
  }
  assert.match(chinese, /再次\s*确认/)
  assert.match(chinese, /永久删除无法撤销/)
  assert.match(chinese, /docs\/assets\/confirm-delete\.png/)
  assert.match(english, /second confirmation/i)
  assert.match(english, /permanent deletion cannot be undone/i)
  assert.match(english, /docs\/assets\/confirm-delete\.en\.png/)
  assert.match(agents, /Never delete a session as an installation test/)
  assert.match(agents, /not strictly read-only/i)
  assert.match(agents, /dsh\.bundle/)
  assert.match(chinese, /SHA-256/)
  assert.match(english, /SHA-256/)
  assert.match(chinese, /正在运行的任务会先安全停止/)
  assert.match(english, /running work is stopped safely/i)
  assert.match(chinese, /不重载整个 DSH 页面/)
  assert.match(english, /without reloading\s+the whole DSH page/i)
  assert.match(chinese, /raw\.githubusercontent\.com\/WSL043\/dsh-session-delete\/v0\.1\.10\/AGENTS\.md/)
  assert.match(english, /raw\.githubusercontent\.com\/WSL043\/dsh-session-delete\/v0\.1\.10\/AGENTS\.md/)
  assert.doesNotMatch(`${chinese}\n${english}`, /raw\.githubusercontent\.com\/WSL043\/dsh-session-delete\/main\/AGENTS\.md/)
  for (const document of [chinese, english]) {
    assert.match(document, /releases\/download\/v0\.1\.10/u)
    assert.match(document, /dsh-session-delete-setup\.ps1\.sha256/u)
    assert.doesNotMatch(document, /releases\/latest\/download\/dsh-session-delete-setup\.ps1/u)
    assert.match(document, /dsh-session-delete update/u)
    assert.match(document, /dsh-session-delete uninstall/u)
  }
})
