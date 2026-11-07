import { createHash } from 'node:crypto'
import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const CORE_VERSION = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/
const CORE_NAME = '@deepseek-ai/dsh'
const GITHUB_REPO = 'https://api.github.com/repos/deepseek-ai/deepseek-harness'
const REGISTRY = 'https://registry.npmjs.org'

function order(version) {
  if (!CORE_VERSION.test(version)) throw Error('Expected a fixed DSH final or RC version')
  const [base, rc] = version.split('-rc.')
  return [...base.split('.').map(BigInt), rc === undefined ? 1n : 0n, BigInt(rc ?? 0)]
}

function compare(a, b) {
  const right = order(b)
  for (const [index, value] of order(a).entries()) {
    if (value !== right[index]) return value > right[index] ? 1 : -1
  }
  return 0
}

export function newestOfficialCore(tags) {
  const versions = [tags?.latest, tags?.next].filter(value => typeof value === 'string' && CORE_VERSION.test(value))
  if (!versions.length) throw Error('No official final or RC on the latest and next channels')
  return versions.sort((a, b) => compare(b, a))[0]
}

export function planCompatibilityUpdate(manifest, compatibility, newest, cores) {
  if (!/^2\.\d+\.\d+$/.test(manifest.version) || manifest.publishConfig?.tag !== 'latest') throw Error('Expected a final v2 package')
  const [current] = compatibility.releaseTargets
  if (compare(newest, current) <= 0) return null
  const targets = [newest, current]
  if (cores.length !== targets.length || cores.some((core, index) => core.version !== targets[index]
    || !/^[a-f0-9]{40}$/.test(core.commit) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(core.integrity)
    || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(core.cordis))) throw Error('Incomplete official release evidence')

  const next = structuredClone(manifest)
  const [major, minor, patch] = manifest.version.split('.')
  next.version = [major, minor, BigInt(patch) + 1n].join('.')
  for (const peer of Object.keys(next.peerDependencies)) {
    if (peer.startsWith('@deepseek-ai/dsh-')) next.peerDependencies[peer] = targets.join(' || ')
  }
  next.peerDependencies['@deepseek-ai/cordis'] = [...new Set(cores.map(core => core.cordis))].join(' || ')
  return {
    manifest: next,
    compatibility: {
      releaseTargets: targets,
      latestTested: newest,
      upstream: cores,
      autoFollowFrom: manifest.version,
    },
  }
}

async function get(url, options = {}) {
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60_000) })
}

async function json(url, options) {
  const response = await get(url, options)
  if (!response.ok) throw Error('Registry or release API returned HTTP ' + response.status)
  return response.json()
}

export async function officialCore(version, token) {
  order(version)
  const tag = 'dsh-v' + version
  const headers = token ? { Authorization: 'Bearer ' + token } : {}
  const release = await get(GITHUB_REPO + '/releases/tags/' + tag, { headers })
  if (release.status === 404) return null
  if (!release.ok) throw Error('GitHub release API returned HTTP ' + release.status)
  const details = await release.json()
  if (details.tag_name !== tag || details.draft !== false || details.immutable !== true || !details.published_at) {
    throw Error('Official DSH release is not immutable and published: ' + tag)
  }
  const ref = await json(GITHUB_REPO + '/git/ref/tags/' + tag, { headers })
  const object = ref.object
  if (!/^[a-f0-9]{40}$/.test(object?.sha) || !['tag', 'commit'].includes(object.type)) throw Error('Invalid official Git tag')
  const commit = object.type === 'commit' ? object.sha
    : await json(GITHUB_REPO + '/git/tags/' + object.sha, { headers }).then(({ object }) =>
        object?.type === 'commit' ? object.sha : undefined)
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid official commit')

  const packageInfo = await json(REGISTRY + '/' + encodeURIComponent(CORE_NAME) + '/' + version)
  const { integrity, tarball } = packageInfo.dist ?? {}
  const cordis = /^[~^]?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.exec(packageInfo.dependencies?.['@deepseek-ai/cordis'])?.[1]
  const url = new URL(tarball)
  if (packageInfo.name !== CORE_NAME || packageInfo.version !== version || !cordis
    || url.origin !== REGISTRY || url.pathname !== '/@deepseek-ai/dsh/-/dsh-' + version + '.tgz'
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw Error('Unexpected official registry package metadata')
  const response = await get(url)
  if (!response.ok) throw Error('Official tarball unavailable')
  const digest = createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64')
  if ('sha512-' + digest !== integrity) throw Error('Official npm tarball integrity mismatch')
  return { version, commit, integrity, cordis }
}

async function main() {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const compatibility = JSON.parse(await readFile('compatibility.json', 'utf8'))
  const registry = await json(REGISTRY + '/' + encodeURIComponent(CORE_NAME), { headers: { Accept: 'application/vnd.npm.install-v1+json' } })
  const newest = newestOfficialCore(registry['dist-tags'])
  const [current] = compatibility.releaseTargets
  const changed = process.env.RECOVER !== 'true' && compare(newest, current) > 0
  const targets = changed ? [newest, current] : compatibility.releaseTargets
  const cores = await Promise.all(targets.map(version => officialCore(version, process.env.GH_TOKEN)))
  const waiting = cores.some(core => core === null)
  if (!waiting) {
    for (const expected of compatibility.upstream) {
      const actual = cores.find(core => core.version === expected.version)
      if (actual && ['commit', 'integrity', 'cordis'].some(key => actual[key] !== expected[key])) {
        throw Error('Official source or package integrity changed')
      }
    }
  }
  const update = waiting || !changed ? null : planCompatibilityUpdate(manifest, compatibility, newest, cores)
  if (update) {
    await writeFile('package.json', JSON.stringify(update.manifest, null, 2) + '\n')
    await writeFile('compatibility.json', JSON.stringify(update.compatibility, null, 2) + '\n')
  }
  const result = { changed: update !== null, waiting, targets, version: update?.manifest.version ?? manifest.version }
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, 'changed=' + result.changed + '\nwaiting=' + waiting
      + '\nversions=' + JSON.stringify(targets) + '\nversion=' + result.version + '\n')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
