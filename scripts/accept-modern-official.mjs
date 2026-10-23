import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

function transcriptRecords(bytes, compressed) {
  const chunks = []
  for (let offset = 0; offset < bytes.length;) {
    if (!compressed) { chunks.push(bytes); break }
    const { buffer, engine } = zstdDecompressSync(bytes.subarray(offset), { info: true })
    assert.ok(engine.bytesWritten > 0, 'each compressed frame advances the history read')
    chunks.push(buffer)
    offset += engine.bytesWritten
  }
  return Buffer.concat(chunks).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

// Only called for a fresh, synthetic profile created by accept-official-dsh.
export async function acceptModernOfficial(page, title, transcriptPath, evidenceRoot) {
  const capture = async name => {
    if (evidenceRoot) await page.screenshot({ path: path.join(evidenceRoot, `${name}.png`) })
  }
  if (await page.locator('#archived-sessions').count()) {
    // Search is a sibling of the action group in the rc.3 section header.
    const header = page.locator('#archived-sessions').locator('..').locator('..').locator('..')
    const buttons = header.getByRole('button')
    assert.equal(await buttons.count(), 4, 'retain search, archive, view options and add workspace')
    for (const button of await buttons.all()) {
      assert.equal(await button.evaluate(el => {
        const r = el.getBoundingClientRect()
        return [r.left + 2, r.right - 2].every(x => el.contains(document.elementFromPoint(x, r.top + r.height / 2)))
      }), true, 'every header action must be fully clickable, not clipped')
    }
  }
  const requests = []
  let navigations = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/plugins/dsh-session-delete/delete') requests.push(request.method())
  })
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  let row = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) }).last()
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
    if (await page.evaluate(() => typeof window.__DSH_PORTABLE_SETTINGS__?.open === 'function')) {
      await page.locator('#archived-sessions').click()
    } else {
      const settingsButton = page.getByRole('button', { name: /^(Settings|设置)$/ })
      if (!await settingsButton.isVisible().catch(() => false)) {
        await page.getByRole('button', { name: /^(Account menu|账号菜单)$/ }).click()
        await page.getByRole('menuitem', { name: /^(Settings|设置)/ }).first().click()
      } else {
        await settingsButton.click()
      }
      await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Archived sessions|已归档会话)$/ }).click()
    }
    assert.equal(await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Archived sessions|已归档会话)$/ }).count(), 1)
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
  // Give the fixture a different title so its original prompt can only match history content.
  const historyQuery = title
  const beforeRename = await readFile(transcriptPath)
  await openSessionMenu()
  await page.getByRole('menuitem', { name: /^(Rename|重命名)/ }).click()
  const rename = page.getByRole('dialog', { name: /^(Rename session|重命名会话)$/ })
  title = 'Archive layout acceptance — a long conversation title for narrow windows'
  await rename.getByRole('textbox').fill(title)
  await rename.getByRole('button', { name: /^(Rename|重命名)$/ }).click()
  await rename.waitFor({ state: 'hidden' })
  row = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) }).last()
  await row.waitFor()
  // Rename persistence is asynchronous; freeze the preservation baseline after its append is durable.
  let transcript = await readFile(transcriptPath)
  const renamed = () => transcriptRecords(transcript, transcriptPath.endsWith('.zstd'))
    .some(record => record.type === 'session/title' && record.data?.title === title)
  for (let attempt = 0; !renamed() && attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    transcript = await readFile(transcriptPath)
  }
  assert.ok(renamed(), 'renaming reaches durable storage')
  assert.deepEqual(transcript.subarray(0, beforeRename.length), beforeRename, 'renaming retains the existing history bytes')
  await openSessionMenu()
  const nativeDelete = page.getByRole('menuitem', { name: /^(Delete session|删除会话|Delete permanently|永久删除)$/ })
  const nativeArchive = page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/ })
  assert.notEqual(await nativeDelete.evaluate(e => getComputedStyle(e).color), await nativeArchive.evaluate(e => getComputedStyle(e).color))
  await capture('session-menu')
  await nativeDelete.click()
  const nativeConfirm = page.getByRole('dialog', { name: /^(Permanently delete session\?|永久删除会话？)$/ })
  await nativeConfirm.getByRole('button', { name: /^(Cancel|取消)$/ }).filter({ hasText: /^(Cancel|取消)$/ }).click()
  assert.equal(requests.length, 0)
  await openSessionMenu()
  await nativeArchive.click()
  await row.waitFor({ state: 'hidden' })
  await openArchive()
  const restore = page.getByRole('button', { name: /^(Unarchive|取消归档) / })
  const remove = page.getByRole('button', { name: /^(Delete permanently|永久删除) / })
  await restore.waitFor()
  assert.equal(await restore.count(), 1)
  assert.notEqual(await remove.evaluate(e => getComputedStyle(e).color), await restore.evaluate(e => getComputedStyle(e).color))
  await capture('archive-settings')
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 720, height: 860 })
  for (const button of [restore, remove]) {
    assert.equal(await button.evaluate(el => {
      const rect = el.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth
        && el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    }), true, 'archive actions remain visible and clickable in a narrow window')
  }
  await capture('archive-settings-narrow')
  await page.setViewportSize(viewport)
  const search = endpoint('archive-search')
  await page.getByRole('searchbox').fill(historyQuery)
  const searched = await successful(search)
  assert.equal(searched.value.items.length, 1, 'history search resolves the renamed disposable session')
  await capture('archive-history-search')
  const restored = endpoint('restore')
  await restore.click()
  assert.equal((await successful(restored)).value.restored, true)
  assert.deepEqual(await readFile(transcriptPath), transcript, 'restoring preserves the transcript')
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
  assert.deepEqual(await readFile(transcriptPath), transcript, 'cancelling deletion preserves the transcript')
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
    await page.getByRole('button', { name: /^(New session|新建会话)$/i }).first().click()
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
