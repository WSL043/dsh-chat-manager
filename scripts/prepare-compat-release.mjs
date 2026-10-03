import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RELEASE_AGE_START = '# dsh-compat-release-age-start'
const RELEASE_AGE_END = '# dsh-compat-release-age-end'

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const RELEASE_TARGET_COUNT = 3

function parseVersion(version) {
  const match = VERSION_RE.exec(version)
  if (match === null) throw new Error(`invalid DSH version: ${version}`)
  const prerelease = match[4]?.split('.') ?? []
  const build = match[5]?.split('.') ?? []
  if (prerelease.some(value => !/^[0-9A-Za-z-]+$/.test(value)
    || (/^\d+$/.test(value) && value.length > 1 && value.startsWith('0')))
    || build.some(value => !/^[0-9A-Za-z-]+$/.test(value))) {
    throw new Error(`invalid DSH version: ${version}`)
  }
  return {
    raw: version,
    core: match.slice(1, 4).map(BigInt),
    prerelease: prerelease.map(value => /^\d+$/.test(value) ? BigInt(value) : value),
  }
}

export function compareDshVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
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
    if (typeof av === 'bigint' && typeof bv === 'bigint') return av < bv ? -1 : 1
    if (typeof av === 'bigint') return -1
    if (typeof bv === 'bigint') return 1
    return av < bv ? -1 : 1
  }
  return 0
}

export function selectNewestPublishedTag(distTags) {
  const versions = Object.values(distTags).filter(value => typeof value === 'string')
  if (versions.length === 0) throw new Error('the DSH registry returned no version tags')
  return versions.reduce((newest, version) => compareDshVersions(version, newest) > 0 ? version : newest)
}

export function selectLatestDshVersions(versions, count = RELEASE_TARGET_COUNT) {
  if (!Array.isArray(versions) || !Number.isInteger(count) || count < 1) {
    throw new TypeError('published DSH versions and a positive target count are required')
  }
  const valid = [...new Set(versions.filter(version => {
    if (typeof version !== 'string') return false
    try {
      parseVersion(version)
      return true
    } catch {
      return false
    }
  }))].sort((left, right) => compareDshVersions(right, left))
  if (valid.length < count) throw new Error(`the DSH registry returned fewer than ${count} valid versions`)
  return valid.slice(0, count)
}

function nextStableVersion(version) {
  const parsed = parseVersion(version)
  if (parsed.prerelease.length > 0) {
    if (parsed.prerelease[0] !== 'beta') throw new Error(`unsupported plugin prerelease: ${version}`)
    return parsed.core.join('.')
  }
  return `${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2] + 1n}`
}

function previousDocumentedPluginVersion(version) {
  const parsed = parseVersion(version)
  if (parsed.prerelease.length === 0) return version
  if (parsed.prerelease.length !== 2 || parsed.prerelease[0] !== 'beta'
    || !Number.isInteger(parsed.prerelease[1]) || parsed.core[2] === 0) {
    throw new Error(`unsupported plugin prerelease: ${version}`)
  }
  return `${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2] - 1n}`
}

const LEGACY_PATCH_BEFORE = '0.1.6-alpha.2'

function workspaceFixtureName(version, dependencies = {}) {
  const rc = /-rc\.(\d+)$/.exec(version)
  const name = rc === null ? `dsh-ui-workspace-${version.replaceAll('.', '-')}` : `dsh-ui-workspace-rc${rc[1]}`
  const expected = `npm:@deepseek-ai/dsh-client-ui-workspace@${version}`
  return dependencies[name] && dependencies[name] !== expected
    ? `dsh-ui-workspace-${version.replaceAll('.', '-')}` : name
}

// Upstream does not republish every package with each core: a package without the newest target version
// keeps its newest release at or below that target.
export function devVersionFor(published, target) {
  if (!Array.isArray(published) || published.includes(target)) return target
  const candidates = published.filter(version => {
    try {
      return compareDshVersions(version, target) <= 0
    } catch {
      return false
    }
  }).sort((left, right) => compareDshVersions(right, left))
  if (candidates.length === 0) throw new Error(`no published release at or below ${target}`)
  return candidates[0]
}

