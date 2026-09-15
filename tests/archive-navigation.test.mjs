import assert from 'node:assert/strict'
import test from 'node:test'
import { openOfficialArchives } from '../scripts/build-client.mjs'

test('official archive navigation requires both the section and an acknowledging bridge', () => {
  const previous = globalThis.window
  const events = []
  let acknowledge = true
  globalThis.window = { dispatchEvent(event) { events.push(event); if (acknowledge) event.preventDefault(); return !event.defaultPrevented } }
  try {
    const ctx = { slots: { entries: () => [{ options: { id: 'archived-sessions' } }] } }
    assert.equal(openOfficialArchives(ctx, true), true)
    assert.deepEqual(events[0].detail, { section: 'archived-sessions', probe: true })
    assert.equal(openOfficialArchives(ctx), true)
    assert.equal(events[1].detail.probe, false)
    acknowledge = false
    assert.equal(openOfficialArchives(ctx), false)
    ctx.slots.entries = () => []
    assert.equal(openOfficialArchives(ctx), false)
    assert.equal(events.length, 3)
    assert.equal(openOfficialArchives({}), false)
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous }
})
