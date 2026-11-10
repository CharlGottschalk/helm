// Plugin host self-check against the built server (run `npm run build:server` first):
//   npm run check:plugins -w helm-command-deck
// Uses a throwaway HELM_HOME and workspace; needs npm on PATH, no network.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-plugins-')))
process.env.HELM_HOME = join(tmp, 'home')
const marker = (process.env.HELM_FIXTURE_MARKER = join(tmp, 'scripts-ran'))
const wsPath = join(tmp, 'ws')
mkdirSync(wsPath)
const ws = { id: 'w', name: 'w', path: wsPath, profile: 'read-only' }

const p = await import('../dist/plugins.js')
const x = await import('../dist/extensions.js')
const keys = () => x.listExtensions(ws).extensions.map((e) => e.key)
const errors = () => x.listExtensions(ws).errors.map((e) => e.message).join('\n')
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status)

try {
  // 1. A registry-style install (packed tarball): no install script runs, nothing is approved.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', tmp, join(here, 'fixtures/scripted')], { stdio: 'ignore', shell: process.platform === 'win32' })
  const scripted = await p.addPlugin(join(tmp, 'helm-fixture-scripted-1.0.0.tgz'))
  assert.equal(scripted.name, 'helm-fixture-scripted')
  assert.equal(existsSync(marker), false, 'an install script ran')
  assert.equal(scripted.approved, false)
  assert.deepEqual(keys(), [], 'nothing reaches a workspace before approval and enabling')

  // 2. Approval binds to the reviewed declarations; enabling is per workspace.
  rejects(() => p.setPluginEnabled('w', scripted.name, true), 409)
  rejects(() => p.approvePlugin(scripted.name, 'stale'), 409)
  p.approvePlugin(scripted.name, scripted.digest)
  assert.deepEqual(keys(), [], 'approved but not enabled')
  p.setPluginEnabled('w', scripted.name, true)
  assert.deepEqual(keys(), ['plugin.helm-fixture-scripted.scripted'])
  assert.deepEqual(p.activePlugins('other'), [], 'enabled only in its workspace')
  const { url } = x.createFrame(ws, { key: 'plugin.helm-fixture-scripted.scripted', instance: 'i', css: '' })
  assert.match(x.takeFrame(url.slice(7)).html, /window\.helm = Object\.freeze/)

  // 3. A changed declaration needs a new approval; until then it is an error, not a card.
  const installed = join(process.env.HELM_HOME, 'plugins/node_modules/helm-fixture-scripted/widgets/scripted/manifest.json')
  const m = JSON.parse(readFileSync(installed, 'utf8'))
  m.connections[0].operations.push('tdt_brain_search')
  writeFileSync(installed, JSON.stringify(m))
  assert.deepEqual(keys(), [])
  assert.match(errors(), /review it again/)

  // 4. An unsupported contract says so and can't be approved.
  const future = await p.addPlugin(join(here, 'fixtures/future'))
  assert.equal(future.linked, true)
  assert.equal(future.supported, false)
  assert.match(future.problems.join(), /needs a newer Helm/)
  rejects(() => p.approvePlugin(future.name, future.digest), 400)

  // 4b. Theme plugins: no workspace enable, never an extension, listed only while approved and valid.
  const themeSrc = join(tmp, 'helm-theme-example')
  cpSync(join(here, '../../../../packages/sdk/examples/helm-theme-example'), themeSrc, { recursive: true })
  const theme = await p.addPlugin(themeSrc)
  assert.deepEqual(theme.problems, [])
  assert.equal(theme.bundles[0].kind, 'theme')
  assert.deepEqual(p.listThemes(), [], 'not listed before approval')
  p.approvePlugin(theme.name, theme.digest)
  const [ember] = p.listThemes()
  assert.equal(ember.key, 'helm-theme-example/ember')
  assert.equal(ember.tokens['--rgb-accent'], '255 170 80')
  assert.equal(ember.chrome['--rgb-chrome'], '14 9 5')
  assert.deepEqual(ember.warnings, [])
  assert.ok(!keys().some((k) => k.includes('helm-theme-example')), 'a theme is not a widget or tool')
  const tokensFile = join(themeSrc, 'themes/ember/tokens.css')
  const good = readFileSync(tokensFile, 'utf8')
  writeFileSync(tokensFile, good.replace('--c-text-3: #ad9780;', '--c-text-3: #3a2a1c;'))
  assert.deepEqual(p.listThemes(), [], 'changed tokens need a new approval')
  const low = p.getPlugin(theme.name)
  assert.match(low.bundles[0].theme.warnings.join(), /--c-text-3 on --c-surface .* below WCAG AA/)
  p.approvePlugin(theme.name, low.digest)
  assert.equal(p.listThemes()[0].warnings.length, 2, 'below AA is still offered, with its warnings (main and rails)')
  writeFileSync(tokensFile, good + '\n--c-text-0: url(https://example.com/x);\nbody { color: red }')
  assert.match(p.getPlugin(theme.name).bundles[0].error, /plain value.*not a --token: value declaration|not a --token: value declaration/s)
  assert.deepEqual(p.listThemes(), [], 'an invalid theme is refused')
  await p.removePlugin(theme.name)
  assert.deepEqual(p.listThemes(), [])

  // 5. Bad input never reaches npm; removal clears approvals and enablement.
  await assert.rejects(p.addPlugin('--registry=http://evil'), (e) => e.status === 400)
  await assert.rejects(p.addPlugin('x; rm -rf /'), (e) => e.status === 400)
  await p.removePlugin(scripted.name)
  await p.removePlugin(future.name)
  assert.deepEqual(p.listPlugins(), [])
  assert.deepEqual(JSON.parse(readFileSync(join(process.env.HELM_HOME, 'plugins/state.json'), 'utf8')), { approved: {}, enabled: { w: [] } })
  console.log('plugin checks ok')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
