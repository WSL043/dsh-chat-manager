import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { archiveActionPattern, openArchiveSettings } from './accept-modern-official.mjs'

const HELP = `Usage:
  pnpm smoke:ui -- --session "Exact session title" [options]

Options:
  --url <url>          Running DSH URL (default: http://127.0.0.1:14171)
  --session <title>    Exact already-archived session title (required)
  --channel <name>     Browser channel such as chrome (optional)
  --executable <path>  Existing Chromium-family executable (optional)
  --headed             Show the browser window
  --screenshot <path>  Save the opened confirmation dialog
  --simulate-delete-success
                       On a ?fixture page only, intercept the delete request,
                       click the final button, and verify no page reload
  --help               Show this help

By default this check opens the public archive settings for the explicitly named
already-archived session, verifies its deletion confirmation dialog,
and clicks Cancel without archiving or restoring anything. The simulation mode never reaches the Host deletion route or
controls DSH's process lifecycle.
`

export function parseArgs(argv) {
  const result = { url: 'http://127.0.0.1:14171', headed: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--help') return { help: true }
    if (arg === '--headed') {
      result.headed = true
      continue
    }
    if (arg === '--simulate-delete-success') {
      result.simulateDeleteSuccess = true
      continue
    }
    if (['--url', '--session', '--channel', '--executable', '--screenshot'].includes(arg)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      result[arg.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (typeof result.session !== 'string' || result.session.length === 0) {
    throw new Error('--session is required so the smoke test never chooses a user session implicitly')
  }
  if (result.channel !== undefined && result.executable !== undefined) {
    throw new Error('use either --channel or --executable, not both')
  }
  if (result.simulateDeleteSuccess === true) {
    if (!isFixtureUrl(result.url)) {
      throw new Error('--simulate-delete-success requires a DSH fixture URL so it cannot target user sessions')
    }
  }
  return result
}

export function isFixtureUrl(url) {
  return new URL(url).searchParams.has('fixture')
}

export function isIgnorableFixtureConsoleError(message) {
  return (
    message.includes('[cordis-client-runner] syncing inspect providers failed:')
      && message.includes('fixture connection RPC endpoint "dynamicCordisRunner/syncInspectManifest" is unavailable')
  ) || (
    message.includes('[ui-cordis] reading the Cordis inventory failed:')
      && message.includes('fixture connection RPC endpoint "dynamicCordisRunner/inventory" is unavailable')
  )
}

export async function runSmoke(options) {
  const deleteRequests = [], consoleErrors = []
  const fixture = isFixtureUrl(options.url)
  const browser = await chromium.launch({ headless: !options.headed,
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.executable === undefined ? {} : { executablePath: options.executable }) })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    let armed = false, navigations = 0
    page.on('request', request => { if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') deleteRequests.push(request.method()) })
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('framenavigated', frame => { if (armed && frame === page.mainFrame()) navigations++ })
    if (options.simulateDeleteSuccess === true) await page.route('**/plugins/dsh-session-delete/delete', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, value: { deleted: true, archiveReconciled: true } }),
    }))
    await page.goto(options.url, { waitUntil: 'domcontentloaded' }); armed = true
    // Finish onboarding before invoking smoke. This runner does not acknowledge
    // notices, alter profile settings, archive targets or choose a session itself.
    const settings = await openArchiveSettings(page)
    const remove = settings.getByRole('button', { name: archiveActionPattern('delete', options.session) })
    await remove.waitFor()
    if (await remove.count() !== 1) throw Error('the exact archived target must identify one cleanup row')
    const restore = settings.getByRole('button', { name: archiveActionPattern('restore', options.session) })
    if (await remove.evaluate(el => getComputedStyle(el).color) === await restore.evaluate(el => getComputedStyle(el).color)) throw Error('delete action lacks a distinct danger color')
    await remove.click()
    const dialog = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
    await dialog.getByText(options.session, { exact: true }).waitFor()
    if (options.screenshot) await dialog.screenshot({ path: options.screenshot })
    if (options.simulateDeleteSuccess === true) {
      await dialog.getByRole('button', { name: /^(Confirm permanent deletion|确认永久删除)$/ }).click()
      await dialog.waitFor({ state: 'hidden' })
      if (deleteRequests.length !== 1 || deleteRequests[0] !== 'POST') throw Error('simulation expected one intercepted POST')
    } else {
      await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).last().click()
      await dialog.waitFor({ state: 'hidden' })
      if (deleteRequests.length !== 0) throw Error('cancel unexpectedly sent a deletion request')
    }
    if (navigations !== 0) throw Error('cleanup dialog flow reloaded the page')
    const blocking = fixture ? consoleErrors.filter(message => !isIgnorableFixtureConsoleError(message)) : consoleErrors
    if (blocking.length) throw Error('browser console errors: ' + blocking.join(' | '))
    return { ok: true, simulated: options.simulateDeleteSuccess === true,
      checks: ['public archive settings', 'exact archived target', 'danger color', 'named confirmation', options.simulateDeleteSuccess ? 'intercepted simulated success only' : 'cancel without request', 'no page reload'] }
  } finally { await browser.close() }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(HELP)
    } else {
      process.stdout.write(`${JSON.stringify(await runSmoke(options))}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
