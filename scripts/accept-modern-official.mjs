import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

export const ARCHIVE_SETTINGS_ID = 'dsh-chat-manager.archive-search'
export const ARCHIVE_SETTINGS_LABEL = /^(Archive cleanup|归档清理)$/

export async function openSettings(page) {
  const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  if (!await dialog.isVisible().catch(() => false)) {
    const button = page.getByRole('button', { name: /^(Settings|设置)$/ }).first()
    if (await button.isVisible().catch(() => false)) await button.click()
    else {
      await page.getByRole('button', { name: /^(Account menu|账号菜单)$/ }).click()
      await page.getByRole('menuitem', { name: /^(Settings|设置)/ }).first().click()
    }
  }
  await dialog.waitFor()
  return dialog
}
export async function openSettingsSection(page, name) {
  const dialog = await openSettings(page)
  const section = dialog.getByRole('button', { name })
  await section.waitFor()
  assert.equal(await section.count(), 1, 'exactly one public settings section is registered')
  await section.click()
  return dialog
}
export async function openPluginManager(page) {
  const settings = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  if (await settings.isVisible().catch(() => false)) await closeSettings(page)
  const button = page.getByRole('button', { name: /^(Plugins|插件)$/ })
  await button.waitFor()
  assert.equal(await button.count(), 1, 'exactly one official sidebar Plugins entry is available')
  await button.click()
  const panel = page.locator('[data-plugin-panel]')
  await panel.waitFor()
  assert.equal(await panel.count(), 1, 'the official Plugins page is unique')
  await page.waitForFunction(() => document.querySelector('[data-plugin-panel]')?.getAttribute('aria-busy') === 'false')
  const installed = panel.getByRole('tab', { name: /^(Installed|已安装)$/ })
  if (await installed.count()) await installed.click()
  await panel.locator('[data-plugin-package="dsh-chat-manager"]').getByRole('switch').waitFor()
  return panel
}
export async function openArchiveSettings(page) {
  const dialog = await openSettingsSection(page, ARCHIVE_SETTINGS_LABEL)
  await dialog.getByRole('searchbox', { name: /^(Search archived sessions|搜索已归档会话)$/ }).waitFor()
  return dialog
}
export async function closeSettings(page) {
  const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  await dialog.getByRole('button', { name: /^(Close|关闭)$/ }).last().click()
  await dialog.waitFor({ state: 'hidden' })
}