export function planCompatibilityUpdate(state, targetVersions, publishedVersions = {}) {
  if (!Array.isArray(targetVersions) || targetVersions.length !== RELEASE_TARGET_COUNT) {
    throw new Error(`exactly the newest three DSH versions are required`)
  }
  const targets = selectLatestDshVersions(targetVersions)
  if (targets.length !== targetVersions.length || targets.some((version, index) => version !== targetVersions[index])) {
    throw new Error('DSH release targets must be exactly the newest three versions in descending semver order')
  }
  const currentTargets = state.compatibility.releaseTargets ?? []
  if (currentTargets.length === targets.length && currentTargets.every((version, index) => version === targets[index])) return null

  const compatibility = structuredClone(state.compatibility)
  const fixtures = compatibility.testFixtures ?? {}
  if (compatibility.supported) fixtures.historicalSupported = [...new Set([...(fixtures.historicalSupported ?? []), ...compatibility.supported])]
  if (compatibility.previews) fixtures.historicalPreviews = [...new Set([...(fixtures.historicalPreviews ?? []), ...compatibility.previews])]
  if (compatibility.workspaceFixtures) fixtures.workspaceByVersion = { ...(fixtures.workspaceByVersion ?? {}), ...compatibility.workspaceFixtures }
  if (compatibility.legacyWorkspaceFixture) fixtures.legacyWorkspaceAlias = compatibility.legacyWorkspaceFixture
  if (compatibility.previewWorkspaceFixture) fixtures.previewWorkspaceAlias = compatibility.previewWorkspaceFixture
  delete compatibility.supported
  delete compatibility.previews
  delete compatibility.workspaceFixtures
  delete compatibility.legacyWorkspaceFixture
  delete compatibility.previewWorkspaceFixture

  const previousDshVersion = compatibility.latestTested
  // Only cores older than the modern workspace (MODERN_WORKSPACE_VERSION in build-modern-client.mjs) are
  // built with the legacy source patch, so only they join the legacy patch-marker fixtures. Newer cores use
  // the official session slots and are covered by the per-core acceptance run instead.
  const legacyPrevious = compareDshVersions(previousDshVersion, LEGACY_PATCH_BEFORE) < 0
  const previousFixture = legacyPrevious ? workspaceFixtureName(previousDshVersion, state.manifest.devDependencies) : null
  fixtures.workspaceByVersion ??= {}
  if (legacyPrevious) fixtures.workspaceByVersion[previousDshVersion] = previousFixture
  fixtures.historicalSupported = [...new Set([...(fixtures.historicalSupported ?? []), previousDshVersion])]
  compatibility.testFixtures = fixtures
  compatibility.releaseTargets = targets
  compatibility.latestTested = targets[0]
  if (Object.hasOwn(compatibility, 'clientTarget')) compatibility.clientTarget = targets[0]

  const manifest = structuredClone(state.manifest)
  const previousPluginVersion = manifest.version
  manifest.version = nextStableVersion(previousPluginVersion)
  for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-') && name !== '@deepseek-ai/dsh-client-runtime') {
      manifest.devDependencies[name] = devVersionFor(publishedVersions[name], targets[0])
    }
  }
  if (legacyPrevious) manifest.devDependencies[previousFixture] = `npm:@deepseek-ai/dsh-client-ui-workspace@${previousDshVersion}`
  const peerRange = targets.join(' || ')
  for (const name of Object.keys(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = peerRange
  }

  return {
    previousPluginVersion,
    previousDocumentedPluginVersion: previousDocumentedPluginVersion(previousPluginVersion),
    pluginVersion: manifest.version,
    previousDshVersion,
    dshVersions: targets,
    compatibility,
    manifest,
  }
}

export function boundedArtifactPaths(update) {
  return ['README.md', 'README.en.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md']
}

export function rewriteWorkspaceCohort(workspace, update) {
  const target = update.dshVersions[0]
  if (update.previousDshVersion === target) return workspace
  const rewritten = workspace.replaceAll(`@${update.previousDshVersion}`, `@${target}`)
  if (rewritten === workspace) throw new Error(`pnpm release cohort ${update.previousDshVersion} was not found`)
  return rewritten
}

export function rewriteReleaseVersion(source, previousVersion, nextVersion) {
  return source.replaceAll(previousVersion, nextVersion)
}

export function rewriteDshVersion(source, previousVersion, nextVersion) {
  const rewritten = source.replaceAll(previousVersion, nextVersion)
  if (rewritten === source) throw new Error(`DSH version ${previousVersion} was not found in bounded artifact`)
  return rewritten
}

