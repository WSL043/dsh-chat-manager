import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('public package is a standard DSH bundle with a unique identity', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const compatibility = JSON.parse(await read('compatibility.json'))

  assert.equal(manifest.name, 'dsh-chat-manager')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/)
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.repository.url, 'git+https://github.com/WSL043/dsh-chat-manager.git')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-workspace'], compatibility.latestTested)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-primitives'], compatibility.latestTested)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-slots'], compatibility.latestTested)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-invariants'], compatibility.latestTested)
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis'], '4.0.2')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis-plugin-include'], '1.0.7')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis-plugin-loader'], '1.0.3')
  for (const [version, alias] of Object.entries(compatibility.workspaceFixtures)) {
    assert.equal(manifest.devDependencies[alias], `npm:@deepseek-ai/dsh-client-ui-workspace@${version}`)
  }
  assert.equal(compatibility.legacyWorkspaceFixture, compatibility.workspaceFixtures['0.1.1-rc.2'])
  assert.ok(compatibility.previews.includes('0.1.2-alpha.3'))
  assert.ok(compatibility.previews.every(version => /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)))
  const latestPreview = compatibility.previews.at(-1)
  assert.equal(
    manifest.devDependencies[compatibility.previewWorkspaceFixture],
    `npm:@deepseek-ai/dsh-client-ui-workspace@${latestPreview}`,
  )
  const supportedVersions = new Set([...compatibility.supported, ...compatibility.previews])
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.deepEqual(new Set(version.split(' || ')), supportedVersions)
  }
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-connection'))
  for (const dependency of [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-workspace-controller',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-session',
  ]) {
    assert.ok(manifest.dsh.client.inject.includes(dependency), `missing RC1 client graph edge ${dependency}`)
  }
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-runtime'], '0.1.1-rc.2')
  assert.match(manifest.description, /session management/i)
  for (const keyword of ['session-manager', 'archive', 'unarchive', 'restore', 'history-search', 'chat-history', 'conversation-history', 'session-delete']) {
    assert.ok(manifest.keywords.includes(keyword), `missing discovery keyword ${keyword}`)
  }
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
  assert.ok(manifest.files.includes('THIRD_PARTY_NOTICES.md'))
})

