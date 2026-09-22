import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'
import { acceptModernOfficial } from './accept-modern-official.mjs'

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
// Avoid shell-dependent quoting in the Windows pnpm.cmd fixture seed.
const SESSION_TITLE = 'Official-DSH-compatibility-smoke'

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
      .filter(entry => /(?:^|[\\/])session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(entry))
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
      windowsHide: true,
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

async function waitForServer(resolveUrl, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`official DSH exited before accepting connections (${child.exitCode})`)
    const url = resolveUrl()
    if (url !== null) return url
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

async function removeIsolatedOnboarding(page, dshVersion) {
  if (['0.1.6-alpha.1', '0.1.6-alpha.2', '0.1.7-alpha.1'].includes(dshVersion)) {
    // The current onboarding shares the Settings root. Removing its DOM also
    // removes Settings; complete the visible, non-credential flow instead.
    await page.getByRole('button', { name: /^(Continue|继续)$/ }).click()
    await page.getByRole('button', { name: /^(Configure later|稍后配置)$/ }).click()
    return
  }
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

async function dismissOptionalModelSetup(page, dshVersion) {
  if (dshVersion !== '0.1.6-alpha.1') return
  // Clearing the current session opens the no-key onboarding again.
  const later = page.getByRole('button', { name: /^(Configure later|稍后配置)$/ })
  const visible = await later.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)
  if (visible) await later.click()
}

