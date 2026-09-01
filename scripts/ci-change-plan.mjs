import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function baseCommit(candidate) {
  if (candidate && !/^0+$/u.test(candidate)) {
    try {
      git('rev-parse', '--verify', `${candidate}^{commit}`)
      return candidate
    } catch {}
  }
  try {
    return git('rev-parse', 'HEAD^')
  } catch {
    return git('rev-parse', 'HEAD')
  }
}

function compareVersions(left, right) {
  const parse = value => {
    const [core, prerelease] = String(value).replace(/^v/u, '').split('-', 2)
    return { core: core.split('.').map(Number), prerelease: prerelease?.split('.') }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if ((a.core[index] ?? 0) !== (b.core[index] ?? 0)) return (a.core[index] ?? 0) - (b.core[index] ?? 0)
  }
  if (!a.prerelease && !b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

const base = baseCommit(argument('--base'))
const publishedVersion = argument('--published')
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const files = git('diff', '--name-only', `${base}...HEAD`).split(/\r?\n/u).filter(Boolean)
const changed = patterns => files.some(file => patterns.some(pattern => pattern.test(file)))
const planner = changed([/^scripts\/ci-change-plan\.mjs$/u, /^\.github\/workflows\/ci\.yml$/u])
const runtime = changed([
  /^src\//u,
  /^lib\//u,
  /^cordis\.patch\.yml$/u,
  /^tsdown(?:\.demo)?\.config\.mjs$/u,
  /^scripts\/build-client\.mjs$/u,
])
const demo = planner || changed([/^demo\//u, /^docs\//u, /^\.github\/workflows\/pages\.yml$/u])
const delivery = planner || changed([
  /^\.github\//u,
  /^(?:README(?:\.zh-CN)?|DIRECTORY|AGENTS|SECURITY|THIRD_PARTY_NOTICES|LICENSE)\.md$/u,
  /^compatibility\.json$/u,
  /^package(?:-lock)?\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /^scripts\/prepare-compat-release\.mjs$/u,
  /^tests\/.*(?:contract|release|package|compat).*\.test\.(?:mjs|js)$/u,
])
const behavior = planner || runtime || changed([
  /^compatibility\.json$/u,
  /^package(?:-lock)?\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /^tests\//u,
])
const official = planner || runtime || changed([
  /^compatibility\.json$/u,
  /^package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
])

if (runtime && publishedVersion && compareVersions(packageVersion, publishedVersion) <= 0) {
  console.error(`Runtime-bearing files changed after ${publishedVersion}, but package.json is still ${packageVersion}.`)
  console.error('Advance the package version before merging so main cannot get ahead of the published package.')
  process.exit(1)
}

const plan = { behavior, delivery, demo, official, runtime }
console.log(JSON.stringify({ base, files, packageVersion, publishedVersion, plan }, null, 2))
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''))
}
