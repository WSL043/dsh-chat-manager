import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')

test('friendly setup downloads a checksum-verified immutable manager', async () => {
  const bytes = await readFile(join(root, 'dsh-session-delete-setup.ps1'))
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5.1 requires a BOM for Chinese text')
  const script = bytes.toString('utf8')
  assert.match(script, /api\.github\.com\/repos\/WSL043\/dsh-session-delete\/releases\/latest/)
  assert.match(script, /dsh-session-delete\.ps1\.sha256/)
  assert.match(script, /checksum mismatch/i)
  assert.match(script, /中文（简体）/)
  assert.match(script, /English/)
  assert.match(script, /More than one DSH installation was found/)
  assert.doesNotMatch(script, /Stop-Process|taskkill|Remove-Item[^\n]+\.lock/i)
})
