import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('public package is a standard DSH bundle with a unique identity', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const compatibility = JSON.parse(await read('compatibility.json'))

  assert.equal(manifest.name, 'dsh-native-session-delete')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.repository.url, 'git+https://github.com/WSL043/dsh-native-session-delete.git')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-workspace'], compatibility.latestTested)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-primitives'], compatibility.latestTested)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-slots'], compatibility.latestTested)
  for (const [version, alias] of Object.entries(compatibility.workspaceFixtures)) {
    assert.equal(manifest.devDependencies[alias], `npm:@deepseek-ai/dsh-client-ui-workspace@${version}`)
  }
  const supportedRange = compatibility.supported.join(' || ')
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, supportedRange)
  }
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-connection'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  for (const peer of Object.keys(manifest.peerDependencies)) {
    assert.equal(manifest.peerDependenciesMeta?.[peer]?.optional, true, `${peer} should be a host-provided optional peer`)
  }
  assert.equal(manifest.scripts['smoke:ui'], 'node scripts/smoke-ui.mjs')
  assert.ok(manifest.files.includes('scripts/smoke-ui.mjs'))
  assert.ok(manifest.files.includes('compatibility.json'))
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.ok(!manifest.files.some(file => file.startsWith('docs/')), 'documentation images must not inflate the runtime package')
  assert.ok(!manifest.files.includes('dsh-session-delete.ps1'))
  assert.ok(!manifest.files.includes('dsh-session-delete-setup.ps1'))
  assert.ok(!manifest.files.includes('install.ps1'), 'the optional helper is a Release asset, not runtime code')
  assert.ok(manifest.files.includes('THIRD_PARTY_NOTICES.md'))
})

test('compatibility autopilot is fail-closed and publishes only after both host lanes pass', async () => {
  const workflow = await read('.github/workflows/upstream-compatibility.yml')

  assert.match(workflow, /cron:\s*'17 \*\/6 \* \* \*'/)
  assert.match(workflow, /repos\/deepseek-ai\/deepseek-harness\/releases\/tags\/dsh-v/)
  assert.match(workflow, /\.draft == false and \.immutable == true/)
  assert.match(workflow, /scripts\/accept-official-dsh\.mjs/)
  assert.match(workflow, /runs-on:\s*windows-2025/)
  assert.match(workflow, /needs:\s*\[preflight, windows-installer\]/)
  assert.match(workflow, /git diff --binary \| sha256sum/)
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /git push origin HEAD:main[\s\S]*gh release create/)
  assert.match(workflow, /npm publish "\$package" --access public --provenance/)
  assert.match(workflow, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/)
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /missing a GitHub or npm publication/)
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/)
})

test('release workflows reconcile an existing npm artifact by package contents', async () => {
  const workflows = await Promise.all([
    read('.github/workflows/publish.yml'),
    read('.github/workflows/upstream-compatibility.yml'),
  ])

  for (const workflow of workflows) {
    assert.match(workflow, /npm view "\$spec" dist\.tarball/)
    assert.match(workflow, /diff -qr "\$local_tree\/package" "\$remote_tree\/package"/)
    assert.match(workflow, /mv "\$remote_package" "\$package"/)
  }
})

test('dependency installs enforce a release-age gate outside the reviewed DSH cohort', async () => {
  const workspace = await read('pnpm-workspace.yaml')
  const compatibility = JSON.parse(await read('compatibility.json'))

  assert.match(workspace, /^minimumReleaseAge: 1440$/m)
  assert.match(workspace, new RegExp(`@deepseek-ai/dsh-client-ui-workspace@${compatibility.latestTested.replaceAll('.', '\\.')}`))
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
    'cordis.patch.yml',
  ]
  const contents = (await Promise.all(files.map(read))).join('\n')

  assert.doesNotMatch(contents, /[A-Z]:[\\/]Users[\\/]/i)
  assert.doesNotMatch(contents, /Documents[\\/]Codex/i)
})

test('documentation uses the standard one-command bundle lifecycle and second confirmation', async () => {
  const [chinese, english, agents] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('AGENTS.md'),
  ])
  const manifest = JSON.parse(await read('package.json'))
  const releaseVersion = manifest.version.replaceAll('.', '\\.')

  for (const document of [chinese, english, agents]) {
    assert.match(document, new RegExp(`dsh-native-session-delete@${releaseVersion}`))
  }
  assert.match(chinese, /再次\s*确认/)
  assert.match(chinese, /永久删除无法撤销/)
  assert.match(chinese, new RegExp(`raw\\.githubusercontent\\.com/WSL043/dsh-native-session-delete/v${releaseVersion}/docs/assets/confirm-delete\\.png`))
  assert.match(english, /second confirmation/i)
  assert.match(english, /permanent deletion cannot be undone/i)
  assert.match(english, new RegExp(`raw\\.githubusercontent\\.com/WSL043/dsh-native-session-delete/v${releaseVersion}/docs/assets/confirm-delete\\.en\\.png`))
  assert.match(chinese, new RegExp(`releases/download/v${releaseVersion}/install\\.ps1`))
  assert.match(english, new RegExp(`releases/download/v${releaseVersion}/install\\.ps1`))
  assert.match(agents, /Never delete a session as an installation test/)
  assert.match(agents, /dsh\.bundle/)
  assert.match(chinese, /正在运行的任务会先停止/)
  assert.match(english, /running work is stopped/i)
  assert.match(chinese, /不重载整个 DSH 页面/)
  assert.match(english, /without reloading\s+the whole DSH page/i)
  assert.match(chinese, new RegExp(`raw\\.githubusercontent\\.com/WSL043/dsh-native-session-delete/v${releaseVersion}/AGENTS\\.md`))
  assert.match(english, new RegExp(`raw\\.githubusercontent\\.com/WSL043/dsh-native-session-delete/v${releaseVersion}/AGENTS\\.md`))
  assert.doesNotMatch(`${chinese}\n${english}`, /raw\.githubusercontent\.com\/WSL043\/dsh-native-session-delete\/main\/AGENTS\.md/)
  for (const document of [chinese, english]) {
    assert.match(document, new RegExp(`releases/download/v${releaseVersion}`, 'u'))
    assert.match(document, /dsh plugin --profile web add/u)
    assert.match(document, /dsh plugin --profile web remove/u)
  }
})

test('bundle disables the official workspace row and inserts the native replacement row', async () => {
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /id:\s*ui-workspace[\s\S]*disabled:\s*true/)
  assert.match(patch, /id:\s*ui-workspace-session-delete[\s\S]*name:\s*['"]?dsh-native-session-delete/)
})
