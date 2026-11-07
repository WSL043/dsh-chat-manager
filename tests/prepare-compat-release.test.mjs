import assert from 'node:assert/strict'
import test from 'node:test'
import { newestOfficialCore, planCompatibilityUpdate } from '../scripts/prepare-compat-release.mjs'

const current = '0.2.2-rc.1'
const next = '0.2.2-rc.2'
const core = (version, cordis) => ({ version, cordis, commit: 'a'.repeat(40), integrity: 'sha512-' + 'a'.repeat(86) + '==' })
const manifest = {
  version: '2.0.0',
  publishConfig: { tag: 'latest' },
  peerDependencies: { '@deepseek-ai/cordis': '4.1.0', '@deepseek-ai/dsh-client-ui-context-menu': current, react: '^18.2.0' },
}
const compatibility = { releaseTargets: [current], upstream: [core(current, '4.1.0')] }

test('official latest and next resolve final and RC numerically, without an alpha displacing them', () => {
  assert.equal(newestOfficialCore({ latest: '0.2.2-rc.9', next: '0.2.2-rc.10', alpha: '0.3.0-alpha.3' }), '0.2.2-rc.10')
  assert.equal(newestOfficialCore({ latest: '0.2.2', next: '0.2.2-rc.10' }), '0.2.2')
  assert.throws(() => newestOfficialCore({ latest: '0.3.0-alpha.1' }), /No official/)
})

test('new core stages one patch with exactly the new and preceding qualified peers', () => {
  const cores = [core(next, '4.2.0'), core(current, '4.1.0')]
  const update = planCompatibilityUpdate(manifest, compatibility, next, cores)
  assert.equal(update.manifest.version, '2.0.1')
  assert.deepEqual(update.manifest.peerDependencies, {
    '@deepseek-ai/cordis': '4.2.0 || 4.1.0',
    '@deepseek-ai/dsh-client-ui-context-menu': next + ' || ' + current,
    react: '^18.2.0',
  })
  assert.deepEqual(update.compatibility, { releaseTargets: [next, current], latestTested: next, upstream: cores, autoFollowFrom: '2.0.0' })
  assert.equal(manifest.version, '2.0.0')
  assert.equal(planCompatibilityUpdate(update.manifest, update.compatibility, current, []), null)
  assert.equal(planCompatibilityUpdate(update.manifest, update.compatibility, next, []), null)
})

test('promotion planning refuses incomplete, misordered or unpinned official evidence', () => {
  const old = core(current, '4.1.0'), candidate = core(next, '4.1.0')
  for (const cores of [[candidate], [old, candidate], [{ ...candidate, integrity: null }, old], [{ ...candidate, cordis: '^4.1.0' }, old]]) {
    assert.throws(() => planCompatibilityUpdate(manifest, compatibility, next, cores), /official release evidence/)
  }
  assert.throws(() => planCompatibilityUpdate({ ...manifest, version: '2.0.0-alpha.1' }, compatibility, next, [candidate, old]), /final v2/)
})
