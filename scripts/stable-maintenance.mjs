import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const RUNTIME_FIELDS = ['name', 'main', 'exports', 'files', 'dsh', 'engines', 'dependencies', 'optionalDependencies', 'peerDependenciesMeta']

// Admission to the stable maintenance lane is separate from actual core acceptance.
// Only compatibility metadata may advance beyond the immutable npm latest source.
export function validateStableMaintenance({ latest, baseline, maintenance, expectedName }) {
  const published = STABLE_VERSION.exec(String(latest))
  const candidate = STABLE_VERSION.exec(String(maintenance?.version))
  if (!published || !candidate) throw new Error('stable maintenance requires stable published and candidate versions')
  if (baseline?.version !== latest || baseline?.name !== expectedName || maintenance?.name !== expectedName) {
    throw new Error('stable maintenance must use the exact published package baseline')
  }
  if ((maintenance.publishConfig?.tag ?? 'latest') !== 'latest') throw new Error('stable maintenance cannot publish a development channel')
  if (published[1] !== candidate[1] || published[2] !== candidate[2] || BigInt(candidate[3]) < BigInt(published[3])) {
    throw new Error('stable maintenance may only retain or advance the published patch version')
  }
  for (const field of RUNTIME_FIELDS) {
    assert.deepEqual(maintenance[field], baseline[field], 'stable maintenance changed runtime manifest field: ' + field)
  }
  return { latest, version: maintenance.version }
}

// npm package versions cannot be overwritten; legacy GitHub releases may predate
// immutable releases. Authenticate the registry archive and pin the bootstrap source.
export async function authenticateStableArchive({ name, version, bootstrap }, request = fetch) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || !STABLE_VERSION.test(String(version))) throw new Error('invalid stable registry package or version')
  const metadataResponse = await request('https://registry.npmjs.org/' + name + '/' + version, { redirect: 'error' })
  if (!metadataResponse.ok) throw new Error('stable registry metadata unavailable')
  const metadata = await metadataResponse.json()
  const integrity = metadata.dist?.integrity
  if (metadata.name !== name || metadata.version !== version || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(String(integrity))) throw new Error('invalid stable registry identity or integrity')
  if (version === bootstrap.version && integrity !== bootstrap.npmIntegrity) throw new Error('stable bootstrap npm integrity changed')
  const expectedUrl = 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz'
  if (metadata.dist.tarball !== expectedUrl) throw new Error('unexpected stable archive origin')
  const archive = await request(expectedUrl, { redirect: 'error' })
  if (!archive.ok) throw new Error('stable registry archive unavailable')
  const digest = 'sha512-' + createHash('sha512').update(Buffer.from(await archive.arrayBuffer())).digest('base64')
  if (digest !== integrity) throw new Error('stable registry archive integrity mismatch')
  return { name, version, integrity }
}