test('compatibility autopilot is fail-closed and publishes only after both host lanes pass', async () => {
  const workflow = await read('.github/workflows/upstream-compatibility.yml')

  assert.match(workflow, /cron:\s*'17 \*\/3 \* \* \*'/)
  assert.match(workflow, /repos\/deepseek-ai\/deepseek-harness\/releases\/tags\/dsh-v/)
  assert.match(workflow, /\.draft == false and \.immutable == true/)
  assert.match(workflow, /git add --[^\n]*AGENTS\.md[^\n]*README\.md[^\n]*README\.zh-CN\.md[^\n]*compatibility\.json/)
  assert.match(workflow, /scripts\/accept-official-dsh\.mjs/)
  assert.match(workflow, /git diff --binary \| sha256sum/)
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /git push origin HEAD:main[\s\S]*gh workflow run publish\.yml/)
  assert.match(workflow, /release_kind=compatibility/)
  assert.match(workflow, /dsh_version="\$DSH_VERSION"/)
  assert.match(workflow, /request_id="compat-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/)
  assert.match(workflow, /select\(\.displayTitle == \$title\)/)
  assert.match(workflow, /compatibility\.supported[\s\S]*compatibility\.previews/)
  assert.match(workflow, /if \[ "\$tested" = true \]; then/)
  assert.match(workflow, /gh run watch "\$release_run"/)
  assert.match(workflow, /actions:\s*write/)
  assert.match(workflow, /official immutable GitHub Release is not available yet; waiting/)
  assert.doesNotMatch(workflow, /npm publish|gh release create/)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN/)
  assert.match(workflow, /missing a GitHub or npm publication/)
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
  assert.match(workflow, /RELEASE_KIND[\s\S]*compatibility[\s\S]*REQUESTED_DSH_VERSION/u)
  assert.match(workflow, /Added compatibility with DeepSeek Harness/u)
  assert.match(workflow, /新增对 DeepSeek Harness/u)
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

test('GitHub defaults to Chinese and links a complete English README', async () => {
  const readme = await read('README.md')
  const readmeEn = await read('README.en.md')

  assert.match(readme, /在 DeepSeek Harness 原生侧边栏中搜索、恢复和安全清理会话/)
  assert.match(readme, /\[English\]\(README\.en\.md\)/)
  assert.match(readmeEn, /Manage DeepSeek Harness chat history/)
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

test('dependency installs enforce a release-age gate outside the reviewed DSH cohort', async () => {
  const workspace = await read('pnpm-workspace.yaml')
  const compatibility = JSON.parse(await read('compatibility.json'))

  assert.match(workspace, /^minimumReleaseAge: 1440$/m)
  assert.match(workspace, /# dsh-compat-release-age-start[\s\S]*# dsh-compat-release-age-end/)
  assert.match(workspace, new RegExp(`@deepseek-ai/dsh-client-ui-workspace@${compatibility.latestTested.replaceAll('.', '\\.')}`))
  assert.doesNotMatch(workspace, /minimumReleaseAgeExclude:[\s\S]*['"]?@deepseek-ai\/\*['"]?\s*$/m)
})

test('public artifacts contain no local workspace paths', async () => {
  const files = [
    'package.json',
    'README.md',
    'README.en.md',
    'README.zh-CN.md',
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
  const [english, chinese, agents] = await Promise.all([
    read('README.en.md'),
    read('README.md'),
    read('AGENTS.md'),
  ])
  const documentedVersion = chinese.match(/dsh-chat-manager@(\d+\.\d+\.\d+)/)?.[1]
  assert.match(documentedVersion ?? '', /^\d+\.\d+\.\d+$/)
  const releaseVersion = documentedVersion.replaceAll('.', '\\.')
  for (const document of [chinese, english, agents]) {
    assert.match(document, /dsh-chat-manager@\d+\.\d+\.\d+/)
    assert.doesNotMatch(document, /dsh-chat-manager@\d+\.\d+\.\d+-beta\.\d+/)
  }
  assert.match(chinese, /再次\s*确认/)
  assert.match(chinese, /永久删除无法撤销/)
  assert.match(chinese, /raw\.githubusercontent\.com\/WSL043\/dsh-chat-manager\/main\/docs\/assets\/confirm-delete\.png/)
  assert.match(chinese, /raw\.githubusercontent\.com\/WSL043\/dsh-chat-manager\/main\/docs\/assets\/archive-manager\.png/)
  assert.match(english, /second confirmation/i)
  assert.match(english, /permanent deletion cannot be undone/i)
  assert.match(english, /img\.shields\.io\/npm\/dt\/dsh-chat-manager/)
  assert.match(chinese, /img\.shields\.io\/npm\/dt\/dsh-chat-manager/)
  assert.doesNotMatch(`${english}\n${chinese}`, /img\.shields\.io\/npm\/d(?:m|w|y)\/dsh-chat-manager/)
  assert.match(english, /raw\.githubusercontent\.com\/WSL043\/dsh-chat-manager\/main\/docs\/assets\/confirm-delete\.en\.png/)
  assert.match(english, /raw\.githubusercontent\.com\/WSL043\/dsh-chat-manager\/main\/docs\/assets\/archive-manager\.en\.png/)
  assert.doesNotMatch(`${chinese}\n${english}`, /\birm\b|install\.ps1/iu)
  assert.match(agents, /Never delete a session as an installation test/)
  assert.match(agents, /dsh\.bundle/)
  assert.match(chinese, /正在运行的任务会先停止/)
  assert.match(english, /running work is stopped/i)
  assert.match(chinese, /不重载整个 DSH 页面/)
  assert.match(english, /without reloading\s+the whole DSH page/i)
  assert.match(chinese, /DSH-Portable/)
  assert.match(english, /DSH-Portable/)
  assert.match(chinese, new RegExp(`raw\\.githubusercontent\\.com/WSL043/dsh-chat-manager/v${releaseVersion}/AGENTS\\.md`))
  assert.match(english, new RegExp(`raw\\.githubusercontent\\.com/WSL043/dsh-chat-manager/v${releaseVersion}/AGENTS\\.md`))
  assert.doesNotMatch(`${chinese}\n${english}`, /raw\.githubusercontent\.com\/WSL043\/dsh-chat-manager\/main\/AGENTS\.md/)
  for (const document of [chinese, english]) {
    assert.match(document, /dsh plugin --profile web add/u)
    assert.match(document, /dsh plugin --profile web remove/u)
  }
})

test('public-facing copy describes the product without exposing maintenance mechanics', async () => {
  const [english, chinese, publishWorkflow] = await Promise.all([
    read('README.en.md'),
    read('README.md'),
    read('.github/workflows/publish.yml'),
  ])
  const releaseNotesStart = publishWorkflow.indexOf('- name: Write release notes')
  const releaseNotesEnd = publishWorkflow.indexOf('- name: Publish immutable npm package')
  const releaseNotes = publishWorkflow.slice(releaseNotesStart, releaseNotesEnd)

  assert.ok(releaseNotesStart >= 0 && releaseNotesEnd > releaseNotesStart, 'publish workflow must define release notes')
  for (const document of [chinese, english, releaseNotes]) {
    assert.doesNotMatch(document, /GitHub Actions|每\s*6\s*小时|every six hours|隔离安装|isolated install|smoke acceptance|fail[- ]closed|自动兼容|Compatibility autopilot/i)
  }
  assert.match(chinese, /支持软件包元数据中记录的最新版 DeepSeek Harness/)
  assert.match(english, /Supports the latest DeepSeek Harness release recorded in the package metadata/)
  assert.match(releaseNotes, /永久删除不可撤销/)
  assert.match(releaseNotes, /Permanent deletion cannot be undone/)
  assert.match(releaseNotes, /dsh plugin --profile web add dsh-chat-manager@\$\{RELEASE_VERSION\}/)
  assert.doesNotMatch(releaseNotes, /\birm\b|install\.ps1|powershell/i)
})

test('bundle disables the official workspace row and inserts the native replacement row', async () => {
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /id:\s*ui-workspace[\s\S]*disabled:\s*true/)
  assert.match(patch, /id:\s*ui-workspace-session-delete[\s\S]*name:\s*['"]?dsh-chat-manager/)
})

test('host bundle mounts restore and archived-history search routes', async () => {
  const source = await read('src/index.js')

  assert.match(source, /inject = \[[^\]]*'workspaceRegistry'/s)
  assert.match(source, /path: '\/plugins\/dsh-session-delete\/restore'/)
  assert.match(source, /path: '\/plugins\/dsh-session-delete\/archive-search'/)
  assert.match(source, /restoreArchivedSession/)
  assert.match(source, /searchArchivedSessions/)
})
