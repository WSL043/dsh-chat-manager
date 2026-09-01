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
  const compatibility = typeof current === 'string'
    ? { latestTested: current, supported: [current], previews: [] }
    : current
  parseVersion(compatibility.latestTested)
  const tested = new Set([...(compatibility.supported ?? []), ...(compatibility.previews ?? [])])
  const previewFloor = [...(compatibility.previews ?? [])].sort(compareDshVersions).at(-1)
    ?? compatibility.latestTested
  const candidates = [...new Set(versions)]
    .filter(version => typeof version === 'string'
      && !tested.has(version)
      && compareDshVersions(version, isPreviewVersion(version) ? previewFloor : compatibility.latestTested) > 0)
    .sort(compareDshVersions)
  return candidates[0] ?? null
}

function isPreviewVersion(version) {
  const [channel] = parseVersion(version).prerelease
  return channel === 'alpha' || channel === 'beta'
}

function nextStableVersion(version) {
  const parsed = parseVersion(version)
  if (parsed.prerelease.length > 0) {
    if (parsed.prerelease[0] !== 'beta') throw new Error(`unsupported plugin prerelease: ${version}`)
    return parsed.core.join('.')
  }
  return `${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2] + 1}`
}

function nextBetaVersion(version) {
  const parsed = parseVersion(version)
  if (parsed.prerelease.length === 0) return `${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2] + 1}-beta.0`
  if (parsed.prerelease.length !== 2 || parsed.prerelease[0] !== 'beta'
    || !Number.isInteger(parsed.prerelease[1])) throw new Error(`unsupported plugin prerelease: ${version}`)
  return `${parsed.core.join('.')}-beta.${parsed.prerelease[1] + 1}`
}

function fixtureName(version) {
  const rc = /-rc\.(\d+)$/.exec(version)
  const alpha = /-alpha\.(\d+)$/.exec(version)
  if (alpha !== null) return `dsh-ui-workspace-alpha${alpha[1]}`
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
  const preview = isPreviewVersion(candidate)
  const lane = preview ? (state.compatibility.previews ?? []) : state.compatibility.supported
  const previous = preview
    ? [...lane].sort(compareDshVersions).at(-1) ?? state.compatibility.latestTested
    : state.compatibility.latestTested
  const order = compareDshVersions(candidate, previous)
  if (order === 0) return null
  if (order < 0) throw new Error(`DSH candidate ${candidate} is older than latest tested ${previous}`)
  if (!preview) assertNoSkippedRelease(previous, candidate)

  const compatibility = structuredClone(state.compatibility)
  compatibility.previews ??= []
  let previousFixture
  if (preview) {
    compatibility.previews = [...new Set([...compatibility.previews, candidate])].sort(compareDshVersions)
    compatibility.previewWorkspaceFixture = fixtureName(candidate)
  } else {
    compatibility.latestTested = candidate
    compatibility.supported = [...new Set([...compatibility.supported, candidate])].sort(compareDshVersions)
    previousFixture = fixtureName(previous)
    compatibility.workspaceFixtures[previous] = previousFixture
  }

  const manifest = structuredClone(state.manifest)
  const previousPluginVersion = manifest.version
  manifest.version = preview ? nextBetaVersion(previousPluginVersion) : nextStableVersion(previousPluginVersion)
  if (!preview) {
    for (const name of Object.keys(manifest.devDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = candidate
    }
  }
  if (preview) {
    const previewFixture = fixtureName(candidate)
    manifest.devDependencies[previewFixture] = `npm:@deepseek-ai/dsh-client-ui-workspace@${candidate}`
  } else {
    manifest.devDependencies[previousFixture] = `npm:@deepseek-ai/dsh-client-ui-workspace@${previous}`
  }
  const supportedRange = [...compatibility.supported, ...compatibility.previews].sort(compareDshVersions).join(' || ')
  for (const name of Object.keys(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = supportedRange
  }

  return {
    previousPluginVersion,
    pluginVersion: manifest.version,
    previousDshVersion: previous,
    dshVersion: candidate,
    updateStableReferences: !preview,
    compatibility,
    manifest,
  }
}

export function boundedArtifactPaths(update) {
  return update.updateStableReferences ? ['README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md'] : []
}

export function rewriteWorkspaceCohort(workspace, update) {
  if (!update.updateStableReferences) return workspace
  const rewritten = workspace.replaceAll(`@${update.previousDshVersion}`, `@${update.dshVersion}`)
  if (rewritten === workspace) throw new Error(`pnpm release cohort ${update.previousDshVersion} was not found`)
  return rewritten
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
  const latest = supported.at(-1)
  if (latest === undefined) throw new Error('supported DSH versions cannot be empty')
  const body = language === 'zh'
    ? `支持最新版 DeepSeek Harness（\`${latest}\`）。`
    : `Supports the latest DeepSeek Harness release (\`${latest}\`).`
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
  const textPaths = boundedArtifactPaths(update)
  const textSources = await Promise.all(textPaths.map(path => readFile(resolve(root, path), 'utf8')))
  const rewritten = textSources.map(source => rewriteReleaseVersion(
    source,
    update.previousPluginVersion,
    update.pluginVersion,
  ))
  if (update.updateStableReferences) {
    rewritten[0] = rewriteCompatibilityBlock(rewritten[0], update.compatibility.supported, 'zh')
    rewritten[2] = rewriteDshVersion(rewritten[2], update.previousDshVersion, update.dshVersion)
  }

  const workspacePath = resolve(root, 'pnpm-workspace.yaml')
  const workspace = await readFile(workspacePath, 'utf8')
  const nextWorkspace = rewriteWorkspaceCohort(workspace, update)

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
