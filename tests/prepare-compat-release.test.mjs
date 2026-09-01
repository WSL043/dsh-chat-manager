import assert from 'node:assert/strict'
import test from 'node:test'

import {
  boundedArtifactPaths,
  compareDshVersions,
  extractDeepSeekReleaseAgeSelectors,
  planCompatibilityUpdate,
  rewriteCompatibilityBlock,
  rewriteDshVersion,
  rewriteReleaseVersion,
  rewriteReleaseAgeCohort,
  rewriteWorkspaceCohort,
  selectNextUntestedVersion,
  selectNewestPublishedTag,
} from '../scripts/prepare-compat-release.mjs'

const fixture = () => ({
  compatibility: {
    latestTested: '0.1.0-rc.8',
    supported: ['0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8'],
    workspaceFixtures: {
      '0.1.0-rc.6': 'dsh-ui-workspace-rc6',
      '0.1.0-rc.7': 'dsh-ui-workspace-rc7',
    },
  },
  manifest: {
    name: 'dsh-chat-manager',
    version: '1.0.2',
    devDependencies: {
      '@deepseek-ai/dsh-client-ui-workspace': '0.1.0-rc.8',
      '@deepseek-ai/dsh-client-ui-primitives': '0.1.0-rc.8',
      'dsh-ui-workspace-rc6': 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.6',
      'dsh-ui-workspace-rc7': 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.7',
    },
    peerDependencies: {
      '@deepseek-ai/dsh-client-ui-workspace': '0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8',
      react: '^18.2.0',
    },
  },
})

const previewFixture = () => ({
  compatibility: {
    latestTested: '0.1.1-rc.2',
    supported: ['0.1.1-rc.2'],
    previews: ['0.1.2-alpha.3'],
    workspaceFixtures: {},
    previewWorkspaceFixture: 'dsh-ui-workspace-alpha3',
  },
  manifest: {
    name: 'dsh-chat-manager',
    version: '1.3.0',
    devDependencies: {
      '@deepseek-ai/dsh-client-ui-workspace': '0.1.1-rc.2',
      'dsh-ui-workspace-alpha3': 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.2-alpha.3',
    },
    peerDependencies: {
      '@deepseek-ai/dsh-client-ui-workspace': '0.1.1-rc.2 || 0.1.2-alpha.3',
      react: '^18.2.0',
    },
  },
})

test('queues the oldest untested registry version so missed releases need no manual catch-up', () => {
  const versions = ['0.1.0-rc.10', '0.1.0-rc.8', '0.1.0-rc.9', '0.1.0-rc.7']
  assert.equal(selectNextUntestedVersion(versions, '0.1.0-rc.8'), '0.1.0-rc.9')
  assert.equal(selectNextUntestedVersion(versions, '0.1.0-rc.10'), null)
  assert.equal(
    selectNextUntestedVersion(['0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4'], previewFixture().compatibility),
    '0.1.2-alpha.4',
  )
})

