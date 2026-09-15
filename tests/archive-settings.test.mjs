import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { registerArchiveSettings } from '../scripts/archive-settings.mjs'

test('unified archive section waits for the compatible settings host and registers once', () => {
  const listeners = new Map(), registrations = [], cleanups = []
  const window = {
    addEventListener: (name, fn) => listeners.set(name,fn),
    removeEventListener: (name, fn) => { if(listeners.get(name)===fn)listeners.delete(name) },
  }
  const ctx = { locale: {getSnapshot:()=>({active:'zh'})},
    effect: fn=>cleanups.push(fn()),
    slots: {inject: (_name,fn)=>fn(), register: (meta,component)=>registrations.push({meta,component})} }
  const context={window,ctx,React:{createElement(){}},ui:{}}
  vm.runInNewContext(`(${registerArchiveSettings.toString()})(ctx,React,ui)`,context)
  assert.equal(registrations.length,0)
  window.__DSH_PORTABLE_SETTINGS__={open(){throw Error('registration must not open settings')}}
  listeners.get('dsh-portable/settings-ready')()
  listeners.get('dsh-portable/settings-ready')()
  assert.equal(registrations.length,1)
  assert.equal(registrations[0].meta.id,'archived-sessions')
  assert.equal(registrations[0].meta.priority,-10)
  cleanups.forEach(fn=>fn())
  assert.equal(listeners.size,0)
})
