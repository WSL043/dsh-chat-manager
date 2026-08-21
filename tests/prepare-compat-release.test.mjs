import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareDshVersions,
  planCompatibilityUpdate,
  rewriteCompatibilityBlock,
  rewriteDshVersion,
  rewriteReleaseVersion,
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
    name: 'dsh-native-session-delete',
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

test('queues the oldest untested registry version so missed releases need no manual catch-up', () => {
  const versions = ['0.1.0-rc.10', '0.1.0-rc.8', '0.1.0-rc.9', '0.1.0-rc.7']
  assert.equal(selectNextUntestedVersion(versions, '0.1.0-rc.8'), '0.1.0-rc.9')
  assert.equal(selectNextUntestedVersion(versions, '0.1.0-rc.10'), null)
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
    "releases/download/v1.0.2/install.ps1",
    'dsh-native-session-delete@1.0.2',
    'raw.githubusercontent.com/WSL043/dsh-native-session-delete/v1.0.2/AGENTS.md',
  ].join('\n')
  const rewritten = rewriteReleaseVersion(source, '1.0.2', '1.0.3')
  assert.match(rewritten, /keep historical v1\.0\.3 text/)
  assert.doesNotMatch(rewritten, /v1\.0\.2/)
  assert.match(rewritten, /releases\/download\/v1\.0\.3\/install\.ps1/)
  assert.match(rewritten, /dsh-native-session-delete@1\.0\.3/)
  assert.match(rewritten, /dsh-native-session-delete\/v1\.0\.3\/AGENTS\.md/)

  const document = 'before\n<!-- dsh-compatibility -->stale<!-- /dsh-compatibility -->\nafter'
  const block = rewriteCompatibilityBlock(document, ['0.1.0-rc.6', '0.1.0-rc.9'], 'zh')
  assert.match(block, /已自动验收：`0\.1\.0-rc\.6`、`0\.1\.0-rc\.9`/)
  assert.doesNotMatch(block, /stale/)

  assert.match(
    rewriteDshVersion('workspace version 0.1.0-rc.8', '0.1.0-rc.8', '0.1.0-rc.9'),
    /workspace version 0\.1\.0-rc\.9/,
  )
  assert.throws(
    () => rewriteDshVersion('unrelated notice', '0.1.0-rc.8', '0.1.0-rc.9'),
    /was not found/,
  )
})
