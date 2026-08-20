import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import test from 'node:test'

const windowsTest = process.platform === 'win32' ? test : test.skip

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')
const manager = join(root, 'dsh-session-delete.ps1')
const setup = join(root, 'dsh-session-delete-setup.ps1')
const packageName = '@deepseek-ai/dsh-client-ui-workspace'
const packageUrl = 'https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.12/dsh-session-delete.tgz'

async function makeFixture({ original = '0.1.0-rc.8', initialized = true, lockfile = true } = {}) {
  const fixture = join(tmpdir(), `dsh-session-delete-manager-${crypto.randomUUID()}`)
  const portable = join(fixture, 'DSH-Portable')
  const nodeDir = join(portable, 'runtime', 'node')
  const dshBin = join(portable, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const profileDir = join(portable, 'data', 'dsh-home', 'profiles', 'web')
  const profileFile = join(profileDir, 'package.json')
  const lockFile = join(profileDir, 'pnpm-lock.yaml')
  const pnpmDir = join(portable, 'data', 'runtime', 'dsh-session-delete-tools', 'pnpm-11.19.0', 'package', 'bin')
  const commandRoot = join(fixture, 'manager')
  await mkdir(nodeDir, { recursive: true })
  await mkdir(join(dshBin, '..'), { recursive: true })
  await mkdir(profileDir, { recursive: true })
  await mkdir(pnpmDir, { recursive: true })
  await copyFile(process.execPath, join(nodeDir, 'node.exe'))
  await writeFile(join(pnpmDir, 'pnpm.cjs'), "if (process.argv.includes('--version')) console.log('11.19.0')\n")
  if (initialized) {
    await writeFile(profileFile, JSON.stringify({
      dependencies: original == null ? {} : { [packageName]: original },
    }, null, 2))
    if (lockfile) await writeFile(lockFile, 'original-lockfile\n')
  }
  await writeFile(dshBin, `
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const profileFile = process.env.DSH_TEST_PROFILE_FILE
const lockFile = process.env.DSH_TEST_LOCK_FILE
const args = process.argv.slice(2)
if (process.env.DSH_TEST_COMMAND_LOG) {
  appendFileSync(process.env.DSH_TEST_COMMAND_LOG, JSON.stringify(args) + '\\n')
}
const manifest = existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, 'utf8')) : { dependencies: {} }
const deps = manifest.dependencies ||= {}
const plugin = args.indexOf('plugin')
const action = plugin >= 0 ? args[plugin + 3] : ''
const subject = plugin >= 0 ? args[plugin + 4] : ''
if (action === 'list') {
  const output = {}
  for (const [name, spec] of Object.entries(deps)) {
    output[name] = { version: String(spec).includes('dsh-session-delete') ? '0.1.12' : String(spec).replace(/^[^0-9]*/, '') }
  }
  console.log(JSON.stringify([{ dependencies: output }]))
  process.exit(0)
}
if (action === 'add') {
  if (process.env.DSH_TEST_REQUIRE_CLEAN_LOCK === '1' && lockFile && existsSync(lockFile)) process.exit(6)
  const aliasPrefix = '${packageName}@'
  const name = subject.startsWith(aliasPrefix) ? '${packageName}' : subject.slice(0, subject.lastIndexOf('@'))
  const spec = subject.startsWith(aliasPrefix) ? subject.slice(aliasPrefix.length) : subject.slice(subject.lastIndexOf('@') + 1)
  deps[name] = spec
  writeFileSync(profileFile, JSON.stringify(manifest, null, 2))
  if (lockFile) writeFileSync(lockFile, 'changed-by-add\\n')
  if (name === '${packageName}' && String(spec).includes('dsh-session-delete')) {
    const linked = new URL('./node_modules/@deepseek-ai/dsh-client-ui-workspace/package.json', 'file:///' + profileFile.replaceAll('\\\\', '/')).pathname.slice(1)
    mkdirSync(linked.slice(0, linked.lastIndexOf('/')), { recursive: true })
    writeFileSync(linked, JSON.stringify({ name: 'dsh-session-delete', version: '0.1.12' }))
  }
  if (process.env.DSH_TEST_FAIL_INSTALL === '1' && subject.includes('dsh-session-delete')) process.exit(9)
  if (process.env.DSH_TEST_FAIL_RESTORE === '1' && !subject.includes('dsh-session-delete')) process.exit(8)
  process.exit(0)
}
if (action === 'remove') {
  delete deps[subject]
  writeFileSync(profileFile, JSON.stringify(manifest, null, 2))
  if (lockFile) writeFileSync(lockFile, 'changed-by-remove\\n')
  process.exit(0)
}
if (action === 'install') {
  if (lockFile) writeFileSync(lockFile, 'reconciled-by-install\\n')
  if (process.env.DSH_TEST_FAIL_RECONCILE === '1') process.exit(7)
  process.exit(0)
}
console.error('unexpected arguments: ' + JSON.stringify(args))
process.exit(4)
`)
  return { fixture, portable, profileFile, lockFile, commandRoot, dshBin, node: join(nodeDir, 'node.exe'), commandLog: join(fixture, 'commands.jsonl') }
}

function runManager(target, action, extraEnv = {}, extraArgs = []) {
  const profileArgs = extraArgs.includes('-Profile') ? [] : ['-Profile', 'web']
  return spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', manager, '-Action', action, ...profileArgs,
    '-PortableRoot', target.portable, '-CommandRoot', target.commandRoot, '-NoModifyPath',
    ...extraArgs,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_TEST_PROFILE_FILE: target.profileFile,
      DSH_TEST_LOCK_FILE: target.lockFile,
      DSH_SESSION_DELETE_TEST_SKIP_PACKAGE_VERIFY: '1',
      ...extraEnv,
    },
  })
}

