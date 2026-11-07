import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'
import { buildOfficialSlotClient } from '../scripts/official-session-actions.mjs'

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8')

test('the v2 package declares only exact qualified host cohorts', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const compatibility = JSON.parse(await read('compatibility.json'))
  const targets = compatibility.releaseTargets
  assert.equal(manifest.name, 'dsh-chat-manager')
  assert.match(manifest.version, /^2\.\d+\.\d+$/)
  assert.equal(manifest.publishConfig.tag, 'latest')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(targets.length >= 1 && targets.length <= 2)
  assert.equal(compatibility.latestTested, targets[0])
  assert.deepEqual(compatibility.upstream.map(core => core.version), targets)
  for (const core of compatibility.upstream) {
    assert.match(core.version, /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/)
    assert.match(core.commit, /^[a-f0-9]{40}$/)
    assert.match(core.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/)
  }
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(range, targets.join(' || '))
    assert.equal(manifest.peerDependenciesMeta[name].optional, true)
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'],
    [...new Set(compatibility.upstream.map(core => core.cordis))].join(' || '))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-context-menu'))
})

test('build has no dependency or legacy alias while behavior tools retain their exact imports', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.deepEqual(manifest.dependencies ?? {}, {})
  assert.deepEqual(manifest.devDependencies, { '@deepseek-ai/cordis': '4.1.0', playwright: '1.63.0' })
  assert.ok(!manifest.files.includes('scripts/build-modern-client.mjs'))
  assert.ok(manifest.files.includes('README.en.md'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-session'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.ok(!manifest.files.some(file => file.startsWith('docs/assets/')))
  for (const file of manifest.files.filter(file => !file.includes('*'))) await access(new URL('../' + file, import.meta.url))
})

test('qualification gates both scheduled promotion and publication of the accepted archive', async () => {
  const [auto, release, acceptance] = await Promise.all([
    read('.github/workflows/upstream-compatibility.yml'),
    read('.github/workflows/publish.yml'),
    read('.github/workflows/official-acceptance.yml'),
  ])
  assert.match(auto, /cron:\s*'17 \* \* \* \*'/)
  assert.match(auto, /workflow_dispatch.*\n\s*printf 'run=true\\npromote=false/)
  assert.match(auto, /acceptance\.result == 'success'/)
  assert.match(auto, /git apply --include=package\.json --include=compatibility\.json/)
  assert.match(auto, /-f expected_sha=[^\n]*-f expected_digest=/)
  assert.match(release, /needs: \[verify, acceptance\]/)
  assert.match(release, /\$EXPECTED_SHA.*\$GITHUB_SHA/)
  assert.match(release, /sha256sum[^\n]*== "\$EXPECTED_DIGEST"/)
  assert.match(release, /uses: actions\/download-artifact/)
  assert.match(acceptance, /Installed runtime lock does not match the official archive integrity/)
  assert.match(acceptance, /node scripts\/accept-official-dsh\.mjs/)
})

test('release workflows reconcile an existing npm artifact by package contents', async () => {
  const workflow = await read('.github/workflows/publish.yml')

  assert.match(workflow, /npm install --global npm@12\.0\.2/)
  assert.match(workflow, /npm view "\$spec" dist\.tarball/)
  assert.match(workflow, /diff -qr --strip-trailing-cr "\$local_tree\/package" "\$remote_tree\/package"/)
  assert.match(workflow, /mv "\$remote_package" "\$package"/)
  assert.match(workflow, /Verify existing immutable release assets/)
  assert.match(workflow, /\.draft == false and \.prerelease == false and \.immutable == true/)
  assert.match(workflow, /sha256sum -c dsh-chat-manager\.tgz\.sha256/)
  assert.match(workflow, /cmp "\$existing\/dsh-chat-manager\.tgz" \.artifacts\/dsh-chat-manager\.tgz/)
  assert.match(workflow, /npm publish "\$package"[\s\S]*--tag latest/)
  assert.match(workflow, /Publish immutable release[\s\S]*gh release create/)
})

test('release notes credit verified merged contributor pull requests', async () => {
  const workflow = await read('.github/workflows/publish.yml')

  assert.match(workflow, /contributor_prs:[\s\S]*merged contributor PR numbers/i)
  assert.match(workflow, /CONTRIBUTOR_PRS: \$\{\{ inputs\.contributor_prs \}\}/)
  assert.match(workflow, /gh pr view "\$pr_number"[\s\S]*author,mergedAt,number,url/)
  assert.match(workflow, /test "\$merged_at" != 'null'/)
  assert.match(workflow, /Thanks to \[@\$author\][\s\S]*for contributing in \[#\$number\]/)
})

test('release notes never credit issue reporters and reject escaped newlines', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  assert.match(workflow, /release_notes_en:[\s\S]*required: false/u)
  assert.match(workflow, /release_notes_zh:[\s\S]*required: false/u)
  assert.match(workflow, /RELEASE_KIND[\s\S]*compatibility/u)
  assert.match(workflow, /Compatibility range now follows the latest qualified official DSH core and its predecessor/u)
  assert.match(workflow, /兼容范围改为通过验收的最新官方 DSH 内核及其上一受支持版本/u)
  assert.doesNotMatch(workflow, /reported_issues|REPORTED_ISSUES|Issue reporters|问题报告者/u)
  assert.match(workflow, /real line breaks, not literal/u)
})

test('new issues receive one event-driven, non-judgmental acknowledgement', async () => {
  const workflow = await readFile(new URL('../.github/workflows/issue-intake.yml', import.meta.url), 'utf8')
  assert.match(workflow, /issues:\s*\n\s*types: \[opened\]/)
  assert.match(workflow, /dsh-maintenance-ack/)
  assert.match(workflow, /actions\/github-script@v8/)
  assert.doesNotMatch(workflow, /schedule:|close|merge/i)
})

test('release notes present complete English before a separate Chinese translation', async () => {
  const workflow = await read('.github/workflows/publish.yml')

  assert.match(workflow, /## What's changed[\s\S]*## Install or update[\s\S]*## 中文[\s\S]*## 更新内容[\s\S]*## 安装或更新/)
  assert.doesNotMatch(workflow, /提交贡献 \/ Thanks to/)
})

test('GitHub issue intake defaults to concise English forms without title prefixes', async () => {
  const [bug, feature, config] = await Promise.all([
    read('.github/ISSUE_TEMPLATE/bug-report.yml'),
    read('.github/ISSUE_TEMPLATE/feature-request.yml'),
    read('.github/ISSUE_TEMPLATE/config.yml'),
  ])

  assert.match(bug, /^name: Bug report$/m)
  assert.match(bug, /id: plugin_version/)
  assert.match(bug, /id: dsh_version/)
  assert.match(bug, /contains no session content, credentials, or account identifiers/i)
  assert.doesNotMatch(bug, /^title:/m)
  assert.match(feature, /^name: Feature request$/m)
  assert.match(feature, /id: use_case/)
  assert.doesNotMatch(feature, /^title:/m)
  assert.match(config, /^blank_issues_enabled: false$/m)
  assert.match(config, /security\/policy/)
})

test('dependency installs retain a bounded release-age policy', async () => {
  const workspace = await read('pnpm-workspace.yaml')
  assert.match(workspace, /^minimumReleaseAge: 1440$/m)
  assert.match(workspace, /# dsh-compat-release-age-start[\s\S]*# dsh-compat-release-age-end/)
  assert.doesNotMatch(workspace, /minimumReleaseAgeExclude:[\s\S]*['"]?@deepseek-ai\/\*['"]?\s*$/m)
})

test('public source artifacts contain no local workspace paths', async () => {
  const files = ['package.json', 'README.md', 'README.en.md', 'README.zh-CN.md', 'AGENTS.md', 'src/index.js', 'src/host/delete-session.mjs', 'scripts/build-client.mjs', 'scripts/smoke-ui.mjs', 'cordis.patch.yml']
  const contents = (await Promise.all(files.map(read))).join('\n')
  assert.doesNotMatch(contents, /[A-Z]:[\\/]Users[\\/]/i)
  assert.doesNotMatch(contents, /Documents[\\/]Codex/i)
})

test('candidate source contributes public slots without replacing the workspace', async () => {
  const patch = await read('cordis.patch.yml')
  assert.doesNotMatch(patch, /disabled:\s*true/)
  const client = buildOfficialSlotClient()
  assert.match(client, /contextMenus\.register/)
  assert.match(client, /settings\.section/)
  assert.doesNotMatch(client, /new UiWorkspaceService\(|slots\.provideRoot\(/)
  assert.match(patch, /id:\s*ui-workspace-session-delete[\s\S]*name:\s*['"]?dsh-chat-manager/)
})

test('host mounts cleanup and archived-history search without a duplicate restore route', async () => {
  const source = await read('src/index.js')
  assert.match(source, /inject = \[[^\]]*'workspaceRegistry'/s)
  assert.doesNotMatch(source, /path: '\/plugins\/dsh-session-delete\/restore'/)
  assert.match(source, /path: '\/plugins\/dsh-session-delete\/archive-search'/)
  assert.doesNotMatch(source, /installAgentHandleTracker/)
})
