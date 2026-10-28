import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildOfficialSlotClient } from './official-session-actions.mjs'

// Unreleased v2 uses public extension slots only. No upstream bundle is copied
// or patched and no historical workspace implementation is selected at runtime.
export async function buildClient() {
  const target = fileURLToPath(new URL('../lib/client.js', import.meta.url))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buildOfficialSlotClient(), 'utf8')
  return target
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(await buildClient() + '\n')
}
