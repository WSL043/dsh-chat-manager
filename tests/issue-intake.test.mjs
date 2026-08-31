import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = new URL('../.github/workflows/issue-intake.yml', import.meta.url)

test('issue intake replies warmly only to recognized bug and feature reports', async () => {
  const source = await readFile(workflow, 'utf8')

  assert.match(source, /labelNames\.has\('bug'\)/)
  assert.match(source, /labelNames\.has\('enhancement'\)/)
  assert.match(source, /if \(!isBug && !isFeature\) return/)
  assert.match(source, /dsh-maintenance-ack/)
  assert.match(source, /dsh-feature-ack/)
  assert.match(source, /we\\?'ll reproduce it[\s\S]*follow up here/i)
  assert.match(source, /感谢反馈[\s\S]*同步核查结果/u)
  assert.match(source, /Thanks for the suggestion[\s\S]*fits this plugin\\?'s scope/i)
  assert.match(source, /感谢建议[\s\S]*适合由本插件负责/u)
  assert.doesNotMatch(source, /maintenance queue|implementation decision/i)
})
