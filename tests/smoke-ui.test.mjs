import assert from 'node:assert/strict'
import test from 'node:test'

import { isIgnorableFixtureConsoleError, parseArgs } from '../scripts/smoke-ui.mjs'

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

test('simulated delete success is restricted to the isolated fixture page', () => {
  assert.throws(
    () => parseArgs([
      '--session', 'Disposable smoke session',
      '--url', 'http://127.0.0.1:14173',
      '--simulate-delete-success',
    ]),
    /requires a DSH fixture URL/,
  )

  assert.deepEqual(
    parseArgs([
      '--session', 'Disposable smoke session',
      '--url', 'http://127.0.0.1:14173/?fixture',
      '--simulate-delete-success',
    ]),
    {
      session: 'Disposable smoke session',
      url: 'http://127.0.0.1:14173/?fixture',
      headed: false,
      simulateDeleteSuccess: true,
    },
  )
})

test('smoke test accepts a portable Chromium executable without mixing launch modes', () => {
  assert.deepEqual(
    parseArgs([
      '--session', 'Disposable smoke session',
      '--executable', 'C:\\Portable\\Chromium\\chrome.exe',
    ]),
    {
      session: 'Disposable smoke session',
      url: 'http://127.0.0.1:14171',
      headed: false,
      executable: 'C:\\Portable\\Chromium\\chrome.exe',
    },
  )

  assert.throws(
    () => parseArgs([
      '--session', 'Disposable smoke session',
      '--channel', 'chrome',
      '--executable', 'C:\\Portable\\Chromium\\chrome.exe',
    ]),
    /either --channel or --executable/,
  )
})

test('fixture smoke ignores only DSH RPC endpoints absent from the isolated fixture', () => {
  assert.equal(isIgnorableFixtureConsoleError(
    '[cordis-client-runner] syncing inspect providers failed: fixture connection RPC endpoint "dynamicCordisRunner/syncInspectManifest" is unavailable',
  ), true)
  assert.equal(isIgnorableFixtureConsoleError(
    '[ui-cordis] reading the Cordis inventory failed: fixture connection RPC endpoint "dynamicCordisRunner/inventory" is unavailable',
  ), true)
  assert.equal(isIgnorableFixtureConsoleError(
    'fixture connection RPC endpoint "sessions/delete" is unavailable',
  ), false)
  assert.equal(isIgnorableFixtureConsoleError('session deletion failed'), false)
})
