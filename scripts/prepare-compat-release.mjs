import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RELEASE_AGE_START = '# dsh-compat-release-age-start'
const RELEASE_AGE_END = '# dsh-compat-release-age-end'

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

function parseVersion(version) {
  const match = VERSION_RE.exec(version)
  if (match === null) throw new Error(`invalid DSH version: ${version}`)
  return {
    raw: version,
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.').map(value => /^\d+$/.test(value) ? Number(value) : value) ?? [],
  }
}

export function compareDshVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? -1 : 1
    if (av === bv) continue
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    if (typeof av === 'number') return -1
    if (typeof bv === 'number') return 1
    return av.localeCompare(bv)
  }
  return 0
}

export function selectNewestPublishedTag(distTags) {
  const versions = Object.values(distTags).filter(value => typeof value === 'string')
  if (versions.length === 0) throw new Error('the DSH registry returned no version tags')
  return versions.reduce((newest, version) => compareDshVersions(version, newest) > 0 ? version : newest)
}

export function selectNextUntestedVersion(versions, current) {
  parseVersion(current)
  const candidates = [...new Set(versions)]
    .filter(version => typeof version === 'string' && compareDshVersions(version, current) > 0)
    .sort(compareDshVersions)
  return candidates[0] ?? null
}

function bumpPatch(version) {
  const parsed = parseVersion(version)
  if (parsed.prerelease.length > 0) throw new Error(`plugin version must be stable: ${version}`)
  return `${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2] + 1}`
}

function fixtureName(version) {
  const rc = /-rc\.(\d+)$/.exec(version)
  return rc === null ? `dsh-ui-workspace-${version.replaceAll('.', '-')}` : `dsh-ui-workspace-rc${rc[1]}`
}

function assertNoSkippedRelease(previous, candidate) {
  const previousMatch = /^(\d+\.\d+\.\d+)-rc\.(\d+)$/.exec(previous)
  const candidateMatch = /^(\d+\.\d+\.\d+)-rc\.(\d+)$/.exec(candidate)
  if (
    previousMatch !== null
    && candidateMatch !== null
    && previousMatch[1] === candidateMatch[1]
    && Number(candidateMatch[2]) > Number(previousMatch[2]) + 1
  ) {
    const missing = `${previousMatch[1]}-rc.${Number(previousMatch[2]) + 1}`
    throw new Error(`refusing to skip untested DSH version ${missing}`)
  }
}

export function planCompatibilityUpdate(state, candidate) {
  parseVersion(candidate)
  const previous = state.compatibility.latestTested
  const order = compareDshVersions(candidate, previous)
  if (order === 0) return null
  if (order < 0) throw new Error(`DSH candidate ${candidate} is older than latest tested ${previous}`)
  assertNoSkippedRelease(previous, candidate)

  const compatibility = structuredClone(state.compatibility)
  compatibility.latestTested = candidate
  compatibility.supported.push(candidate)
  const previousFixture = fixtureName(previous)
  compatibility.workspaceFixtures[previous] = previousFixture

  const manifest = structuredClone(state.manifest)
  const previousPluginVersion = manifest.version
  manifest.version = bumpPatch(previousPluginVersion)
  for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = candidate
  }
  manifest.devDependencies[previousFixture] = `npm:@deepseek-ai/dsh-client-ui-workspace@${previous}`
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = `${range} || ${candidate}`
  }

  return {
    previousPluginVersion,
    pluginVersion: manifest.version,
    previousDshVersion: previous,
    dshVersion: candidate,
    compatibility,
    manifest,
  }
}

export function rewriteReleaseVersion(source, previousVersion, nextVersion) {
  return source
    .replaceAll(`v${previousVersion}`, `v${nextVersion}`)
    .replaceAll(`@${previousVersion}`, `@${nextVersion}`)
}

export function rewriteDshVersion(source, previousVersion, nextVersion) {
  const rewritten = source.replaceAll(previousVersion, nextVersion)
  if (rewritten === source) throw new Error(`DSH version ${previousVersion} was not found in bounded artifact`)
  return rewritten
}

export function rewriteCompatibilityBlock(source, supported, language) {
  const marker = /<!-- dsh-compatibility -->[\s\S]*?<!-- \/dsh-compatibility -->/
  if (!marker.test(source)) throw new Error(`missing generated DSH compatibility block (${language})`)
  const versions = supported.map(version => `\`${version}\``)
  const body = language === 'zh'
    ? `支持 DeepSeek Harness：${versions.join('、')}。`
    : `Supports DeepSeek Harness: ${versions.join(', ')}.`
  return source.replace(marker, `<!-- dsh-compatibility -->\n${body}\n<!-- /dsh-compatibility -->`)
}