export function rewriteAgentCompatibility(source, pluginVersion, targets) {
  const current = targets.join(', ')
  const summary = `> Current release: dsh-chat-manager@${pluginVersion}, qualified targets DSH ${current}. Use the same package for all three; no other cores are claimed.`
  let rewritten = source.replace(/^> Current release:.*$/mu, summary)
  rewritten = rewritten.replace(/^This release targets DSH .*$/mu,
    `This release targets DSH ${targets[0]}, ${targets[1]}, and ${targets[2]}. Check the target core before installation.`)
  rewritten = rewritten.replace(/^For DSH .*$/gmu, '')
  if (rewritten === source || !rewritten.includes(summary)) throw new Error('Agent guide compatibility section is out of sync')
  return rewritten
}

export function rewriteCompatibilityBlock(source, targets, language) {
  const marker = /<!-- dsh-compatibility -->[\s\S]*?<!-- \/dsh-compatibility -->/
  if (!marker.test(source)) throw new Error(`missing generated DSH compatibility block (${language})`)
  if (targets.length !== RELEASE_TARGET_COUNT) throw new Error(`exactly ${RELEASE_TARGET_COUNT} DSH versions must be qualified`)
  const list = targets.map(version => `\`${version}\``).join(language === 'zh' ? '、' : ', ')
  const body = language === 'zh'
    ? `当前版本支持 DeepSeek Harness ${list}。`
    : `This release supports DeepSeek Harness ${list}.`
  return source.replace(marker, `<!-- dsh-compatibility -->\n${body}\n<!-- /dsh-compatibility -->`)
}

export function rewriteInstallationCompatibility(source, pluginVersion, targets, language) {
  const listed = targets.map(version => `\`${version}\``)
  const line = language === 'zh'
    ? `**版本 ${pluginVersion} 支持 DSH 内核 ${listed.join('、')}。**`
    : `**Version ${pluginVersion} supports DSH cores ${listed[0]}, ${listed[1]}, and ${listed[2]}.**`
  const pattern = language === 'zh'
    ? /^\*\*版本 \d+\.\d+\.\d+ 支持 DSH 内核 .*。\*\*$/mu
    : /^\*\*Version \d+\.\d+\.\d+ supports DSH cores .*\.\*\*$/mu
  return pattern.test(source) ? source.replace(pattern, line) : source
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
  const targetsIndex = process.argv.indexOf('--dsh-versions')
  const targets = targetsIndex === -1 ? undefined : process.argv[targetsIndex + 1]
  if (targets === undefined) throw new Error('--dsh-versions JSON array is required')
  const targetVersions = JSON.parse(targets)
  const compatibilityPath = resolve(root, 'compatibility.json')
  const manifestPath = resolve(root, 'package.json')
  const [compatibility, manifest] = await Promise.all([
    readFile(compatibilityPath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(JSON.parse),
  ])
  const publishedVersions = Object.fromEntries(await Promise.all(Object.keys(manifest.devDependencies)
    .filter(name => name.startsWith('@deepseek-ai/dsh-') && name !== '@deepseek-ai/dsh-client-runtime')
    .map(async name => {
      const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`)
      if (!response.ok) throw new Error(`Registry HTTP ${response.status} for ${name}`)
      return [name, Object.keys((await response.json()).versions ?? {})]
    })))
  const update = planCompatibilityUpdate({ compatibility, manifest }, targetVersions, publishedVersions)
  if (update === null) {
    process.stdout.write(`${JSON.stringify({ changed: false, dshVersions: targetVersions })}\n`)
    return
  }
  const textPaths = boundedArtifactPaths(update)
  const textSources = await Promise.all(textPaths.map(path => readFile(resolve(root, path), 'utf8')))
  const rewritten = textSources.map(source => rewriteReleaseVersion(source, update.previousDocumentedPluginVersion, update.pluginVersion))
  rewritten[0] = rewriteInstallationCompatibility(
    rewriteCompatibilityBlock(rewritten[0], update.dshVersions, 'zh'), update.pluginVersion, update.dshVersions, 'zh')
  rewritten[1] = rewriteInstallationCompatibility(
    rewriteCompatibilityBlock(rewritten[1], update.dshVersions, 'en'), update.pluginVersion, update.dshVersions, 'en')
  rewritten[2] = rewriteAgentCompatibility(rewritten[2], update.pluginVersion, update.dshVersions)
  rewritten[3] = rewriteDshVersion(rewritten[3], update.previousDshVersion, update.dshVersions[0])

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
