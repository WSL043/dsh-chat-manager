import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'
import { buildOfficialSlotClient } from '../scripts/official-session-actions.mjs'

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8')

test('unpublished v2 has a fixed source-contract target and no inherited compatibility matrix', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const compatibility = JSON.parse(await read('compatibility.json'))
  assert.equal(manifest.name, 'dsh-chat-manager')
  assert.equal(manifest.version, '2.0.0-alpha.1')
  assert.equal(manifest.publishConfig?.tag, manifest.version.includes('-') ? 'next' : 'latest')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(compatibility.releaseTargets, ['0.2.2-alpha.2'])
  assert.deepEqual(compatibility.portableBaselines, [])
  assert.equal(compatibility.latestTested, '0.2.2-alpha.2')
  assert.equal(compatibility.clientTarget, '0.2.2-alpha.2')
  assert.equal(compatibility.testFixtures, undefined)
  assert.equal(compatibility.qualification.status, 'source-contract-only')
  assert.equal(compatibility.qualification.runtimeVerified, false)
  assert.equal(compatibility.qualification.sourceCommit, 'f3803c96974ad4a94195fb97e5c637e9c2a3afe3')
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.2.2-alpha.2')
    assert.equal(manifest.peerDependenciesMeta[name].optional, true)
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.6-alpha.1')
})

test('build has no dependency or legacy alias while behavior tools retain their exact imports', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.deepEqual(manifest.dependencies ?? {}, {})
  assert.deepEqual(manifest.devDependencies, { '@deepseek-ai/cordis': '4.0.6-alpha.1', playwright: '1.63.0' })
  assert.ok(!manifest.files.includes('scripts/build-modern-client.mjs'))
  assert.ok(manifest.files.includes('README.en.md'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-session'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.ok(!manifest.files.some(file => file.startsWith('docs/assets/')))
  for (const file of manifest.files.filter(file => !file.includes('*'))) await access(new URL('../' + file, import.meta.url))
})

test('candidate guides distinguish unpublished v2, stable installation and destructive-operation boundaries', async () => {
  const [zh, en, agents, unreleased] = await Promise.all(['README.md', 'README.en.md', 'AGENTS.md', 'docs/UNRELEASED-v2.md'].map(read))
  for (const guide of [zh, en, agents]) {
    assert.match(guide, /2\.0\.0-alpha\.1/)
    assert.ok(guide.includes('dsh-chat-manager@latest'))
    assert.ok(guide.includes('https://github.com/WSL043/dsh-chat-manager/blob/stable/README'))
    assert.ok(guide.includes('https://github.com/WSL043/dsh-chat-manager/blob/stable/AGENTS.md'))
    assert.match(guide, /0\.2\.2-alpha\.2/)
    assert.doesNotMatch(guide, /正在运行的任务会先停止|Running work will be stopped first|every declared core.*verified/i)
  }
  assert.match(zh, /尚未发布|未发布/)
  assert.match(en, /unpublished/i)
  assert.match(en, /Permanent deletion cannot be undone/)
  assert.match(zh, /永久删除无法撤销/)
  assert.match(agents, /Never delete a session as an installation test/)
  assert.match(agents, /dsh\.bundle/)
  assert.match(unreleased, /Do not invoke it for this unpublished v2 candidate/)
  assert.match(zh, /官方 ASAR/)
  assert.match(en, /official ASAR/)
})

test('stable compatibility automation stays separate from the v2 candidate', async () => {
  const workflow = await read('.github/workflows/upstream-compatibility.yml')

  assert.match(workflow, /cron:\s*'17 \* \* \* \*'/)
  assert.match(workflow, /selectLatestDshVersions\(Object\.keys\(registry\.versions\)\)/)
  assert.match(workflow, /npm integrity check failed for DSH/)
  assert.match(workflow, /releases\/tags\/dsh-v\$\{version\}/)
  assert.match(workflow, /\.draft == false and \.immutable == true/)
  assert.match(workflow, /dsh_versions: \$\{\{ steps\.targets\.outputs\.dsh_versions \}\}/)
  assert.match(workflow, /dsh_version: \$\{\{ fromJSON\(needs\.prepare\.outputs\.acceptance_versions\) \}\}/)
  assert.match(workflow, /actions\/upload-artifact@[\s\S]*actions\/download-artifact/)
  assert.match(workflow, /Accept the exact same candidate package on this core/)
  assert.match(workflow, /git add --[^\n]*AGENTS\.md[^\n]*README\.md[^\n]*README\.en\.md[^\n]*compatibility\.json/)
  assert.match(workflow, /scripts\/accept-official-dsh\.mjs/)
  assert.match(workflow, /git diff --binary \| sha256sum/)
  assert.match(workflow, /test "\$\(git rev-parse FETCH_HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /git push origin "HEAD:\$GITHUB_REF_NAME"[\s\S]*gh workflow run publish\.yml/)
  assert.match(workflow, /release_kind=compatibility/)
  assert.match(workflow, /- name: Dispatch and await the trusted release workflow/)
  assert.match(workflow, /request_id="compat-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/)
  assert.match(workflow, /select\(\.displayTitle == \$title\)/)
  assert.match(workflow, /gh run watch "\$release_run"/)
  assert.match(workflow, /actions:\s*write/)
  assert.match(workflow, /no official Release yet; waiting/)
  assert.doesNotMatch(workflow, /npm publish|gh release create/)
  assert.doesNotMatch(workflow, /compatibility\.supported|compatibility\.previews|oldest uncovered|continue-on-error:\s*true/)
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/)
})

test('release workflows reconcile an existing npm artifact by package contents', async () => {
  const workflow = await read('.github/workflows/publish.yml')

  assert.match(workflow, /npm install --global npm@12\.0\.2/)
  assert.match(workflow, /npm view "\$spec" dist\.tarball/)
  assert.match(workflow, /diff -qr --strip-trailing-cr "\$local_tree\/package" "\$remote_tree\/package"/)
  assert.match(workflow, /mv "\$remote_package" "\$package"/)
  assert.match(workflow, /Verify existing immutable release assets/)
  assert.match(workflow, /\.draft == false and \.prerelease == \$prerelease and \.immutable == true/)
  assert.match(workflow, /sha256sum -c dsh-chat-manager\.tgz\.sha256/)
  assert.match(workflow, /cmp "\$existing\/dsh-chat-manager\.tgz" \.artifacts\/dsh-chat-manager\.tgz/)
  assert.match(workflow, /npm_tag=beta/)
  assert.match(workflow, /npm publish "\$package"[\s\S]*--tag "\$NPM_TAG"/)
  assert.match(workflow, /Publish immutable release[\s\S]*IS_PRERELEASE: \$\{\{ needs\.verify\.outputs\.prerelease \}\}/)
  assert.match(workflow, /--prerelease[\s\S]*gh release create/)
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
  assert.match(workflow, /Compatibility range now follows the official latest five DSH cores/u)
  assert.match(workflow, /兼容范围改为官方最新 5 个 DSH 内核/u)
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
  assert.match(client, /sidebar\.workspaces\.session\.menu\.item/)
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
