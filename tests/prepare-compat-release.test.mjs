import assert from 'node:assert/strict'
import test from 'node:test'

import {
  boundedArtifactPaths,
  compareDshVersions,
  devVersionFor,
  extractDeepSeekReleaseAgeSelectors,
  planCompatibilityUpdate,
  rewriteCompatibilityBlock,
  rewriteDshVersion,
  rewriteInstallationCompatibility,
  rewriteReleaseAgeCohort,
  rewriteReleaseVersion,
  rewriteWorkspaceCohort,
  selectLatestDshVersions,
  selectNewestPublishedTag,
} from '../scripts/prepare-compat-release.mjs'

const targets = ['0.2.0-rc.2', '0.2.0-rc.1', '0.1.7-rc.2']

const fixture = () => ({
  compatibility: {
    releaseTargets: ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2'],
    latestTested: '0.1.5-rc.2',
    supported: ['0.1.1-rc.2', '0.1.2-rc.1', '0.1.5-rc.2'],
    previews: ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2'],
    workspaceFixtures: { '0.1.1-rc.2': 'dsh-ui-workspace-rc2' },
    legacyWorkspaceFixture: 'dsh-ui-workspace-rc2',
    previewWorkspaceFixture: 'dsh-ui-workspace-0-1-7-rc-2',
    clientTarget: '0.1.7-alpha.1',
  },
  manifest: {
    name: 'dsh-chat-manager',
    version: '1.5.4',
    devDependencies: {
      '@deepseek-ai/dsh-client-ui-workspace': '0.1.5-rc.2',
      '@deepseek-ai/dsh-client-ui-primitives': '0.1.5-rc.2',
      '@deepseek-ai/dsh-client-runtime': '0.1.1-rc.2',
      'dsh-ui-workspace-rc2': 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.1-rc.2',
      'dsh-ui-workspace-0-1-7-rc-2': 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.7-rc.2',
    },
    peerDependencies: {
      '@deepseek-ai/dsh-client-ui-workspace': '0.1.7-alpha.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-primitives': '0.1.7-alpha.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2',
      react: '^18.2.0',
    },
  },
})

test('selects the semver-newest three across alpha, rc, and final versions', () => {
  const versions = [
    '0.2.0-rc.1', '0.1.7-rc.2', '0.2.0-alpha.2', '0.2.0-rc.2',
    '0.2.0-beta.1', '0.2.0', '0.3.0-alpha.1', 'not-semver',
  ]
  assert.deepEqual(selectLatestDshVersions(versions), ['0.3.0-alpha.1', '0.2.0', '0.2.0-rc.2'])
  assert.ok(compareDshVersions('0.2.0', '0.2.0-rc.10') > 0)
  assert.ok(compareDshVersions('0.2.0-rc.10', '0.2.0-rc.9') > 0)
  assert.throws(() => selectLatestDshVersions(['0.2.0-rc.1', '0.2.0']), /fewer than 3/u)
})