export async function runOfficialAcceptance(options) {
  const packagePath = resolve(options.packagePath)
  await access(packagePath)
  const evidenceRoot = process.env.DSH_ACCEPTANCE_EVIDENCE_ROOT
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true })
  const base = await mkdtemp(join(evidenceRoot || tmpdir(), 'dsh-session-delete-official-'))
  const dshHome = join(base, 'home')
  const workspace = join(base, 'workspace')
  const env = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_MODE: 'DISABLED' }
  const dshSpec = `@deepseek-ai/dsh@${options.dshVersion}`
  const runtimeRoot = process.env.DSH_TEST_RUNTIME
  let dshExecutable = pnpmCommand()
  let dshCommand = ['dlx', '--allow-build=fs-ext', dshSpec]
  if (runtimeRoot) {
    const manifest = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8'))
    if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== options.dshVersion || manifest.bin?.dsh !== 'lib/bin.js') throw new Error('acceptance runtime identity does not match requested official version')
    dshExecutable = process.execPath
    dshCommand = [join(runtimeRoot, 'lib/bin.js')]
  }
  let server
  let serverStdout = ''
  let serverStderr = ''
  let passed = false
  try {
    await mkdir(workspace, { recursive: true })

    await run(dshExecutable, [...dshCommand, 'plugin', '--profile', 'web', 'add', packagePath], {
      cwd: workspace,
      env,
    })
    const seed = await run(dshExecutable, [...dshCommand, '--profile', 'headless', SESSION_TITLE], {
      cwd: workspace,
      env,
      allowFailure: true,
      capture: true,
    })
    await writeFile(join(base, 'seed.log'), `exit=${seed.code}\n${seed.stdout}\n${seed.stderr}`)
    const transcriptPath = await waitForSingleTranscript(join(dshHome, 'sessions'))
    server = spawnPortable(dshExecutable, [
      ...dshCommand, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(options.port),
    ], {
      cwd: workspace,
      env,
      capture: true,
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    server.stdout?.on('data', chunk => { serverStdout += chunk })
    server.stderr?.on('data', chunk => { serverStderr += chunk })
    const resolveUrl = () => {
      const match = /dsh web:\s+(https?:\/\/[^\s]+)/u.exec(serverStdout)
      if (match === null) return null
      const candidate = new URL(match[1])
      if (candidate.protocol !== 'http:' || candidate.hostname !== '127.0.0.1' || Number(candidate.port) !== options.port ||
          candidate.pathname !== '/' || (candidate.search !== '' && !/^\?token=[A-Za-z0-9_-]+$/u.test(candidate.search))) {
        throw new Error('official DSH logged an invalid browser acceptance URL')
      }
      return candidate.href
    }
    const url = await waitForServer(resolveUrl, server).catch(error => {
      throw new Error(`${error.message}\n${serverStderr || serverStdout}`, { cause: error })
    })

    const browser = await chromium.launch({ headless: true, channel: process.env.DSH_TEST_BROWSER_CHANNEL || undefined })
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
        colorScheme: process.env.DSH_ACCEPTANCE_COLOR_SCHEME || 'dark',
        ...(process.env.DSH_ACCEPTANCE_LOCALE === undefined ? {} : { locale: process.env.DSH_ACCEPTANCE_LOCALE }),
      })
      const deleteRequests = []
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
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
      await removeIsolatedOnboarding(page, options.dshVersion)

      if (['0.1.6-alpha.2', '0.1.7-alpha.1'].includes(options.dshVersion)) {
        await acceptModernOfficial(page, SESSION_TITLE, transcriptPath, base).catch(async error => {
          await page.screenshot({ path: join(base, 'modern-failure.png'), fullPage: true })
          await writeFile(join(base, 'modern-failure.txt'), await page.locator('body').innerText())
          throw error
        })
      } else {
      const archiveHeaderAction = page.locator('#archived-sessions')
      const viewHeaderAction = page.getByRole('button', { name: /^(View options|视图选项)$/ })
      const addWorkspaceHeaderAction = page.getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      for (const [name, action] of [
        ['archive', archiveHeaderAction],
        ['view options', viewHeaderAction],
        ['add workspace', addWorkspaceHeaderAction],
      ]) {
        await action.waitFor({ state: 'attached', timeout: 30_000 })
        if (await action.count() !== 1) throw new Error(`isolated official DSH did not expose exactly one ${name} header action`)
      }
      const headerLayout = await archiveHeaderAction.evaluate((archive, selectors) => {
        const header = archive.parentElement
        if (header === null) return null
        const view = document.querySelector(selectors.view)
        const add = document.querySelector(selectors.add)
        if (!(view instanceof HTMLElement) || !(add instanceof HTMLElement)) return null
        const bounds = element => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width }
        }
        return {
          header: bounds(header),
          archive: bounds(archive),
          view: bounds(view),
          add: bounds(add),
        }
      }, {
        view: 'button[aria-label="View options"], button[aria-label="视图选项"]',
        add: 'button[aria-label="Add workspace"], button[aria-label="添加工作区"]',
      })
      if (headerLayout === null) throw new Error('could not measure the official DSH workspace header actions')
      const { header, archive, view, add } = headerLayout
      if (!(archive.left < view.left && view.left < add.left)) {
        throw new Error(`workspace header action order drifted: ${JSON.stringify(headerLayout)}`)
      }
      if ([archive, view, add].some(action => action.width <= 0 || action.left < header.left || action.right > header.right + 0.5)) {
        throw new Error(`workspace header clips an action: ${JSON.stringify(headerLayout)}`)
      }

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
      await row.click()
      await page.waitForFunction(() => document.querySelector('[role="treeitem"][aria-selected="true"]') !== null)
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

      await archiveItem.click()
      await sessionAction.waitFor({ state: 'detached' })
      await dismissOptionalModelSetup(page, options.dshVersion)
      await page.locator('#archived-sessions').click()
      const archiveDialog = page.getByRole('dialog', { name: /^(Archived sessions|归档会话)$/ })
      const restoreAction = archiveDialog.getByRole('button', { name: /^(Restore|恢复)$/ })
      await restoreAction.waitFor()
      if (await restoreAction.count() !== 1) throw new Error('isolated archive manager did not expose exactly one restore action')
      if (typeof process.env.DSH_SESSION_MANAGER_SCREENSHOT === 'string') {
        await archiveDialog.screenshot({ path: resolve(process.env.DSH_SESSION_MANAGER_SCREENSHOT) })
      }
      const archiveSearchResponse = page.waitForResponse(response => (
        new URL(response.url()).pathname === '/plugins/dsh-session-delete/archive-search'
        && response.request().method() === 'POST'
      ))
      await archiveDialog.getByRole('searchbox').fill(SESSION_TITLE)
      const searchResponse = await archiveSearchResponse
      const searchPayload = await searchResponse.json().catch(() => null)
      if (searchResponse.status() !== 200 || searchPayload?.ok !== true) {
        throw new Error(`archived search returned HTTP ${searchResponse.status()}: ${JSON.stringify(searchPayload)}`)
      }
      await restoreAction.waitFor()
      const restoreResponse = page.waitForResponse(response => (
        new URL(response.url()).pathname === '/plugins/dsh-session-delete/restore'
        && response.request().method() === 'POST'
      ))
      await restoreAction.click()
      const restored = await restoreResponse
      const restorePayload = await restored.json().catch(() => null)
      if (restored.status() !== 200 || restorePayload?.ok !== true || restorePayload?.value?.restored !== true) {
        throw new Error(`archive restore returned HTTP ${restored.status()}: ${JSON.stringify(restorePayload)}`)
      }
      await restoreAction.waitFor({ state: 'hidden' })
      await archiveDialog.getByRole('button', { name: /^(Close|关闭)$/ }).filter({ hasText: /^(Close|关闭)$/ }).click()
      await archiveDialog.waitFor({ state: 'hidden' })
      await sessionAction.waitFor({ state: 'attached' })

      if (options.dshVersion === '0.1.6-alpha.1') {
        await openMenu()
        await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).click()
        await sessionAction.waitFor({ state: 'detached' })
      await dismissOptionalModelSetup(page, options.dshVersion)
        await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
        await page.getByRole('button', { name: /^(Archived sessions|已归档会话)$/ }).last().click()
        await page.getByRole('button', { name: /^(Unarchive|取消归档) / }).click()
        await sessionAction.waitFor({ state: 'attached' })
        await page.getByRole('button', { name: /^(Close|关闭)$/ }).last().click()
      }

      await openMenu()
      await page.getByRole('menuitem', { name: /^(Delete session|删除会话)$/ }).click()

      let dialog = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
      await dialog.getByText(sessionLabel, { exact: false }).waitFor()
      await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).click()
      await dialog.waitFor({ state: 'hidden' })
      if (deleteRequests.length !== 0) throw new Error('cancel sent a deletion request')
      await sessionAction.waitFor({ state: 'attached' })

      await openMenu()
      await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).click()
      await sessionAction.waitFor({ state: 'detached' })
      await dismissOptionalModelSetup(page, options.dshVersion)
      await page.locator('#archived-sessions').click()
      const archivedDeleteDialog = page.getByRole('dialog', { name: /^(Archived sessions|归档会话)$/ })
      const deleteArchived = archivedDeleteDialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/ })
      await deleteArchived.waitFor()
      if (await deleteArchived.count() !== 1) throw new Error('isolated archive manager did not expose exactly one delete action')
      await deleteArchived.click()
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
      await archivedDeleteDialog.getByRole('button', { name: /^(Close|关闭)$/ }).filter({ hasText: /^(Close|关闭)$/ }).click()
      await archivedDeleteDialog.waitFor({ state: 'hidden' })
      await access(transcriptPath).then(
        () => { throw new Error('confirmed deletion left the disposable transcript behind') },
        error => { if (error?.code !== 'ENOENT') throw error },
      )
      }
      if (pageErrors.length) throw new Error(`Browser runtime exceptions: ${JSON.stringify(pageErrors)}`)
    } finally {
      await browser.close()
    }
    passed = true
    return {
      ok: true,
      dshVersion: options.dshVersion,
      checks: ['official install', 'official boot', ['0.1.6-alpha.2', '0.1.7-alpha.1'].includes(options.dshVersion) ? 'one official archive settings entry' : 'workspace header actions visible', ...(['0.1.6-alpha.2', '0.1.7-alpha.1'].includes(options.dshVersion) ? [] : ['archive list', 'archived history search', 'archive restore']), 'red native action', 'second confirmation', 'cancel without request', ...(['0.1.6-alpha.2', '0.1.7-alpha.1'].includes(options.dshVersion) ? ['native menu deletion'] : ['delete from archive manager']), 'confirmed JSONL deletion', 'no page reload', ...(['0.1.6-alpha.2', '0.1.7-alpha.1'].includes(options.dshVersion) ? ['four plugin toggles preserve editable composer'] : []), 'no runtime exceptions'],
    }
  } finally {
    if (server !== undefined) await stopProcess(server)
    await writeFile(join(base, 'web.log'), `${serverStdout}\n${serverStderr}`)
    if (passed && !evidenceRoot) await rm(base, { recursive: true, force: true })
    else process.stderr.write(`Acceptance evidence retained: ${base}\n`)
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
