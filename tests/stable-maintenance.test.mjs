import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStableMaintenance } from '../scripts/stable-maintenance.mjs'

const fixture = () => {
  const baseline = { name: 'example-plugin', version: '1.5.19', main: './lib/index.js', dsh: { client: { platform: 'web' } }, dependencies: { helper: '1.0.0' }, peerDependencies: { host: '0.2.1-rc.4' } }
  return { latest: '1.5.19', baseline, maintenance: structuredClone(baseline), expectedName: baseline.name }
}

test('stable maintenance admits current and recovery patch metadata without development runtime', () => {
  const state = fixture()
  assert.deepEqual(validateStableMaintenance(state), { latest: '1.5.19', version: '1.5.19' })
  state.maintenance.version = '1.5.20'
  state.maintenance.peerDependencies.host += ' || 0.2.1-rc.5'
  state.maintenance.devDependencies = { host: '0.2.1-rc.5' }
  assert.equal(validateStableMaintenance(state).version, '1.5.20')
})

test('stable maintenance refuses next candidates, another package, runtime changes and version jumps', () => {
  for (const edit of [
    state => { state.latest = '2.0.0-alpha.1' },
    state => { state.baseline.version = '1.5.18' },
    state => { state.maintenance.version = '2.0.0-alpha.1' },
    state => { state.maintenance.version = '2.0.0' },
    state => { state.maintenance.version = '1.6.0' },
    state => { state.maintenance.version = '1.5.18' },
    state => { state.maintenance.publishConfig = { tag: 'next' } },
    state => { state.maintenance.name = 'another-plugin' },
    state => { state.maintenance.dsh.client.platform = 'desktop' },
    state => { state.maintenance.dependencies.helper = '2.0.0' },
  ]) { const state = fixture(); edit(state); assert.throws(() => validateStableMaintenance(state)) }
})

test('development forwarding and stable publication retain the same acceptance pipeline', async () => {
  const { readFile } = await import('node:fs/promises')
  const upstream = await readFile(new URL('../.github/workflows/upstream-compatibility.yml', import.meta.url), 'utf8')
  const publish = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  assert.match(upstream, /gh workflow run upstream-compatibility\.yml[^\n]+--ref stable/u)
  assert.match(upstream, /if: steps\.source\.outputs\.forwarded != 'true'/u)
  assert.doesNotMatch(upstream, /Development next candidate: automatic compatibility publication is held/u)
  assert.doesNotMatch(upstream, /ref: main|HEAD:main|--ref main/u)
  assert.match(upstream, /git merge-base --is-ancestor/u)
  assert.match(upstream, /\.immutable == true/u)
  assert.match(upstream, /validateStableMaintenance/u)
  assert.match(upstream, /needs: \[prepare, acceptance\]/u)
  assert.match(upstream, /needs\.acceptance\.result == 'success'/u)
  assert.match(upstream, /git push origin "HEAD:\$GITHUB_REF_NAME"/u)
  assert.match(upstream, /gh workflow run publish\.yml[^\n]+--ref "\$GITHUB_REF_NAME"/u)
  assert.match(publish, /Protect stable compatibility source/u)
  assert.match(publish, /validateStableMaintenance/u)
  assert.match(publish, /refs\/heads\/main \|\| "\$GITHUB_REF" == refs\/heads\/stable/u)
})

test('registry archive authentication verifies immutable npm bytes and the fixed bootstrap', async () => {
  const { createHash } = await import('node:crypto')
  const { authenticateStableArchive } = await import('../scripts/stable-maintenance.mjs')
  const bytes = Buffer.from('published stable archive')
  const name = 'example-plugin', version = '1.5.19'
  const npmIntegrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  const bootstrap = { version, npmIntegrity }
  const metadata = { name, version, dist: { integrity: npmIntegrity, tarball: 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz' } }
  const urls = []
  const request = async url => { urls.push(url); return url.endsWith('.tgz') ? { ok: true, arrayBuffer: async () => bytes } : { ok: true, json: async () => metadata } }
  assert.equal((await authenticateStableArchive({ name, version, bootstrap }, request)).integrity, npmIntegrity)
  assert.deepEqual(urls, ['https://registry.npmjs.org/example-plugin/1.5.19', metadata.dist.tarball])
  await assert.rejects(authenticateStableArchive({ name, version, bootstrap: { version, npmIntegrity: 'changed' } }, request), /bootstrap npm integrity changed/u)
  const corrupt = async url => url.endsWith('.tgz') ? { ok: true, arrayBuffer: async () => Buffer.from('changed') } : { ok: true, json: async () => metadata }
  await assert.rejects(authenticateStableArchive({ name, version, bootstrap }, corrupt), /archive integrity mismatch/u)
  const external = { ...metadata, dist: { ...metadata.dist, tarball: 'https://example.com/archive.tgz' } }
  await assert.rejects(authenticateStableArchive({ name, version, bootstrap }, async () => ({ ok: true, json: async () => external })), /archive origin/u)
  await assert.rejects(authenticateStableArchive({ name, version: '../../private', bootstrap }, request), /invalid stable registry/u)
})

test('a second published compatibility patch accepts its own new npm integrity without moving bootstrap', async () => {
  const { createHash } = await import('node:crypto')
  const { authenticateStableArchive } = await import('../scripts/stable-maintenance.mjs')
  const state = fixture()
  const bootstrap = { version: state.latest, npmIntegrity: 'sha512-' + createHash('sha512').update('bootstrap archive').digest('base64') }
  const published = structuredClone(state.baseline)
  published.version = '1.5.20'
  published.peerDependencies.host += ' || 0.2.1-rc.5'
  assert.equal(validateStableMaintenance({ ...state, maintenance: published }).version, '1.5.20')
  const next = structuredClone(published)
  next.version = '1.5.21'
  next.peerDependencies.host += ' || 0.2.1-rc.6'
  assert.equal(validateStableMaintenance({ ...state, latest: published.version, baseline: published, maintenance: next }).version, '1.5.21')
  const bytes = Buffer.from('second published compatibility archive')
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  assert.notEqual(integrity, bootstrap.npmIntegrity)
  const tarball = 'https://registry.npmjs.org/example-plugin/-/example-plugin-1.5.20.tgz'
  const request = async url => url === tarball ? { ok: true, arrayBuffer: async () => bytes }
    : { ok: true, json: async () => ({ name: 'example-plugin', version: published.version, dist: { integrity, tarball } }) }
  const proof = await authenticateStableArchive({ name: 'example-plugin', version: published.version, bootstrap }, request)
  assert.equal(proof.integrity, integrity)
  assert.equal(bootstrap.version, '1.5.19')
  assert.equal(next.peerDependencies.host.includes('0.2.1-rc.6'), true)
})
