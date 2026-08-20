import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const installer = new URL('../install.ps1', import.meta.url)
const packageSpec = 'dsh-native-session-delete@https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.1/dsh-native-session-delete.tgz'
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

  const started = performance.now()
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer.pathname.slice(1),
    '-DshPath', fake, '-Profile', 'web',
  ], {
    cwd: fixture,
    env: { ...process.env, DSH_INSTALLER_TEST_LOG: log },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.ok(performance.now() - started < 5_000, 'thin launcher should not scan disks or download components')
  assert.equal((await readFile(log, 'utf8')).trim(), `plugin --profile web add ${packageSpec}`)
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