test('plans preview support without moving stable docs or the stable compatibility lane', () => {
  const update = planCompatibilityUpdate(previewFixture(), '0.1.2-alpha.4')
  assert.equal(update.pluginVersion, '1.3.1-beta.0')
  assert.equal(update.compatibility.latestTested, '0.1.1-rc.2')
  assert.deepEqual(update.compatibility.supported, ['0.1.1-rc.2'])
  assert.deepEqual(update.compatibility.previews, ['0.1.2-alpha.3', '0.1.2-alpha.4'])
  assert.equal(update.compatibility.previewWorkspaceFixture, 'dsh-ui-workspace-alpha4')
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-ui-workspace'], '0.1.2-alpha.4')
  assert.equal(update.manifest.devDependencies['dsh-ui-workspace-alpha4'], 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.2-alpha.4')
  assert.equal(update.manifest.peerDependencies['@deepseek-ai/dsh-client-ui-workspace'], '0.1.1-rc.2 || 0.1.2-alpha.3 || 0.1.2-alpha.4')
  assert.deepEqual(boundedArtifactPaths(update), [])
  assert.equal(rewriteWorkspaceCohort('stable release-age policy', update), 'stable release-age policy')
})

test('selects the newest official dist-tag instead of assuming next always wins', () => {
  assert.equal(selectNewestPublishedTag({ latest: '0.1.0', next: '0.2.0-rc.1' }), '0.2.0-rc.1')
  assert.equal(selectNewestPublishedTag({ latest: '0.2.0', next: '0.2.0-rc.9' }), '0.2.0')
  assert.ok(compareDshVersions('0.1.0-rc.9', '0.1.0-rc.8') > 0)
})

test('plans an immutable patch release for one newly tested DSH version', () => {
  const update = planCompatibilityUpdate(fixture(), '0.1.0-rc.9')

  assert.equal(update.previousPluginVersion, '1.0.2')
  assert.equal(update.pluginVersion, '1.0.3')
  assert.equal(update.compatibility.latestTested, '0.1.0-rc.9')
  assert.deepEqual(update.compatibility.supported, [
    '0.1.0-rc.6',
    '0.1.0-rc.7',
    '0.1.0-rc.8',
    '0.1.0-rc.9',
  ])
  assert.equal(update.compatibility.workspaceFixtures['0.1.0-rc.8'], 'dsh-ui-workspace-rc8')
  assert.equal(update.manifest.devDependencies['dsh-ui-workspace-rc8'], 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.8')
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-ui-workspace'], '0.1.0-rc.9')
  assert.equal(
    update.manifest.peerDependencies['@deepseek-ai/dsh-client-ui-workspace'],
    '0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8 || 0.1.0-rc.9',
  )
  assert.equal(update.manifest.peerDependencies.react, '^18.2.0')
})

test('is a no-op for an already tested version and refuses skipped releases', () => {
  assert.equal(planCompatibilityUpdate(fixture(), '0.1.0-rc.8'), null)
  assert.throws(
    () => planCompatibilityUpdate(fixture(), '0.1.0-rc.10'),
    /refusing to skip untested DSH version 0\.1\.0-rc\.9/,
  )
})

test('rewrites every release-version reference in bounded public artifacts and generated compatibility blocks', () => {
  const source = [
    'keep historical v1.0.2 text',
    "raw.githubusercontent.com/WSL043/dsh-chat-manager/v1.0.2/AGENTS.md",
    'dsh plugin --profile web add dsh-chat-manager@1.0.2',
  ].join('\n')
  const rewritten = rewriteReleaseVersion(source, '1.0.2', '1.0.3')
  assert.match(rewritten, /keep historical v1\.0\.3 text/)
  assert.doesNotMatch(rewritten, /v1\.0\.2/)
  assert.match(rewritten, /dsh plugin --profile web add dsh-chat-manager@1\.0\.3/)
  assert.match(rewritten, /dsh-chat-manager@1\.0\.3/)
  assert.match(rewritten, /dsh-chat-manager\/v1\.0\.3\/AGENTS\.md/)

  const document = 'before\n<!-- dsh-compatibility -->stale<!-- /dsh-compatibility -->\nafter'
  const block = rewriteCompatibilityBlock(document, ['0.1.0-rc.6', '0.1.0-rc.9'], 'zh')
  assert.match(block, /支持最新版 DeepSeek Harness（`0\.1\.0-rc\.9`）/)
  assert.doesNotMatch(block, /0\.1\.0-rc\.6/)
  assert.doesNotMatch(block, /stale/)

  const englishBlock = rewriteCompatibilityBlock(document, ['0.1.0-rc.6', '0.1.0-rc.9'], 'en')
  assert.match(englishBlock, /Supports the latest DeepSeek Harness release \(`0\.1\.0-rc\.9`\)/)
  assert.doesNotMatch(englishBlock, /0\.1\.0-rc\.6/)

  assert.match(
    rewriteDshVersion('workspace version 0.1.0-rc.8', '0.1.0-rc.8', '0.1.0-rc.9'),
    /workspace version 0\.1\.0-rc\.9/,
  )
  assert.throws(
    () => rewriteDshVersion('unrelated notice', '0.1.0-rc.8', '0.1.0-rc.9'),
    /was not found/,
  )
})

test('stable compatibility automation updates the Chinese homepage and bounded stable artifacts', () => {
  const update = planCompatibilityUpdate(fixture(), '0.1.0-rc.9')
  assert.deepEqual(boundedArtifactPaths(update), ['README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md'])
  assert.equal(rewriteWorkspaceCohort('cohort @0.1.0-rc.8', update), 'cohort @0.1.0-rc.9')
})

test('regenerates the exact release-age exceptions from the accepted lock graph', () => {
  const lockfile = [
    'lockfileVersion: 9.0',
    '',
    'packages:',
    '',
    "  '@deepseek-ai/dsh-client-ui-workspace@0.1.1-rc.2':",
    '    resolution: {integrity: sha512-test}',
    '',
    "  '@deepseek-ai/cordis@4.0.1':",
    '    resolution: {integrity: sha512-test}',
    '',
    'snapshots:',
    '',
  ].join('\n')
  const selectors = extractDeepSeekReleaseAgeSelectors(lockfile)
  assert.deepEqual(selectors, [
    '@deepseek-ai/cordis@4.0.1',
    '@deepseek-ai/dsh-client-ui-workspace@0.1.1-rc.2',
  ])

  const workspace = [
    'minimumReleaseAge: 1440',
    '# dsh-compat-release-age-start',
    'minimumReleaseAgeExclude:',
    "  - '@deepseek-ai/dsh-client-ui-workspace@0.1.1-rc.1'",
    '# dsh-compat-release-age-end',
    '',
  ].join('\n')
  const rewritten = rewriteReleaseAgeCohort(workspace, selectors)
  assert.match(rewritten, /@deepseek-ai\/dsh-client-ui-workspace@0\.1\.1-rc\.2/u)
  assert.match(rewritten, /@deepseek-ai\/cordis@4\.0\.1/u)
  assert.doesNotMatch(rewritten, /0\.1\.1-rc\.1/u)
  assert.doesNotMatch(rewritten, /@deepseek-ai\/\*/u)
})
