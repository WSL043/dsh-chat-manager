import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = new URL('../.github/workflows/issue-intake.yml', import.meta.url)

test('issue intake acknowledges supported reports without promising an automatic fix', async () => {
  const source = await readFile(workflow, 'utf8')

  assert.match(source, /issues:\s*\n\s*types: \[opened\]/u)
  assert.match(source, /github\.event\.issue\.user\.type != 'Bot'/u)
  assert.match(source, /labelNames\.has\('bug'\)/u)
  assert.match(source, /labelNames\.has\('enhancement'\)/u)
  assert.match(source, /if \(!isBug && !isFeature\) return/u)
  assert.match(source, /dsh-maintenance-ack/u)
  assert.match(source, /dsh-feature-ack/u)
  assert.match(source, /reproduce it on the reported plugin and DSH versions[\s\S]*follow up here/iu)
  assert.match(source, /感谢反馈[\s\S]*同步核查结果/u)
  assert.match(source, /whether DSH already provides this capability[\s\S]*fits this plugin's scope/iu)
  assert.match(source, /感谢建议[\s\S]*适合由本插件负责/u)
  assert.doesNotMatch(source, /automatically (?:fix|close)|maintenance queue/iu)
})