async function dependency(target) {
  const manifest = JSON.parse(await readFile(target.profileFile, 'utf8'))
  return manifest.dependencies?.[packageName]
}

windowsTest('guided manager installs the workspace replacement and restores the original dependency', async () => {
  const target = await makeFixture()
  try {
    const install = runManager(target, 'Install')
    assert.equal(install.status, 0, install.stderr || install.stdout)
    assert.equal(await dependency(target), packageUrl)
    const state = JSON.parse(await readFile(join(target.commandRoot, 'install-state.json'), 'utf8'))
    assert.equal(state.schemaVersion, 4)
    assert.equal(state.originalDependencyExists, true)
    assert.equal(state.originalDependencySpec, '0.1.0-rc.8')
    assert.equal(state.managedDependencySpec, packageUrl)
    assert.match(await readFile(join(target.commandRoot, 'dsh-session-delete.cmd'), 'utf8'), /dsh-session-delete-manager\.ps1/)

    const uninstall = runManager(target, 'Uninstall')
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert.equal(await dependency(target), '0.1.0-rc.8')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('install performs one DSH plugin operation without redundant list round trips', async () => {
  const target = await makeFixture()
  try {
    const result = runManager(target, 'Install', { DSH_TEST_COMMAND_LOG: target.commandLog })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const commands = (await readFile(target.commandLog, 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(commands.length, 1)
    assert.equal(commands[0][3], 'add')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('install regenerates a stale profile lockfile before adding the release', async () => {
  const target = await makeFixture()
  try {
    const install = runManager(target, 'Install', { DSH_TEST_REQUIRE_CLEAN_LOCK: '1' })
    assert.equal(install.status, 0, install.stderr || install.stdout)
    assert.equal(await dependency(target), packageUrl)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('uninstall removes the replacement when no original dependency existed', async () => {
  const target = await makeFixture({ original: null })
  try {
    const install = runManager(target, 'Install')
    assert.equal(install.status, 0, install.stderr || install.stdout)
    assert.equal(await dependency(target), packageUrl)
    const uninstall = runManager(target, 'Uninstall')
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert.equal(await dependency(target), undefined)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('upgrading an older Session Delete release restores that exact release on uninstall', async () => {
  const previous = 'https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz'
  const target = await makeFixture({ original: previous })
  try {
    const install = runManager(target, 'Install')
    assert.equal(install.status, 0, install.stderr || install.stdout)
    assert.equal(await dependency(target), packageUrl)
    const uninstall = runManager(target, 'Uninstall')
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert.equal(await dependency(target), previous)
    assert.equal(await readFile(target.lockFile, 'utf8'), 'original-lockfile\n')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('update preserves the first-install snapshot used by uninstall', async () => {
  const target = await makeFixture({ original: '0.1.0-rc.8' })
  try {
    const originalManifest = await readFile(target.profileFile, 'utf8')
    const originalLock = await readFile(target.lockFile, 'utf8')
    assert.equal(runManager(target, 'Install').status, 0)
    const before = JSON.parse(await readFile(join(target.commandRoot, 'install-state.json'), 'utf8'))
    const update = runManager(target, 'Update', {}, ['-SkipSelfUpdate'])
    assert.equal(update.status, 0, update.stderr || update.stdout)
    const after = JSON.parse(await readFile(join(target.commandRoot, 'install-state.json'), 'utf8'))
    assert.equal(after.profileManifestBase64, before.profileManifestBase64)
    assert.equal(after.profileLockfileBase64, before.profileLockfileBase64)
    assert.equal(runManager(target, 'Uninstall').status, 0)
    assert.equal(await readFile(target.profileFile, 'utf8'), originalManifest)
    assert.equal(await readFile(target.lockFile, 'utf8'), originalLock)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('schema 2 manager state migrates through update and remains uninstallable', async () => {
  const target = await makeFixture({ original: '0.1.0-rc.8' })
  try {
    assert.equal(runManager(target, 'Install').status, 0)
    const statePath = join(target.commandRoot, 'install-state.json')
    const current = JSON.parse(await readFile(statePath, 'utf8'))
    const legacy = {
      schemaVersion: 2, mode: current.mode, portableRoot: current.portableRoot,
      globalDsh: null, globalNode: null, globalDshHome: null, profile: current.profile,
      pathOwned: current.pathOwned, originalDependencyExists: current.originalDependencyExists,
      originalDependencySpec: current.originalDependencySpec, managedDependencySpec: current.managedDependencySpec,
    }
    await writeFile(statePath, JSON.stringify(legacy))
    const update = runManager(target, 'Update', {}, ['-SkipSelfUpdate'])
    assert.equal(update.status, 0, update.stderr || update.stdout)
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).schemaVersion, 4)
    const uninstall = runManager(target, 'Uninstall')
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert.equal(await dependency(target), '0.1.0-rc.8')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('failed schema 2 restore rolls back the managed profile exactly', async () => {
  const target = await makeFixture({ original: '0.1.0-rc.8' })
  try {
    assert.equal(runManager(target, 'Install').status, 0)
    const statePath = join(target.commandRoot, 'install-state.json')
    const current = JSON.parse(await readFile(statePath, 'utf8'))
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 2, mode: current.mode, portableRoot: current.portableRoot,
      globalDsh: null, globalNode: null, globalDshHome: null, profile: current.profile,
      pathOwned: current.pathOwned, originalDependencyExists: current.originalDependencyExists,
      originalDependencySpec: current.originalDependencySpec, managedDependencySpec: current.managedDependencySpec,
    }))
    const beforeManifest = await readFile(target.profileFile, 'utf8')
    const beforeLock = await readFile(target.lockFile, 'utf8')
    const uninstall = runManager(target, 'Uninstall', { DSH_TEST_FAIL_RESTORE: '1' })
    assert.notEqual(uninstall.status, 0)
    assert.equal(await readFile(target.profileFile, 'utf8'), beforeManifest)
    assert.equal(await readFile(target.lockFile, 'utf8'), beforeLock)
    assert.equal(await dependency(target), packageUrl)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('uninstall refuses to overwrite unrelated profile changes', async () => {
  const target = await makeFixture()
  try {
    assert.equal(runManager(target, 'Install').status, 0)
    const manifest = JSON.parse(await readFile(target.profileFile, 'utf8'))
    manifest.dependencies['unrelated-plugin'] = '1.0.0'
    await writeFile(target.profileFile, JSON.stringify(manifest, null, 2))
    await writeFile(target.lockFile, 'user-changed-lockfile\n')
    const beforeManifest = await readFile(target.profileFile, 'utf8')
    const uninstall = runManager(target, 'Uninstall')
    assert.notEqual(uninstall.status, 0)
    assert.match(uninstall.stderr + uninstall.stdout, /profile changed/i)
    assert.equal(await readFile(target.profileFile, 'utf8'), beforeManifest)
    assert.equal(await readFile(target.lockFile, 'utf8'), 'user-changed-lockfile\n')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('a profile that did not exist is removed again on uninstall', async () => {
  const target = await makeFixture({ original: null, initialized: false })
  try {
    const install = runManager(target, 'Install')
    assert.equal(install.status, 0, install.stderr || install.stdout)
    assert.equal(await dependency(target), packageUrl)
    const uninstall = runManager(target, 'Uninstall')
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    await assert.rejects(readFile(target.profileFile, 'utf8'), /ENOENT/)
    await assert.rejects(readFile(target.lockFile, 'utf8'), /ENOENT/)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('an originally absent lockfile remains absent after uninstall', async () => {
  const target = await makeFixture({ original: '0.1.0-rc.8', lockfile: false })
  try {
    assert.equal(runManager(target, 'Install').status, 0)
    const uninstall = runManager(target, 'Uninstall')
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert.equal(await dependency(target), '0.1.0-rc.8')
    await assert.rejects(readFile(target.lockFile, 'utf8'), /ENOENT/)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('a failed install restores the exact dependency that was present before it started', async () => {
  const target = await makeFixture({ original: 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.8' })
  try {
    const result = runManager(target, 'Install', { DSH_TEST_FAIL_INSTALL: '1' })
    assert.notEqual(result.status, 0)
    assert.equal(await dependency(target), 'npm:@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.8')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('a failed DSH reconcile still reasserts rollback bytes', async () => {
  const target = await makeFixture({ original: '0.1.0-rc.8' })
  try {
    const beforeManifest = await readFile(target.profileFile, 'utf8')
    const beforeLock = await readFile(target.lockFile, 'utf8')
    const result = runManager(target, 'Install', {
      DSH_TEST_FAIL_INSTALL: '1',
      DSH_TEST_FAIL_RECONCILE: '1',
    })
    assert.notEqual(result.status, 0)
    assert.equal(await readFile(target.profileFile, 'utf8'), beforeManifest)
    assert.equal(await readFile(target.lockFile, 'utf8'), beforeLock)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('managed uninstall refuses to overwrite a dependency changed by the user', async () => {
  const target = await makeFixture()
  try {
    assert.equal(runManager(target, 'Install').status, 0)
    const manifest = JSON.parse(await readFile(target.profileFile, 'utf8'))
    manifest.dependencies[packageName] = 'https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz'
    await writeFile(target.profileFile, JSON.stringify(manifest, null, 2))

    const uninstall = runManager(target, 'Uninstall')
    assert.notEqual(uninstall.status, 0)
    assert.match(uninstall.stderr + uninstall.stdout, /profile changed after this manager installed/i)
    assert.match(await dependency(target), /v0\.1\.5/)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('saved manager state cannot be applied to a different Portable target', async () => {
  const first = await makeFixture()
  const second = await makeFixture({ original: 'second-profile' })
  try {
    assert.equal(runManager(first, 'Install').status, 0)
    const result = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', manager, '-Action', 'Uninstall', '-Profile', 'web',
      '-PortableRoot', second.portable, '-CommandRoot', first.commandRoot, '-NoModifyPath',
    ], {
      encoding: 'utf8',
      env: { ...process.env, DSH_TEST_PROFILE_FILE: second.profileFile },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr + result.stdout, /differs from the target owned/i)
    assert.equal(await dependency(second), 'second-profile')
  } finally {
    await rm(first.fixture, { recursive: true, force: true })
    await rm(second.fixture, { recursive: true, force: true })
  }
})

windowsTest('saved manager state cannot be applied to another profile', async () => {
  const target = await makeFixture()
  try {
    assert.equal(runManager(target, 'Install').status, 0)
    const beforeManifest = await readFile(target.profileFile, 'utf8')
    const result = runManager(target, 'Uninstall', {}, ['-Profile', 'other'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr + result.stdout, /profile differs from the profile owned/i)
    assert.equal(await readFile(target.profileFile, 'utf8'), beforeManifest)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('manager command installation failure rolls back the workspace dependency', async () => {
  const target = await makeFixture({ original: '0.1.0-rc.8' })
  try {
    await writeFile(target.commandRoot, 'blocks creation of manager directory')
    const result = runManager(target, 'Install')
    assert.notEqual(result.status, 0)
    assert.equal(await dependency(target), '0.1.0-rc.8')
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('friendly setup reaches the verified manager and installs into an explicit Portable target', async () => {
  const target = await makeFixture()
  try {
    const result = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', setup, '-Action', 'Install', '-Language', 'en-US',
      '-PortableRoot', target.portable, '-ManagerPath', manager, '-NoModifyPath',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LOCALAPPDATA: join(target.fixture, 'local-app-data'),
        DSH_TEST_PROFILE_FILE: target.profileFile,
        DSH_SESSION_DELETE_TEST_SKIP_PACKAGE_VERIFY: '1',
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(await dependency(target), packageUrl)
    assert.match(result.stdout, /Installation completed/)
    assert.match(result.stdout, /Installed\. Restart DSH manually/)
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('explicit official DSH target uses its selected executable and official profile root', async () => {
  const target = await makeFixture()
  const localAppData = join(target.fixture, 'local-app-data')
  const globalDsh = join(target.fixture, 'selected-dsh.cmd')
  const pnpmBin = join(localAppData, 'dsh-session-delete', 'tools', 'pnpm-11.19.0', 'package', 'bin')
  try {
    await mkdir(pnpmBin, { recursive: true })
    await writeFile(join(pnpmBin, 'pnpm.cjs'), "if (process.argv.includes('--version')) console.log('11.19.0')\n")
    await writeFile(globalDsh, `@echo off\r\n"${target.node}" "${target.dshBin}" %*\r\n`)
    const dshHome = join(target.portable, 'data', 'dsh-home')
    const result = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', manager, '-Action', 'Install', '-Profile', 'web',
      '-DshExecutable', globalDsh, '-NodeExecutable', target.node, '-DshHome', dshHome,
      '-CommandRoot', target.commandRoot, '-NoModifyPath',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        DSH_TEST_PROFILE_FILE: target.profileFile,
        DSH_SESSION_DELETE_TEST_SKIP_PACKAGE_VERIFY: '1',
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(await dependency(target), packageUrl)
    const state = JSON.parse(await readFile(join(target.commandRoot, 'install-state.json'), 'utf8'))
    assert.equal(state.mode, 'global')
    assert.equal((await realpath(state.globalDshHome)).toLowerCase(), (await realpath(dshHome)).toLowerCase())
    assert.equal((await realpath(state.globalDsh)).toLowerCase(), (await realpath(globalDsh)).toLowerCase())
  } finally {
    await rm(target.fixture, { recursive: true, force: true })
  }
})

windowsTest('manager never starts or stops DSH and publishes immutable release URLs', async () => {
  const script = await readFile(manager, 'utf8')
  assert.match(script, /releases\/download\/v0\.1\.12\/dsh-session-delete\.tgz/)
  assert.match(script, /dsh-session-delete\.ps1\.sha256/)
  assert.doesNotMatch(script, /Assert-PackageReleaseAsset/)
  assert.doesNotMatch(script, /Stop-Process|taskkill|Restart-Service/i)
})
