import assert from 'node:assert/strict'
import test from 'node:test'

import { parseArgs } from '../scripts/smoke-ui.mjs'

test('smoke test requires an explicit session and never chooses one implicitly', () => {
  assert.throws(() => parseArgs([]), /--session is required/)
})

test('smoke test accepts explicit safe targeting and browser options', () => {
  assert.deepEqual(
    parseArgs([
      '--',
      '--session', 'Disposable smoke session',
      '--url', 'http://127.0.0.1:14173',
      '--channel', 'chrome',
      '--headed',
      '--screenshot', 'dialog.png',
    ]),
    {
      session: 'Disposable smoke session',
      url: 'http://127.0.0.1:14173',
      channel: 'chrome',
      headed: true,
      screenshot: 'dialog.png',
    },
  )
})
