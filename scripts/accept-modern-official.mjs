import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'

// Only called for a fresh, synthetic profile created by accept-official-dsh.
export async function acceptModernOfficial(page, title, transcriptPath, evidenceRoot) {
  const capture = async name => {
    if (evidenceRoot) await page.screenshot({ path: path.join(evidenceRoot, `${name}.png`) })
  }
  const requests = []
  let navigations = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') requests.push(request.method())
  })
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  const row = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) }).last()
  const actions = page.getByRole('button', { name: /^(Session actions for |会话“)/ })
  async function openSessionMenu() {
    if (!await row.isVisible()) {
      const ungrouped = page.getByText(/^(Ungrouped|未分组)$/)
      if (await ungrouped.isVisible()) await ungrouped.click()
    }
    await row.hover()
    await actions.click()
  }
  async function openArchive() {
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    assert.equal(await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Archived sessions|已归档会话)$/ }).count(), 1)
    await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Archived sessions|已归档会话)$/ }).click()
    await page.getByRole('searchbox', { name: /^(Search archived sessions|搜索已归档会话)$/ }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: /^(Archived sessions|归档会话)$/ }).count(), 0)
  }
  async function closeArchive() {
    await page.getByRole('button', { name: /^(Close|关闭)$/ }).last().click()
    await page.getByRole('searchbox', { name: /^(Search archived sessions|搜索已归档会话)$/ }).waitFor({ state: 'hidden' })
  }
  async function archive() {
    await openSessionMenu()
    await page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ }).click()
    await row.waitFor({ state: 'hidden' })
  }
  const endpoint = action => page.waitForResponse(response => new URL(response.url()).pathname === `/plugins/dsh-session-delete/${action}` && response.request().method() === 'POST')
  async function successful(responsePromise) {
    const response = await responsePromise
    assert.equal(response.status(), 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    return body
  }
  await openSessionMenu()
  const nativeDelete = page.getByRole('menuitem', { name: /^(Delete session|删除会话)$/ })
  const nativeArchive = page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ })
  assert.notEqual(await nativeDelete.evaluate(e => getComputedStyle(e).color), await nativeArchive.evaluate(e => getComputedStyle(e).color))
  if (!await page.evaluate(() => typeof window.__DSH_PORTABLE_SETTINGS__?.open === 'function')) {
    await capture('session-menu')
    await nativeDelete.click()
    const dialog = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
    await capture('delete-confirmation')
    await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).filter({ hasText: /^(Cancel|取消)$/ }).click()
    assert.equal(requests.length, 0)
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const archiveTab = page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Archived sessions|已归档会话)$/ })
    assert.equal(await archiveTab.count(), 1)
    await archiveTab.click()
    await capture('archive-settings')
    await closeArchive()
    await openSessionMenu()
    await nativeDelete.click()
    const removed = endpoint('delete')
    await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/ }).click()
    await successful(removed)
    await dialog.waitFor({ state: 'hidden' })
    await assert.rejects(access(transcriptPath), { code: 'ENOENT' })
    await acceptLifecycle()
    return
  }
  await capture('session-menu')
  await nativeArchive.click()
  await row.waitFor({ state: 'hidden' })
  await openArchive()
  const restore = page.getByRole('button', { name: /^(Unarchive|取消归档) / })
  const remove = page.getByRole('button', { name: /^(Delete permanently|永久删除) / })
  await restore.waitFor()
  assert.equal(await restore.count(), 1)
  assert.notEqual(await remove.evaluate(e => getComputedStyle(e).color), await restore.evaluate(e => getComputedStyle(e).color))
  await capture('archive-settings')
  const search = endpoint('archive-search')
  await page.getByRole('searchbox').fill(title)
  await successful(search)
  const restored = endpoint('restore')
  await restore.click()
  assert.equal((await successful(restored)).value.restored, true)
  await restore.waitFor({ state: 'hidden' })
  await closeArchive()
  await archive()
  await openArchive()
  await remove.click()
  const confirm = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
  await capture('delete-confirmation')
  await confirm.getByRole('button', { name: /^(Cancel|取消)$/ }).filter({ hasText: /^(Cancel|取消)$/ }).click()
  await confirm.waitFor({ state: 'hidden' })
  assert.equal(requests.length, 0)
  await access(transcriptPath)
  await remove.click()
  const deleted = endpoint('delete')
  await confirm.getByRole('button', { name: /^(Confirm permanent deletion|确认永久删除)$/ }).click()
  await successful(deleted)
  await confirm.waitFor({ state: 'hidden' })
  await remove.waitFor({ state: 'hidden' })
  assert.deepEqual(requests, ['POST'])
  await assert.rejects(access(transcriptPath), { code: 'ENOENT' })
  await closeArchive()
  await openArchive()
  await closeArchive()
  await acceptLifecycle()
  async function acceptLifecycle() {
  // Regression: disabling the extension must not dispose the official composer.
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.getByRole('button', { name: /^(Plugins|插件)$/ }).first().click()
    const toggle = page.locator('[data-plugin-package="dsh-chat-manager"]').getByRole('switch')
    await toggle.waitFor()
    const enabled = await toggle.getAttribute('aria-checked') === 'true'
    await toggle.click()
    await page.waitForFunction(expected => document.querySelector('[data-plugin-package="dsh-chat-manager"] [role="switch"]')?.getAttribute('aria-checked') === expected, String(!enabled))
    await page.getByText(/^(New session|新会话)$/).first().click()
    const composer = page.locator('[contenteditable="true"],textarea').first()
    await composer.waitFor()
    assert.equal(await composer.isEditable(), true)
    await composer.fill('isolated-lifecycle-probe')
    await composer.fill('')
  }
  await capture('composer-after-toggles')
  assert.equal(navigations, 0)
  }
}
