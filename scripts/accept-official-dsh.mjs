import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SESSION_TITLE = 'Official DSH compatibility smoke'

export function parseOfficialAcceptanceArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!['--dsh-version', '--package', '--port'].includes(name)) throw new Error(`unknown argument: ${name}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    values[name] = value
    index += 1
  }
  if (values['--dsh-version'] === undefined) throw new Error('--dsh-version is required')
  if (!EXACT_VERSION.test(values['--dsh-version'])) throw new Error('--dsh-version must be an exact semantic version')
  if (values['--package'] === undefined) throw new Error('--package is required')
  const port = values['--port'] === undefined ? 14191 : Number(values['--port'])
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be between 1024 and 65535')
  return { dshVersion: values['--dsh-version'], packagePath: values['--package'], port }
}

function pnpmCommand() {
  return process.env.PNPM_EXECUTABLE || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
}

function spawnPortable(command, args, options) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    const values = [command, ...args]
    for (const value of values) {
      if (/[&|<>^%!\"]/.test(value)) throw new Error(`unsafe Windows command argument: ${value}`)
    }
    const commandLine = values.map(value => /\s/.test(value) ? `"${value}"` : value).join(' ')
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], { ...options, shell: false })
  }
  return spawn(command, args, { ...options, shell: false })
}

async function waitForSingleTranscript(root, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const entries = await readdir(root, { recursive: true }).catch(error => {
      if (error?.code === 'ENOENT') return []
      throw error
    })
    const candidates = entries
      .filter(entry => /(?:^|[\\/])session\.jsonl(?:\.zstd)?$/.test(entry))
      .map(entry => join(root, entry))
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) throw new Error(`isolated DSH created ${candidates.length} session transcripts`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  throw new Error('official DSH did not persist the disposable session')
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnPortable(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      detached: options.detached ?? false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0 || options.allowFailure) resolvePromise({ code, stdout, stderr, child })
      else reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`))
    })
  })
}

