import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HELP = `Usage:
  pnpm smoke:ui -- --session "Exact session title" [options]

Options:
  --url <url>          Running DSH URL (default: http://127.0.0.1:14171)
  --session <title>    Exact existing session title (required)
  --channel <name>     Browser channel such as chrome (optional)
  --headed             Show the browser window
  --screenshot <path>  Save the opened confirmation dialog
  --help               Show this help

This check opens Delete session…, verifies the confirmation dialog, and clicks
Cancel. It never clicks the permanent-delete button and never controls DSH's
process lifecycle.
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
    if (['--url', '--session', '--channel', '--screenshot'].includes(arg)) {
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
  return result
}

export async function runSmoke(options) {
  const deleteRequests = []
  const consoleErrors = []
  const browser = await chromium.launch({
    headless: !options.headed,
    ...(options.channel === undefined ? {} : { channel: options.channel }),
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') {
        deleteRequests.push(request.method())
      }
    })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(options.url, { waitUntil: 'domcontentloaded' })
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

    await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).waitFor()
    const deleteItem = page.getByRole('menuitem', { name: /^(Delete session…|删除会话…)$/ })
    await deleteItem.waitFor()
    await deleteItem.click()

    const dialog = page.getByRole('dialog')
    await dialog.getByText(/^(Permanently delete session\?|永久删除会话？)$/).waitFor()
    await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/ }).waitFor()
    const cancel = dialog.getByRole('button', { name: /^(Cancel|取消)$/ })
    await cancel.waitFor()
    if (options.screenshot !== undefined) await dialog.screenshot({ path: options.screenshot })
    await cancel.click()
    await dialog.waitFor({ state: 'hidden' })

    if (deleteRequests.length > 0) {
      throw new Error(`cancel path unexpectedly sent ${deleteRequests.length} delete request(s)`)
    }
    if (consoleErrors.length > 0) {
      throw new Error(`browser console errors: ${consoleErrors.join(' | ')}`)
    }
    return {
      ok: true,
      checks: ['Archive session', 'Delete session…', 'confirmation dialog', 'cancel without request'],
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
