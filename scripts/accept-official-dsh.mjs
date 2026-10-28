import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'
import { acceptModernOfficial } from './accept-modern-official.mjs'
import { randomUUID } from 'node:crypto'

const FIXED_DSH_VERSION = '0.2.2-alpha.2'

export function parseOfficialAcceptanceArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!['--dsh-version', '--package', '--port'].includes(name)) throw new Error(`unknown argument: ${name}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    values[name] = value
    index += 1
  }
  if (values['--dsh-version'] !== undefined && values['--dsh-version'] !== FIXED_DSH_VERSION) throw new Error('--dsh-version must be the fixed 0.2.2-alpha.2 candidate target')
  if (values['--package'] === undefined) throw new Error('--package is required')
  const port = values['--port'] === undefined ? 14191 : Number(values['--port'])
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be between 1024 and 65535')
  return { dshVersion: FIXED_DSH_VERSION, packagePath: values['--package'], port }
}

// These are operator-selected package roots, not executable names or CLI fragments.
// Metadata/path checks constrain the fixture tool; they are not package signature verification.
export async function resolveOfficialAcceptanceCommand({ runtimeRoot = process.env.DSH_TEST_RUNTIME, pnpmRoot = process.env.DSH_TEST_PNPM_ROOT } = {}) {
  const official = Boolean(runtimeRoot)
  const selected = official ? runtimeRoot : pnpmRoot
  if (typeof selected !== 'string' || !isAbsolute(selected)) throw Error('provide an absolute DSH_TEST_RUNTIME or DSH_TEST_PNPM_ROOT package directory')
  const directory = await realpath(selected)
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const entryPath = official ? join('lib', 'bin.js') : join('bin', 'pnpm.mjs')
  if (official ? manifest.name !== '@deepseek-ai/dsh' || manifest.version !== FIXED_DSH_VERSION || manifest.bin?.dsh !== 'lib/bin.js'
    : manifest.name !== 'pnpm' || manifest.version !== '11.19.0' || manifest.bin?.pnpm !== 'bin/pnpm.mjs') {
    throw Error(official ? 'runtime does not match fixed official Alpha2' : 'pnpm does not match fixed 11.19.0 JS entry')
  }
  const entry = await realpath(join(directory, entryPath))
  if (relative(directory, entry) !== entryPath || !(await stat(entry)).isFile()) throw Error('CLI entry must be the expected regular file inside its package directory')
  return official ? [entry] : [entry, 'dlx', '--allow-build=fs-ext', '@deepseek-ai/dsh@' + FIXED_DSH_VERSION]
}

export function sanitizeAcceptanceDiagnostic(value, secrets = []) {
  let text = String(value ?? '')
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[REDACTED]')
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, source => {
    try { const url = new URL(source); return url.origin + url.pathname } catch { return '[URL REDACTED]' }
  }).replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|nonce|authorization|auth|cookie)=)[^&#\s"']+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:token|nonce|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]')
}

export async function waitForAcceptanceFixture(config, { child, timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let phase = 'not-started'
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null && child.exitCode !== undefined || child.signalCode != null)) throw Error('official DSH exited before fixture readiness (' + (child.exitCode ?? child.signalCode) + '); phase=' + phase)
    let status
    try { status = JSON.parse(await readFile(config.statusPath, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    if (status) {
      phase = status.phase
      if (phase === 'failed') throw Error('fixture initialization failed: ' + sanitizeAcceptanceDiagnostic(status.error, [config.nonce]))
      if (phase === 'ready') {
        const snapshot = JSON.parse(await readFile(config.statePath, 'utf8'))
        const keys = ['cold', 'neighbor', 'idle', 'running']
        for (const key of keys) {
          const actual = snapshot.fixtures?.[key], expected = config.sessions[key], state = snapshot.states?.[key]
          const location = actual?.transcriptPath
          const relativePath = typeof location === 'string' && isAbsolute(location) ? relative(config.sessionRoot, location) : '..'
          if (!actual || actual.id !== expected.id || actual.title !== expected.title || actual.prompt !== expected.prompt
            || relativePath === '' || relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) throw Error('ready fixture identity or isolated transcript location is invalid: ' + key)
          const cold = key === 'cold' || key === 'neighbor'
          if (!state || state.agentStatus !== (cold ? null : 'idle') || state.sessionLoaded !== !cold || state.archived !== cold) throw Error('ready fixture has unexpected genuine host state: ' + key)
          await access(location)
        }
        return snapshot
      }
      if (phase !== 'applying') throw Error('unknown fixture initialization phase: ' + String(phase))
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw Error('timed out waiting for generated fixture readiness; phase=' + phase)
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      detached: options.detached ?? false,
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0 || options.allowFailure) resolvePromise({ code, stdout, stderr, child })
      else reject(new Error(sanitizeAcceptanceDiagnostic(`${command} exited with ${code}: ${stderr || stdout}`, options.secrets).slice(-8192)))
    })
  })
}

async function waitForServer(resolveUrl, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`official DSH exited before accepting connections (${child.exitCode})`)
    const url = resolveUrl()
    if (url !== null) return url
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error(`official DSH did not start within ${timeoutMs}ms`)
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(child.pid), '/t', '/f'], { allowFailure: true, capture: true })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  }
  await Promise.race([
    new Promise(resolvePromise => child.once('exit', resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 5000)),
  ])
}


// Generated into the isolated profile only; never installed into a daily profile.
async function installOwnedAcceptanceFixture(ctx, config) {
  const handles = new Map()
  let releaseHeld, enteredHeld = false
  const adapter = {
    providerInfo: id => ({ id, name: id }), providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => ({ width: image.width, height: image.height, maxBytes: image.bytes }),
    listModels: async () => [{ id: 'done', name: 'Fixture done' }, { id: 'hold', name: 'Fixture held activity' }],
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    async prepareCall(provider, model) { return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) } },
    async *stream(options) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Synthetic acceptance response' }
      if (options.model === 'hold') {
        enteredHeld = true
        // A controlled drain delay exposes the real running Agent after the
        // official archive operation issues cancellation. Only this owner may
        // release it. There is no network call or product lifecycle interception.
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('fixture held activity exceeded 60 seconds')), 60000)
          releaseHeld = () => { clearTimeout(timer); resolve() }
        })
        if (options.signal?.aborted) throw Error('fixture activity cancelled by its owner')
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic acceptance response' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  ctx.llm.registerAdapter([config.provider], adapter)
  ctx.effect(() => async () => {
    releaseHeld?.()
    await Promise.all([...handles.values()].map(handle => handle.dispose()))
    handles.clear()
  }, 'acceptance fixture: dispose only fixture-owned agents')
  const message = text => Object.freeze({ id: globalThis.crypto.randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
  const fixtures = {}
  for (const key of ['cold', 'neighbor', 'idle', 'running']) {
    const spec = config.sessions[key]
    const handle = await ctx.agents.create({ sessionId: spec.id, meta: { cwd: config.workspace }, agentOptions: { provider: config.provider, model: key === 'running' ? 'hold' : 'done' } })
    handles.set(key, handle)
    // Let the public title service produce its complete, pinned user-title event.
    ctx.sessionTitle.rename(handle.agent.session, spec.title)
    // A completed turn makes idle a real non-blank history row for the UI click.
    if (key === 'cold' || key === 'neighbor' || key === 'idle') {
      handle.agent.followup(message(spec.prompt))
      await handle.agent.whenIdle()
    }
    await ctx.sessionPersistence.flush()
    const transcriptPath = await ctx.sessionPersistence.resolveCurrentLog(spec.id)
    if (typeof transcriptPath !== 'string') throw Error('fixture did not produce current JSONL storage')
    fixtures[key] = { ...spec, transcriptPath }
    if (key === 'cold' || key === 'neighbor') {
      await handle.dispose()
      handles.delete(key)
      await ctx.workspaceRegistry.archiveSession(spec.id)
    }
  }
  const snapshot = () => ({ fixtures, states: Object.fromEntries(Object.entries(fixtures).map(([key, spec]) => [key, {
    agentStatus: ctx.agents.get(spec.id)?.status ?? null,
    sessionLoaded: ctx.sessions.get(spec.id) !== undefined,
    archived: ctx.workspaceRegistry.archivedSessionIds.includes(spec.id),
  }])) })
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/plugins/dsh-chat-manager-acceptance-fixture/control', handler: async (req, res) => {
    if (req.method !== 'POST' || req.headers['x-dsh-acceptance-fixture'] !== config.nonce) { send(res, 403, { ok: false }); return }
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1024) throw Error('oversized fixture control') }
      const { action } = JSON.parse(raw)
      if (action === 'start-running') {
        const handle = handles.get('running')
        if (!handle || handle.agent.status !== 'idle') throw Error('running fixture is not idle before starting')
        handle.agent.followup(message(config.sessions.running.prompt))
        const deadline = Date.now() + 10000
        while ((!enteredHeld || handle.agent.status !== 'running') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
        if (!enteredHeld || handle.agent.status !== 'running') throw Error('fixture did not reach genuine running activity')
        await ctx.workspaceRegistry.archiveSession(handle.agent.id, { stopActivity: true })
        await ctx.sessionPersistence.flush()
        if (handle.agent.status !== 'running') throw Error('running fixture converged before its refusal check')
      } else if (action === 'release-running') {
        releaseHeld?.()
        const handle = handles.get('running')
        if (handle) { await handle.agent.whenIdle(); await handle.dispose(); handles.delete('running') }
      } else if (action !== 'status') throw Error('unknown fixture action')
      send(res, 200, { ok: true, ...snapshot() })
    } catch (error) { send(res, 500, { ok: false, error: String(error.message || error) }) }
  } }), 'acceptance fixture: bounded own-agent controls')
  await writeFile(config.statePath, JSON.stringify(snapshot(), null, 2) + '\n')
}

export function buildAcceptanceFixtureSource(config) {
  if (!config?.workspace || !config?.statePath || !config?.nonce || !config?.sessions) throw Error('isolated fixture configuration is required')
  const generated = { ...config, statusPath: config.statusPath ?? config.statePath + '.status.json' }
  return "import { writeFile, rename } from 'node:fs/promises'\n"
    + "export const name = 'dsh-chat-manager-acceptance-fixture'\n"
    + "export const inject = ['agents', 'agentLoop', 'sessions', 'llm', 'sessionPersistence', 'workspaceRegistry', 'sessionTitle', 'webServer']\n"
    + 'export async function apply(ctx) {\nconst config = ' + JSON.stringify(generated) + '\n'
    + 'const redact = ' + sanitizeAcceptanceDiagnostic.toString() + '\n'
    + "const status = async value => { await writeFile(config.statusPath + '.tmp', JSON.stringify(value) + '\\n'); await rename(config.statusPath + '.tmp', config.statusPath) }\n"
    + "await status({ phase: 'applying' })\ntry {\n"
    + 'await (' + installOwnedAcceptanceFixture.toString() + ')(ctx, config)\n'
    + "await status({ phase: 'ready' })\n} catch (error) {\n"
    + "await status({ phase: 'failed', error: redact(error.stack || error, [config.nonce]).slice(-4096) }); throw error\n}\n}\n"
}

async function removeIsolatedOnboarding(page) {
  const next = page.getByRole('button', { name: /^(Continue|继续)$/ }).first()
  if (await next.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) await next.click()
  for (let step = 0; step < 4; step++) {
    const dismiss = page.locator('[role="dialog"]:visible').last().getByRole('button', { name: /^(Configure later|稍后配置|Set up later|Close|关闭|Skip|跳过)$/ }).first()
    if (!(await dismiss.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false))) break
    await dismiss.click()
  }
}

export async function runOfficialAcceptance(options) {
  if (options.dshVersion !== FIXED_DSH_VERSION) throw Error('only fixed Alpha2 is admitted by this candidate runner')
  const packagePath = resolve(options.packagePath)
  await access(packagePath)
  const dshCommand = await resolveOfficialAcceptanceCommand()
  const evidenceRoot = process.env.DSH_ACCEPTANCE_EVIDENCE_ROOT
  if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true })
  const base = await mkdtemp(join(evidenceRoot || tmpdir(), 'dsh-session-delete-official-'))
  const dshHome = join(base, 'home'), workspace = join(base, 'workspace'), fixtureRoot = join(base, 'fixture-plugin')
  const env = { ...process.env, DSH_HOME: dshHome, DSH_AGENTS_HOME: join(base, 'agents'), DSH_TELEMETRY_MODE: 'DISABLED' }
  const config = { workspace, statePath: join(base, 'fixture-state.json'), statusPath: join(base, 'fixture-status.json'), sessionRoot: join(dshHome, 'sessions'), nonce: randomUUID(), provider: 'chat-manager-acceptance-' + randomUUID(), sessions: {} }
  for (const key of ['cold', 'neighbor', 'idle', 'running']) config.sessions[key] = {
    id: 'chat-v2-' + key + '-' + randomUUID(), title: 'Chat v2 ' + key + ' ' + randomUUID(), prompt: 'Archived content probe ' + key + ' ' + randomUUID(),
  }
  let server, stdout = '', stderr = '', installOutput = '', passed = false
  try {
    await mkdir(workspace, { recursive: true }); await mkdir(fixtureRoot)
    await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'dsh-chat-manager-acceptance-fixture', version: '0.0.0', private: true, type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2))
    await writeFile(join(fixtureRoot, 'cordis.patch.yml'), '- insert:\n    - id: chat-manager-acceptance-fixture\n      name: dsh-chat-manager-acceptance-fixture\n')
    await writeFile(join(fixtureRoot, 'index.mjs'), buildAcceptanceFixtureSource(config))
    for (const [index, selected] of [packagePath, fixtureRoot].entries()) {
      try {
        const installed = await run(process.execPath, ['--', ...dshCommand, 'plugin', '--profile', 'web', 'add', selected], { cwd: workspace, env, capture: true, secrets: [config.nonce] })
        installOutput += '[install ' + index + ']\n' + installed.stdout + '\n' + installed.stderr + '\n'
        if (/installed as a plain dependency, not a profile layer/.test(installed.stdout + installed.stderr)) throw Error('acceptance package was not enabled as a profile bundle')
      } catch (error) { installOutput += String(error.stack || error) + '\n'; throw error }
    }
    server = spawn(process.execPath, ['--', ...dshCommand, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(options.port)], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, shell: false })
    server.stdout?.on('data', chunk => { stdout += chunk }); server.stderr?.on('data', chunk => { stderr += chunk })
    const url = await waitForServer(() => {
      const match = /dsh web:\s+(https?:\/\/[^\s]+)/u.exec(stdout)
      if (!match) return null
      const candidate = new URL(match[1])
      if (candidate.protocol !== 'http:' || candidate.hostname !== '127.0.0.1' || Number(candidate.port) !== options.port || candidate.pathname !== '/' || (candidate.search && !/^\?token=[A-Za-z0-9_-]+$/u.test(candidate.search))) throw Error('invalid isolated server URL')
      return candidate.href
    }, server).catch(error => { throw Error(sanitizeAcceptanceDiagnostic(error.message + '\n' + (stderr || stdout), [config.nonce]).slice(-8192)) })
    const fixtureState = await waitForAcceptanceFixture(config, { child: server })
    const browser = await chromium.launch({ headless: true, channel: process.env.DSH_TEST_BROWSER_CHANNEL || undefined })
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: process.env.DSH_ACCEPTANCE_COLOR_SCHEME || 'dark', ...(process.env.DSH_ACCEPTANCE_LOCALE ? { locale: process.env.DSH_ACCEPTANCE_LOCALE } : {}) })
      const errors = []; page.on('pageerror', error => errors.push(error.message))
      await page.goto(url, { waitUntil: 'domcontentloaded' }); await removeIsolatedOnboarding(page)
      const control = async action => {
        const response = await page.evaluate(async ({ action, nonce }) => {
          const res = await fetch('/plugins/dsh-chat-manager-acceptance-fixture/control', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-acceptance-fixture': nonce }, body: JSON.stringify({ action }) })
          return { status: res.status, body: await res.json() }
        }, { action, nonce: config.nonce })
        if (response.status !== 200 || response.body?.ok !== true) throw Error('fixture control ' + action + ' failed: ' + JSON.stringify(response))
        return response.body
      }
      let result
      try { result = await acceptModernOfficial(page, fixtureState.fixtures, base, control) }
      catch (error) {
        await page.screenshot({ path: join(base, 'modern-failure.png'), fullPage: true })
        await writeFile(join(base, 'modern-failure.txt'), await page.locator('body').innerText())
        throw error
      } finally { await control('release-running').catch(() => {}) }
      if (errors.length) throw Error('Browser runtime exceptions: ' + JSON.stringify(errors))
      await writeFile(join(base, 'acceptance.json'), JSON.stringify({ ...result, dshVersion: FIXED_DSH_VERSION }, null, 2) + '\n')
    } finally { await browser.close() }
    passed = true
    return { ok: true, dshVersion: FIXED_DSH_VERSION, checks: ['isolated fixture-only profile', 'public archive settings', 'native archive and public unarchive clicks', 'archive content search', 'confirmation cancel sends no request', 'loaded idle/running genuinely refused', 'cold archived positive UI deletion', 'neighbor bytes preserved', 'plugin hot toggles preserve official composer', 'no page reload', 'no runtime exceptions'] }
  } finally {
    if (server) await stopProcess(server)
    await writeFile(join(base, 'web.log'), sanitizeAcceptanceDiagnostic(installOutput + stdout + '\n' + stderr, [config.nonce]).slice(-32768))
    if (passed && !evidenceRoot) await rm(base, { recursive: true, force: true })
    else process.stderr.write('Acceptance evidence retained: ' + base + '\n')
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runOfficialAcceptance(parseOfficialAcceptanceArgs(process.argv.slice(2))).then(
    result => process.stdout.write(JSON.stringify(result) + '\n'),
    error => { process.stderr.write(sanitizeAcceptanceDiagnostic(error.stack || error).slice(-8192) + '\n'); process.exitCode = 1 },
  )
}