async function waitForServer(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`official DSH exited before accepting connections (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error(`official DSH did not start within ${timeoutMs}ms`)
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(child.pid), '/t', '/f'], { allowFailure: true, capture: true })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  }
  await Promise.race([
    new Promise(resolvePromise => child.once('exit', resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 5000)),
  ])
}

async function removeIsolatedOnboarding(page) {
  const onboarding = page.getByRole('dialog', { name: /^(Internal Testing Notice|内测声明)$/ })
  await onboarding.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  const dialogs = page.getByRole('dialog')
  const count = await dialogs.count()
  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index)
    const text = await dialog.innerText().catch(() => '')
    if (!/(Internal Testing Notice|内测声明|API Key|密钥)/i.test(text)) continue
    await dialog.evaluate(element => {
      const overlay = element.parentElement
      if (overlay !== null) overlay.remove()
      else element.remove()
      for (const inert of document.querySelectorAll('[inert]')) inert.removeAttribute('inert')
    })
  }
}

export async function runOfficialAcceptance(options) {
  const packagePath = resolve(options.packagePath)
  await access(packagePath)
  const base = await mkdtemp(join(tmpdir(), 'dsh-session-delete-official-'))
  const dshHome = join(base, 'home')
  const workspace = join(base, 'workspace')
  const env = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_MODE: 'DISABLED' }
  const dshSpec = `@deepseek-ai/dsh@${options.dshVersion}`
  let server
  try {
    await mkdir(workspace, { recursive: true })

    await run(pnpmCommand(), ['dlx', dshSpec, 'plugin', '--profile', 'web', 'add', packagePath], {
      cwd: workspace,
      env,
    })
    await run(pnpmCommand(), ['dlx', dshSpec, '--profile', 'headless', SESSION_TITLE], {
      cwd: workspace,
      env,
      allowFailure: true,
      capture: true,
    })
    const transcriptPath = await waitForSingleTranscript(join(dshHome, 'sessions'))
    server = spawnPortable(pnpmCommand(), [
      'dlx', dshSpec, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(options.port),
    ], {
      cwd: workspace,
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    })
    const url = `http://127.0.0.1:${options.port}`
    await waitForServer(url, server)

    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
      const deleteRequests = []
      let navigations = 0
      let navigationArmed = false
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') {
          deleteRequests.push(request.method())
        }
      })
      page.on('framenavigated', frame => {
        if (navigationArmed && frame === page.mainFrame()) navigations += 1
      })
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await removeIsolatedOnboarding(page)

      const sessionAction = page.locator(
        'button[aria-label^="Session actions for "], button[aria-label^="会话“"][aria-label$="”的操作"]',
      )
      await sessionAction.waitFor({ state: 'attached', timeout: 30_000 }).catch(async error => {
        const pageText = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000)
        throw new Error(`disposable session was not visible in official DSH; page text: ${JSON.stringify(pageText)}`, { cause: error })
      })
      if (await sessionAction.count() !== 1) throw new Error('isolated official DSH did not expose exactly one session action')
      const sessionAria = await sessionAction.getAttribute('aria-label')
      const sessionLabel = /^Session actions for (.+)$/.exec(sessionAria ?? '')?.[1]
        ?? /^会话“(.+)”的操作$/.exec(sessionAria ?? '')?.[1]
      if (sessionLabel === undefined) throw new Error(`could not parse official session action label: ${sessionAria}`)
      const row = sessionAction.locator('xpath=ancestor::*[@role="treeitem"][1]')
      const openMenu = async () => {
        await row.hover()
        await sessionAction.click()
      }

      await openMenu()
      const archiveItem = page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ })
      const deleteItem = page.getByRole('menuitem', { name: /^(Delete session|删除会话)$/ })
      await archiveItem.waitFor()
      await deleteItem.waitFor()
      const [archiveColor, deleteColor] = await Promise.all([
        archiveItem.evaluate(element => getComputedStyle(element).color),
        deleteItem.evaluate(element => getComputedStyle(element).color),
      ])
      if (archiveColor === deleteColor) throw new Error(`delete action is not red (${deleteColor})`)
      await deleteItem.click()

      let dialog = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
      await dialog.getByText(sessionLabel, { exact: false }).waitFor()
      await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).click()
      await dialog.waitFor({ state: 'hidden' })
      if (deleteRequests.length !== 0) throw new Error('cancel sent a deletion request')
      await sessionAction.waitFor({ state: 'attached' })

      await openMenu()
      await page.getByRole('menuitem', { name: /^(Delete session|删除会话)$/ }).click()
      dialog = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
      navigationArmed = true
      const confirmedResponse = page.waitForResponse(response => (
        new URL(response.url()).pathname === '/plugins/dsh-session-delete/delete'
        && response.request().method() === 'POST'
      ))
      await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/ }).click()
      const deleteResponse = await confirmedResponse
      const deletePayload = await deleteResponse.json().catch(() => null)
      if (deleteResponse.status() !== 200 || deletePayload?.ok !== true) {
        throw new Error(`confirmed deletion returned HTTP ${deleteResponse.status()}: ${JSON.stringify(deletePayload)}`)
      }
      await dialog.waitFor({ state: 'hidden' })
      await page.locator('[data-conversation-scroll]').waitFor()
      if (deleteRequests.length !== 1 || deleteRequests[0] !== 'POST') {
        throw new Error(`expected one confirmed POST, observed ${JSON.stringify(deleteRequests)}`)
      }
      if (navigations !== 0) throw new Error(`confirmed deletion caused ${navigations} page navigation(s)`)
      await access(transcriptPath).then(
        () => { throw new Error('confirmed deletion left the disposable transcript behind') },
        error => { if (error?.code !== 'ENOENT') throw error },
      )
    } finally {
      await browser.close()
    }
    return {
      ok: true,
      dshVersion: options.dshVersion,
      checks: ['official install', 'official boot', 'red native action', 'second confirmation', 'cancel without request', 'confirmed JSONL deletion', 'no page reload'],
    }
  } finally {
    if (server !== undefined) await stopProcess(server)
    await rm(base, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runOfficialAcceptance(parseOfficialAcceptanceArgs(process.argv.slice(2))).then(
    result => process.stdout.write(`${JSON.stringify(result)}\n`),
    error => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
