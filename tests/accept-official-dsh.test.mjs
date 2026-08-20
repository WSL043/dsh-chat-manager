import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseOfficialAcceptanceArgs,
} from '../scripts/accept-official-dsh.mjs'

test('official acceptance requires an exact DSH version and candidate tarball', () => {
  assert.deepEqual(parseOfficialAcceptanceArgs([
    '--dsh-version', '0.1.0-rc.9',
    '--package', '/tmp/plugin.tgz',
    '--port', '14191',
  ]), {
    dshVersion: '0.1.0-rc.9',
    packagePath: '/tmp/plugin.tgz',
    port: 14191,
  })
  assert.throws(() => parseOfficialAcceptanceArgs([]), /--dsh-version is required/)
  assert.throws(
    () => parseOfficialAcceptanceArgs(['--dsh-version', 'next', '--package', '/tmp/plugin.tgz']),
    /exact semantic version/,
  )
})