export function extractDeepSeekReleaseAgeSelectors(lockfile) {
  const packagesStart = lockfile.indexOf('\npackages:\n')
  const snapshotsStart = lockfile.indexOf('\nsnapshots:\n')
  if (packagesStart === -1 || snapshotsStart === -1 || snapshotsStart <= packagesStart) {
    throw new Error('pnpm lockfile does not contain packages and snapshots sections')
  }
  const packages = lockfile.slice(packagesStart, snapshotsStart)
  const selectors = [...packages.matchAll(/^  '(@deepseek-ai\/[^']+@[^']+)':$/gmu)].map(match => match[1])
  if (selectors.length === 0) throw new Error('pnpm lockfile contains no @deepseek-ai package selectors')
  return [...new Set(selectors)].sort()
}

export function rewriteReleaseAgeCohort(workspace, selectors) {
  const start = workspace.indexOf(RELEASE_AGE_START)
  const end = workspace.indexOf(RELEASE_AGE_END)
  if (start === -1 || end === -1 || end <= start) throw new Error('missing bounded DSH release-age markers')
  const block = [
    RELEASE_AGE_START,
    'minimumReleaseAgeExclude:',
    ...selectors.map(selector => `  - '${selector}'`),
    RELEASE_AGE_END,
  ].join('\n')
  return `${workspace.slice(0, start)}${block}${workspace.slice(end + RELEASE_AGE_END.length)}`
}

async function refreshReleaseAge(root) {
  const [workspace, lockfile] = await Promise.all([
    readFile(resolve(root, 'pnpm-workspace.yaml'), 'utf8'),
    readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'),
  ])
  const selectors = extractDeepSeekReleaseAgeSelectors(lockfile)
  await writeFile(resolve(root, 'pnpm-workspace.yaml'), rewriteReleaseAgeCohort(workspace, selectors))
  return { changed: true, selectors: selectors.length }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv.includes('--refresh-release-age')) return refreshReleaseAge(root)
  const candidateIndex = process.argv.indexOf('--dsh-version')
  const candidate = candidateIndex === -1 ? undefined : process.argv[candidateIndex + 1]
  if (candidate === undefined) throw new Error('--dsh-version is required')
  const compatibilityPath = resolve(root, 'compatibility.json')
  const manifestPath = resolve(root, 'package.json')
  const [compatibility, manifest] = await Promise.all([
    readFile(compatibilityPath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(JSON.parse),
  ])
  const update = planCompatibilityUpdate({ compatibility, manifest }, candidate)
  if (update === null) {
    process.stdout.write(`${JSON.stringify({ changed: false, dshVersion: candidate })}\n`)
    return
  }
  const textPaths = ['README.md', 'README.zh-CN.md', 'AGENTS.md', 'install.ps1', 'THIRD_PARTY_NOTICES.md']
  const textSources = await Promise.all(textPaths.map(path => readFile(resolve(root, path), 'utf8')))
  const rewritten = textSources.map(source => rewriteReleaseVersion(
    source,
    update.previousPluginVersion,
    update.pluginVersion,
  ))
  rewritten[0] = rewriteCompatibilityBlock(rewritten[0], update.compatibility.supported, 'zh')
  rewritten[1] = rewriteCompatibilityBlock(rewritten[1], update.compatibility.supported, 'en')
  rewritten[4] = rewriteDshVersion(rewritten[4], update.previousDshVersion, update.dshVersion)

  const workspacePath = resolve(root, 'pnpm-workspace.yaml')
  const workspace = await readFile(workspacePath, 'utf8')
  const nextWorkspace = workspace.replaceAll(
    `@${update.previousDshVersion}`,
    `@${update.dshVersion}`,
  )
  if (nextWorkspace === workspace) throw new Error(`pnpm release cohort ${update.previousDshVersion} was not found`)

  await Promise.all([
    writeFile(compatibilityPath, `${JSON.stringify(update.compatibility, null, 2)}\n`),
    writeFile(manifestPath, `${JSON.stringify(update.manifest, null, 2)}\n`),
    writeFile(workspacePath, nextWorkspace),
    ...textPaths.map((path, index) => writeFile(resolve(root, path), rewritten[index])),
  ])
  process.stdout.write(`${JSON.stringify({ changed: true, ...update })}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
