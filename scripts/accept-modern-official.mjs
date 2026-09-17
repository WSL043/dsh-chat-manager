import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'

// Only called for a fresh, synthetic profile created by accept-official-dsh.
export async function acceptModernOfficial(page, title, transcriptPath) {
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
    await page.getByRole('button', { name: /^(Archived sessions|已归档会话)$/ }).last().click()
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
  await nativeArchive.click()
  await row.waitFor({ state: 'hidden' })
  await openArchive()
  const restore = page.getByRole('button', { name: /^(Unarchive|取消归档) / })
  const remove = page.getByRole('button', { name: /^(Delete permanently|永久删除) / })
  await restore.waitFor()
  assert.equal(await restore.count(), 1)
  assert.notEqual(await remove.evaluate(e => getComputedStyle(e).color), await restore.evaluate(e => getComputedStyle(e).color))
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
  assert.equal(navigations, 0)
}
