import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HELP = `Usage:
  pnpm smoke:ui -- --session "Exact session title" [options]

Options:
  --url <url>          Running DSH URL (default: http://127.0.0.1:14171)
  --session <title>    Exact existing session title (required)
  --channel <name>     Browser channel such as chrome (optional)
  --executable <path>  Existing Chromium-family executable (optional)
  --headed             Show the browser window
  --screenshot <path>  Save the opened confirmation dialog
  --simulate-delete-success
                       On a ?fixture page only, intercept the delete request,
                       click the final button, and verify no page reload
  --help               Show this help

By default this check opens Delete session, verifies the confirmation dialog,
and clicks Cancel. The simulation mode never reaches the Host deletion route or
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
  const deleteRequests = []
  const consoleErrors = []
  const fixture = isFixtureUrl(options.url)
  const browser = await chromium.launch({
    headless: !options.headed,
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.executable === undefined ? {} : { executablePath: options.executable }),
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    let navigationArmed = false
    let mainFrameNavigations = 0
    if (options.simulateDeleteSuccess === true) {
      await page.addInitScript(() => {
        globalThis.__dshDeleteSmokeDocumentToken = crypto.randomUUID()
      })
      await page.route('**/plugins/dsh-session-delete/delete', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, value: { deleted: true } }),
        })
      })
      page.on('framenavigated', (frame) => {
        if (navigationArmed && frame === page.mainFrame()) mainFrameNavigations += 1
      })
    }
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') {
        deleteRequests.push(request.method())
      }
    })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(options.url, { waitUntil: 'domcontentloaded' })
    const documentToken = options.simulateDeleteSuccess === true
      ? await page.evaluate(() => globalThis.__dshDeleteSmokeDocumentToken)
      : undefined
    if (fixture) {
      // Fixture mode cannot persist DSH's product-wide onboarding acknowledgement,
      // so clicking Continue immediately reopens the unrelated notice. Remove only
      // that exact fixture-only overlay; never mutate real settings or user pages.
      const onboarding = page.getByRole('dialog', { name: /^(内测声明|Internal Testing Notice)$/ })
      const onboardingVisible = await onboarding
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true, () => false)
      if (onboardingVisible) {
        await onboarding.evaluate((element) => {
          const overlay = element.parentElement
          if (overlay !== null) overlay.remove()
          else element.remove()
          for (const inertElement of document.querySelectorAll('[inert]')) {
            inertElement.removeAttribute('inert')
          }
        })
      }
    }
    await page.locator('#archived-sessions').click()
    const archiveDialog = page.getByRole('dialog', { name: /^(Archived sessions|归档会话)$/ })
    await archiveDialog.getByRole('searchbox').waitFor()
    await archiveDialog.getByRole('button', { name: /^(Close|关闭)$/ }).filter({ hasText: /^(Close|关闭)$/ }).click()
    await archiveDialog.waitFor({ state: 'hidden' })
    const matchingTitles = page.getByText(options.session, { exact: true })
    await matchingTitles.first().waitFor()
    const rowCount = await matchingTitles.count()
    if (rowCount !== 1) {
      throw new Error(`expected exactly one visible session row named ${JSON.stringify(options.session)}, found ${rowCount}`)
    }

    const row = matchingTitles.first().locator('xpath=ancestor::*[@role="treeitem"][1]')
    await row.hover()
    const actions = row.getByRole('button')
    if (await actions.count() !== 1) throw new Error('session action button was not uniquely identifiable')
    await actions.click()

    const archiveItem = page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ })
    await archiveItem.waitFor()
    const deleteItem = page.getByRole('menuitem', { name: /^(Delete session|删除会话)$/ })
    await deleteItem.waitFor()
    const [archiveColor, deleteColor] = await Promise.all([
      archiveItem.evaluate((element) => getComputedStyle(element).color),
      deleteItem.evaluate((element) => getComputedStyle(element).color),
    ])
    if (archiveColor === deleteColor) {
      throw new Error(`delete menu item is not using a distinct danger color (${deleteColor})`)
    }
    await deleteItem.click()

    const dialog = page.getByRole('dialog')
    await dialog.getByText(/^(Permanently delete session\?|永久删除会话？)$/).waitFor()
    await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/ }).waitFor()
    const cancel = dialog.getByRole('button', { name: /^(Cancel|取消)$/ })
    await cancel.waitFor()
    if (options.screenshot !== undefined) await dialog.screenshot({ path: options.screenshot })
    if (options.simulateDeleteSuccess === true) {
      navigationArmed = true
      await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/ }).click()
      await page.waitForTimeout(750)
      const settledToken = await page.evaluate(() => globalThis.__dshDeleteSmokeDocumentToken)
      if (deleteRequests.length !== 1) {
        throw new Error(`simulated success expected one delete request, observed ${deleteRequests.length}`)
      }
      if (mainFrameNavigations !== 0 || settledToken !== documentToken) {
        throw new Error(`successful deletion reloaded the WebView (${mainFrameNavigations} main-frame navigation(s))`)
      }
      await dialog.getByText(/^(Permanently delete session\?|永久删除会话？)$/).waitFor({ state: 'hidden' })
    } else {
      await cancel.click()
      await dialog.waitFor({ state: 'hidden' })
      if (deleteRequests.length > 0) {
        throw new Error(`cancel path unexpectedly sent ${deleteRequests.length} delete request(s)`)
      }
    }
    const blockingConsoleErrors = fixture
      ? consoleErrors.filter((message) => !isIgnorableFixtureConsoleError(message))
      : consoleErrors
    if (blockingConsoleErrors.length > 0) {
      throw new Error(`browser console errors: ${blockingConsoleErrors.join(' | ')}`)
    }
    return {
      ok: true,
      checks: options.simulateDeleteSuccess === true
        ? ['archive manager', 'Archive session', 'red Delete session', 'confirmation dialog', 'successful delete without reload']
        : ['archive manager', 'Archive session', 'red Delete session', 'confirmation dialog', 'cancel without request'],
    }
  } finally {
    await browser.close()
  }
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
