import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const installer = new URL('../install.ps1', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageSpec = `dsh-native-session-delete@${manifest.version}`
const windowsTest = process.platform === 'win32' ? test : test.skip

test('installer remains a thin official-CLI launcher', async () => {
  const source = await readFile(installer, 'utf8')

  assert.match(source, /dsh plugin --profile/i)
  assert.match(source, new RegExp(packageSpec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /Get-ChildItem[^\r\n]*-Recurse/i)
  assert.doesNotMatch(source, /api\.github\.com|Invoke-WebRequest|Start-Process|Stop-Process/i)
  assert.doesNotMatch(source, /pnpm-lock\.yaml|install-state|snapshot/i)
})

windowsTest('explicit DSH path invokes one official add operation', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-thin-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const fake = join(fixture, 'dsh.cmd')
  const log = join(fixture, 'args.txt')
  await writeFile(fake, '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo %*\r\nexit /b 0\r\n')

  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.pathname.slice(1),
    '-DshPath', fake, '-Profile', 'web',
  ], {
    cwd: fixture,
    env: { ...process.env, DSH_INSTALLER_TEST_LOG: log },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const reported = /(?:Installed in|安装完成（)\s*([\d.]+)\s*(?:seconds|秒)/i.exec(result.stdout)
  assert.ok(reported, `installer did not report official-command duration: ${result.stdout}`)
  assert.ok(Number(reported[1]) < 2, 'thin launcher should not scan disks or download components')
  assert.equal((await readFile(log, 'utf8')).trim(), `plugin --profile web add ${packageSpec}`)
})

windowsTest('bounded discovery finds a Portable nested under the local temp directory', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-thin-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const localAppData = join(fixture, 'LocalAppData')
  const portable = join(localAppData, 'Temp', 'opencode', 'zip-unpack-test', 'DSH-Portable')
  const fake = join(portable, 'dsh.cmd')
  const log = join(fixture, 'args.txt')
  await mkdir(portable, { recursive: true })
  await writeFile(fake, '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo %*\r\nexit /b 0\r\n')

  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.pathname.slice(1),
  ], {
    cwd: fixture,
    env: {
      ...process.env,
      USERPROFILE: join(fixture, 'User'),
      LOCALAPPDATA: localAppData,
      DSH_INSTALLER_TEST_LOG: log,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal((await readFile(log, 'utf8')).trim(), `plugin --profile web add ${packageSpec}`)
})

windowsTest('discovery prefers one durable user installation over disposable temp copies', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-thin-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const userProfile = join(fixture, 'User')
  const localAppData = join(fixture, 'LocalAppData')
  const durable = join(userProfile, 'Downloads', 'DeepSeek-Herness')
  const disposable = join(localAppData, 'Temp', 'opencode', 'zip-unpack-test', 'DSH-Portable')
  const durableDsh = join(durable, 'dsh.cmd')
  const disposableDsh = join(disposable, 'dsh.cmd')
  const log = join(fixture, 'args.txt')
  await Promise.all([mkdir(durable, { recursive: true }), mkdir(disposable, { recursive: true })])
  await writeFile(durableDsh, '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo durable %*\r\nexit /b 0\r\n')
  await writeFile(disposableDsh, '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo disposable %*\r\nexit /b 0\r\n')

  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.pathname.slice(1),
  ], {
    cwd: fixture,
    env: {
      ...process.env,
      USERPROFILE: userProfile,
      LOCALAPPDATA: localAppData,
      DSH_INSTALLER_TEST_LOG: log,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal((await readFile(log, 'utf8')).trim(), `durable plugin --profile web add ${packageSpec}`)
})

windowsTest('multiple durable installations are selected by number without a placeholder path', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-thin-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const userProfile = join(fixture, 'User')
  const first = join(userProfile, 'Downloads', 'DeepSeek-Harness-A')
  const second = join(userProfile, 'Documents', 'DeepSeek-Harness-B')
  const log = join(fixture, 'args.txt')
  await Promise.all([mkdir(first, { recursive: true }), mkdir(second, { recursive: true })])
  await writeFile(join(first, 'dsh.cmd'), '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo first %*\r\nexit /b 0\r\n')
  await writeFile(join(second, 'dsh.cmd'), '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo second %*\r\nexit /b 0\r\n')

  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.pathname.slice(1),
  ], {
    cwd: fixture,
    env: {
      ...process.env,
      USERPROFILE: userProfile,
      LOCALAPPDATA: join(fixture, 'LocalAppData'),
      DSH_INSTALLER_TEST_LOG: log,
    },
    input: '2\r\n',
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Multiple DSH installations|检测到多个 DSH/)
  assert.equal((await readFile(log, 'utf8')).trim(), `second plugin --profile web add ${packageSpec}`)
})

windowsTest('PATH discovery is sufficient and command failures are preserved', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-thin-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const fake = join(fixture, 'dsh.cmd')
  await writeFile(fake, '@echo off\r\nexit /b 23\r\n')

  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.pathname.slice(1),
  ], {
    cwd: fixture,
    env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(`${result.stderr}\n${result.stdout}`, /exit code 23/i)
})

windowsTest('download-pipe style execution remains non-interactive', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-thin-installer-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const fake = join(fixture, 'dsh.cmd')
  const log = join(fixture, 'args.txt')
  await writeFile(fake, '@echo off\r\n> "%DSH_INSTALLER_TEST_LOG%" echo %*\r\nexit /b 0\r\n')

  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-Command', `Get-Content -LiteralPath '${installer.pathname.slice(1).replaceAll("'", "''")}' -Raw | Invoke-Expression`,
  ], {
    cwd: fixture,
    env: {
      ...process.env,
      PATH: `${fixture}${delimiter}${process.env.PATH ?? ''}`,
      DSH_INSTALLER_TEST_LOG: log,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal((await readFile(log, 'utf8')).trim(), `plugin --profile web add ${packageSpec}`)
})