// Called only with four synthetic sessions owned by the fresh acceptance profile.
export async function acceptModernOfficial(page, fixtures, evidenceRoot, control) {
  const requests = [], refusals = []
  let navigations = 0
  const observeRequest = request => { if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') requests.push(request.method()) }
  const observeNavigation = frame => { if (frame === page.mainFrame()) navigations++ }
  page.on('request', observeRequest); page.on('framenavigated', observeNavigation)
  const capture = async name => { if (evidenceRoot) await page.screenshot({ path: path.join(evidenceRoot, name + '.png') }) }
  const row = spec => page.getByRole('treeitem').filter({ has: page.getByText(spec.title, { exact: true }) }).last()
  const sectionAction = (dialog, verb, spec) => dialog.getByRole('button', { name: archiveActionPattern(verb, spec.title) })
  const endpoint = action => page.waitForResponse(response => new URL(response.url()).pathname === '/plugins/dsh-session-delete/' + action && response.request().method() === 'POST')
  async function pickView(name) {
    await page.getByRole('button', { name: /^(View options|视图选项)$/ }).click()
    await page.getByRole('menu').getByText(name, { exact: true }).click()
  }
  async function menu(spec) {
    await row(spec).waitFor(); await row(spec).hover()
    await row(spec).getByRole('button', { name: /^(Session actions for |会话“)/ }).click()
  }
  async function waitForState(key, expected) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const state = await control('status')
      if (Object.entries(expected).every(([field, value]) => state.states[key][field] === value)) return state
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw Error('fixture state did not settle: ' + key + ' ' + JSON.stringify(expected))
  }
  async function nativeArchive(spec) {
    await menu(spec); await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).click()
    await waitForState(Object.keys(fixtures).find(key => fixtures[key].id === spec.id), { archived: true })
  }
  async function cancel() {
    const dialog = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
    const before = requests.length
    await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).last().click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(requests.length, before, 'cancel sends no deletion request')
  }
  async function assertCold() {
    const state = await control('status')
    assert.equal(state.states.cold.agentStatus, null)
    assert.equal(state.states.cold.sessionLoaded, false, 'positive target was never loaded')
    return state
  }
  const neighborBytes = await readFile(fixtures.neighbor.transcriptPath)
  const coldBytes = await readFile(fixtures.cold.transcriptPath)
  try {
    await assertCold()
    await pickView(/^(In one list|单列表)$/)
    await pickView(/^(All conversations \(show archived\)|全部对话（显示已归档）)$/)
    // Exercise the real native menu and restoration without opening the cold row.
    await menu(fixtures.cold)
    await page.getByRole('menuitem', { name: /^(Delete permanently|永久删除)$/ }).click()
    await capture('archived-row-confirm-cancel'); await cancel()
    assert.equal(requests.length, 0)
    await menu(fixtures.cold)
    await page.getByRole('menuitem', { name: /^(Unarchive session|取消归档)$/ }).click()
    await waitForState('cold', { archived: false })
    assert.equal((await assertCold()).states.cold.archived, false)
    await nativeArchive(fixtures.cold)
    assert.equal((await assertCold()).states.cold.archived, true)
    assert.deepEqual(await readFile(fixtures.cold.transcriptPath), coldBytes)

    let settings = await openArchiveSettings(page)
    const search = endpoint('archive-search')
    await settings.getByRole('searchbox').fill(fixtures.cold.prompt)
    const searched = await search, hits = await searched.json()
    assert.equal(searched.status(), 200); assert.equal(hits.ok, true)
    assert.deepEqual(hits.value.items.map(item => item.sessionId), [fixtures.cold.id])
    await capture('archive-content-search')
    const restore = sectionAction(settings, 'restore', fixtures.cold)
    await restore.click(); await restore.waitFor({ state: 'hidden' })
    assert.equal((await assertCold()).states.cold.archived, false)
    assert.deepEqual(await readFile(fixtures.cold.transcriptPath), coldBytes, 'public restore preserves transcript bytes')
    await closeSettings(page); await nativeArchive(fixtures.cold)
    await assertCold()

    // A UI-opened idle session stays owned by the fixture; the product must refuse it.
    await row(fixtures.idle).click()
    await page.locator('[contenteditable="true"],textarea').first().waitFor()
    await nativeArchive(fixtures.idle)
    const idleState = await control('status')
    assert.equal(idleState.states.idle.agentStatus, 'idle'); assert.equal(idleState.states.idle.sessionLoaded, true)
    assert.equal(idleState.states.idle.archived, true)
    const idleBytes = await readFile(fixtures.idle.transcriptPath)
    settings = await openArchiveSettings(page)
    await settings.getByRole('searchbox').fill('')
    await sectionAction(settings, 'delete', fixtures.idle).click()
    let pending = endpoint('delete')
    await page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ }).getByRole('button', { name: /^(Confirm permanent deletion|确认永久删除)$/ }).click()
    let response = await pending, payload = await response.json()
    assert.equal(response.status(), 409); assert.equal(payload.error?.code, 'session-active')
    refusals.push({ state: 'loaded-idle', status: response.status(), code: payload.error.code })
    await cancel(); assert.deepEqual(await readFile(fixtures.idle.transcriptPath), idleBytes)

    const runningState = await control('start-running')
    assert.equal(runningState.states.running.agentStatus, 'running'); assert.equal(runningState.states.running.archived, true)
    const runningBytes = await readFile(fixtures.running.transcriptPath)
    // Negative API probe observes the real host refusal; positive deletion below
    // is always a visible settings-button click on the separate cold fixture.
    const rejected = await page.evaluate(async id => {
      const res = await fetch('/plugins/dsh-session-delete/delete', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-session-delete-confirmation': 'delete-session' }, body: JSON.stringify({ sessionId: id }) })
      return { status: res.status, body: await res.json() }
    }, fixtures.running.id)
    assert.equal(rejected.status, 409); assert.equal(rejected.body.error?.code, 'session-active')
    refusals.push({ state: 'loaded-running', status: rejected.status, code: rejected.body.error.code })
    assert.deepEqual(await readFile(fixtures.running.transcriptPath), runningBytes)
    await control('release-running')

    await assertCold()
    settings = await openArchiveSettings(page)
    await settings.getByRole('searchbox').fill('')
    const remove = sectionAction(settings, 'delete', fixtures.cold)
    const restoreCold = sectionAction(settings, 'restore', fixtures.cold)
    assert.notEqual(await remove.evaluate(el => getComputedStyle(el).color), await restoreCold.evaluate(el => getComputedStyle(el).color))
    const viewport = page.viewportSize(); await page.setViewportSize({ width: 720, height: 860 })
    for (const button of [remove, restoreCold]) assert.equal(await button.evaluate(el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    }), true, 'archive actions remain clickable at narrow width')
    await capture('archive-settings-narrow'); await page.setViewportSize(viewport)
    await remove.click(); await capture('delete-confirmation'); await cancel()
    assert.deepEqual(await readFile(fixtures.cold.transcriptPath), coldBytes)
    await remove.click(); pending = endpoint('delete')
    await page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ }).getByRole('button', { name: /^(Confirm permanent deletion|确认永久删除)$/ }).click()
    response = await pending; payload = await response.json()
    assert.equal(response.status(), 200); assert.equal(payload.ok, true); assert.equal(payload.value.deleted, true)
    assert.equal(payload.value.archiveReconciled, true)
    await remove.waitFor({ state: 'hidden' })
    await assert.rejects(access(fixtures.cold.transcriptPath), { code: 'ENOENT' })
    assert.deepEqual(await readFile(fixtures.neighbor.transcriptPath), neighborBytes, 'neighbor transcript remains byte-for-byte intact')
    await closeSettings(page)

    // Return through an actual existing conversation, not the no-workspace hero.
    await menu(fixtures.idle)
    await page.getByRole('menuitem', { name: /^(Unarchive session|取消归档)$/ }).click()
    await waitForState('idle', { archived: false })
    for (let cycle = 0; cycle < 4; cycle++) {
      const plugins = await openPluginManager(page)
      const toggle = plugins.locator('[data-plugin-package="dsh-chat-manager"]').getByRole('switch')
      await toggle.waitFor(); const wasEnabled = await toggle.getAttribute('aria-checked') === 'true'
      await toggle.click()
      await page.waitForFunction(expected => document.querySelector('[data-plugin-package="dsh-chat-manager"] [role="switch"]')?.getAttribute('aria-checked') === expected, String(!wasEnabled))
      const settings = await openSettings(page)
      const contribution = settings.getByRole('button', { name: ARCHIVE_SETTINGS_LABEL })
      await contribution.waitFor({ state: wasEnabled ? 'detached' : 'visible' })
      assert.equal(await contribution.count(), wasEnabled ? 0 : 1)
      await closeSettings(page)
      await row(fixtures.idle).click()
      const composer = page.locator('[contenteditable="true"],textarea').first()
      await composer.waitFor(); assert.equal(await composer.isEditable(), true)
      await composer.fill('isolated-lifecycle-probe'); await composer.fill('')
      assert.equal((await control('status')).states.idle.agentStatus, 'idle', 'candidate unload preserves another owner Agent')
    }
    await capture('composer-after-toggles')
    assert.deepEqual(requests, ['POST', 'POST', 'POST'], 'two genuine refusals and one positive UI deletion only')
    assert.equal(navigations, 0)
    return { ok: true, settingsSectionId: ARCHIVE_SETTINGS_ID, refusals, deleteRequests: requests, mainFrameNavigations: navigations,
      boundary: 'HMR removes plugin contributions; it does not promise cancellation of already-started destructive storage work.' }
  } finally {
    await control('release-running').catch(() => {})
    page.off('request', observeRequest); page.off('framenavigated', observeNavigation)
  }
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export function archiveActionPattern(action, title) {
  if (!['delete', 'restore'].includes(action)) throw Error('unknown archive action')
  return new RegExp('^(' + (action === 'delete' ? 'Delete permanently|永久删除' : 'Unarchive|取消归档') + ') ' + escapeRegExp(title) + '$')
}