test('prepares one package for exactly the newest-three window and isolates legacy fixtures', () => {
  const state = fixture()
  const update = planCompatibilityUpdate(state, targets)

  assert.equal(update.pluginVersion, '1.5.5')
  assert.deepEqual(update.dshVersions, targets)
  assert.deepEqual(update.compatibility.releaseTargets, targets)
  assert.equal(update.compatibility.latestTested, targets[0])
  assert.equal(update.compatibility.clientTarget, targets[0])
  assert.equal(update.compatibility.supported, undefined)
  assert.equal(update.compatibility.previews, undefined)
  assert.equal(update.compatibility.workspaceFixtures, undefined)
  assert.deepEqual(update.compatibility.testFixtures.historicalSupported, ['0.1.1-rc.2', '0.1.2-rc.1', '0.1.5-rc.2'])
  assert.deepEqual(update.compatibility.testFixtures.historicalPreviews, ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2'])
  assert.equal(update.compatibility.testFixtures.workspaceByVersion['0.1.1-rc.2'], 'dsh-ui-workspace-rc2')
  assert.equal(update.compatibility.testFixtures.previewWorkspaceAlias, 'dsh-ui-workspace-0-1-7-rc-2')
  assert.equal(update.compatibility.testFixtures.legacyWorkspaceAlias, 'dsh-ui-workspace-rc2')
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-ui-workspace'], targets[0])
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-ui-primitives'], targets[0])
  assert.equal(update.manifest.devDependencies['@deepseek-ai/dsh-client-runtime'], '0.1.1-rc.2')
  assert.equal(update.manifest.devDependencies['dsh-ui-workspace-0-1-5-rc-2'], 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2')
  for (const name of Object.keys(update.manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))) {
    assert.equal(update.manifest.peerDependencies[name], targets.join(' || '))
    assert.deepEqual(update.manifest.peerDependencies[name].split(' || '), targets)
  }
  assert.deepEqual(boundedArtifactPaths(update), ['README.md', 'README.en.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md'])
  assert.equal(rewriteWorkspaceCohort('pkg@0.1.5-rc.2', update), 'pkg@0.2.0-rc.2')
  assert.equal(planCompatibilityUpdate({ ...state, compatibility: { ...state.compatibility, releaseTargets: targets } }, targets), null)
  assert.throws(() => planCompatibilityUpdate(state, [...targets].reverse()), /descending semver order/u)
  assert.throws(() => planCompatibilityUpdate(state, targets.slice(0, 2)), /newest three/u)
})

test('generates compatibility blocks and rewrites all fixed package-version references', () => {
  const chinese = rewriteCompatibilityBlock('before\n<!-- dsh-compatibility -->\nold\n<!-- /dsh-compatibility -->\nafter', targets, 'zh')
  const english = rewriteCompatibilityBlock('<!-- dsh-compatibility -->\nold\n<!-- /dsh-compatibility -->', targets, 'en')
  assert.match(chinese, /当前版本支持 DeepSeek Harness `0\.2\.0-rc\.2`、`0\.2\.0-rc\.1`、`0\.1\.7-rc\.2`。/u)
  assert.match(english, /This release supports DeepSeek Harness `0\.2\.0-rc\.2`, `0\.2\.0-rc\.1`, `0\.1\.7-rc\.2`\./u)
  assert.equal(rewriteInstallationCompatibility('**版本 1.5.4 支持 DSH 内核 `old`。**', '1.5.5', targets, 'zh'),
    '**版本 1.5.5 支持 DSH 内核 `0.2.0-rc.2`、`0.2.0-rc.1`、`0.1.7-rc.2`。**')
  assert.equal(rewriteReleaseVersion('1.5.4 and @1.5.4 and v1.5.4', '1.5.4', '1.5.5'), '1.5.5 and @1.5.5 and v1.5.5')
  assert.equal(rewriteDshVersion('Core 0.1.5-rc.2', '0.1.5-rc.2', targets[0]), 'Core 0.2.0-rc.2')
  assert.throws(() => rewriteCompatibilityBlock('no marker', targets, 'en'), /missing generated/u)
})

test('selects the greatest observed registry tag and enforces the release-age cohort', () => {
  assert.equal(selectNewestPublishedTag({ latest: '0.1.9', next: '0.2.0-rc.2', alpha: '0.2.0-alpha.3' }), '0.2.0-rc.2')
  const lockfile = `lockfileVersion: '9.0'\n\npackages:\n  '@deepseek-ai/dsh-client-ui-workspace@0.2.0-rc.2':\n  '@deepseek-ai/dsh-client-runtime@0.1.1-rc.2':\n\nsnapshots:\n  marker: true\n`
  assert.deepEqual(extractDeepSeekReleaseAgeSelectors(lockfile), [
    '@deepseek-ai/dsh-client-runtime@0.1.1-rc.2',
    '@deepseek-ai/dsh-client-ui-workspace@0.2.0-rc.2',
  ])
  const workspace = `minimumReleaseAge: 1440\n# dsh-compat-release-age-start\nminimumReleaseAgeExclude:\n  - old\n# dsh-compat-release-age-end\n`
  assert.match(rewriteReleaseAgeCohort(workspace, ['@deepseek-ai/dsh-client-ui-workspace@0.2.0-rc.2']), /minimumReleaseAgeExclude:\n  - '@deepseek-ai\/dsh-client-ui-workspace@0\.2\.0-rc\.2'/u)
})

test('a package that upstream did not republish keeps its newest release at or below the target core', () => {
  assert.equal(devVersionFor(['0.2.0-rc.2', '0.2.1-alpha.1'], '0.2.1-alpha.1'), '0.2.1-alpha.1')
  assert.equal(devVersionFor(['0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.0.1-rc.1'], '0.2.1-alpha.1'), '0.2.0-rc.2')
  assert.equal(devVersionFor(undefined, '0.2.1-alpha.1'), '0.2.1-alpha.1')
  assert.throws(() => devVersionFor(['0.3.0'], '0.2.1-alpha.1'), /no published release/u)
})
