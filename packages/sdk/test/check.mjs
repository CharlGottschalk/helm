// Self-check for the SDK's validators, kit injection and helm-sdk CLI. Run: npm run check -w @usetdt/helm-sdk (after build).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KIT_CSS, allowed, isWrite, matchesGlob, parseThemeTokens, themeContrast, tokensCss, validateManifest, validatePluginPackage, validateTheme } from '../dist/index.js'

const ex = new URL('../examples/helm-plugin-example/', import.meta.url)
const json = (p) => JSON.parse(readFileSync(new URL(p, ex), 'utf8'))
assert.deepEqual(validatePluginPackage(json('package.json')), [])
assert.deepEqual(validateManifest(json('widgets/workspace-status/manifest.json'), 'widget'), [])
// files connections: valid declaration, bad root/paths/operations, glob matching
const withConn = (c) => ({ ...json('widgets/workspace-status/manifest.json'), connections: [c] })
assert.deepEqual(validateManifest(withConn({ id: 'sp', kind: 'files', root: 'project', paths: ['.tdt-project/tdt-software-production/**'], operations: ['list', 'read'] }), 'widget'), [])
assert.deepEqual(validateManifest({ ...withConn({ id: 't', kind: 'tdt-mcp', operations: [] }), capabilities: ['orchestrate'] }, 'widget'), [])
assert.equal(validateManifest({ ...withConn({ id: 't', kind: 'tdt-mcp', operations: [] }), capabilities: ['terminal'] }, 'widget').length, 1)
assert.equal(validateManifest(withConn({ id: 'sp', kind: 'files', root: 'home', paths: ['../x', '/etc/*'], operations: ['write'] }), 'widget').length, 3)
// db connections: valid declaration; bad service/engine/query/params; a write query without permissions.write refused at review
const dbConn = { id: 'db', kind: 'db', service: 'local-app', engine: 'postgres', queries: { recent: { sql: 'select id from t where s = $1 limit $2', params: ['status', 'limit'] } } }
assert.deepEqual(validateManifest(withConn(dbConn), 'widget'), [])
assert.equal(validateManifest(withConn({ ...dbConn, service: 'Bad Name', engine: 'oracle', queries: {} }), 'widget').length, 3)
assert.equal(validateManifest(withConn({ ...dbConn, queries: { 'bad-name': { sql: 'x' }, q: { sql: '' }, p: { sql: 'x', params: ['a b'] }, w: { sql: 'x', write: true } } }), 'widget').length, 4)
assert.ok(allowed([dbConn], 'db', 'recent') && !allowed([dbConn], 'db', 'toString'))
// write queries: allowed with permissions.write; `write` must be a boolean; still refused without the permission
const writeConn = { ...dbConn, queries: { ...dbConn.queries, close: { sql: 'update t set s = $1 where id = $2', params: ['status', 'id'], write: true } } }
assert.deepEqual(validateManifest({ ...withConn(writeConn), permissions: { write: true } }, 'widget'), [])
assert.match(validateManifest({ ...withConn(writeConn), permissions: { write: false } }, 'widget').join(), /needs "permissions": \{ "write": true \}/)
assert.equal(validateManifest({ ...withConn({ ...dbConn, queries: { w: { sql: 'x', write: 'yes' } } }), permissions: { write: true } }, 'widget').length, 1)
// http connections: read-only GET, or POST with a declared body; bad method/path/body refused at review
const httpConn = { id: 'gh', kind: 'http', service: 'github', calls: { issues: { method: 'GET', path: '/repos/{owner}/{repo}/issues', query: { per_page: '{limit}' } }, gql: { method: 'POST', path: '/graphql', body: { query: '{ viewer { login } }', variables: { n: '{n}' } } } } }
assert.deepEqual(validateManifest(withConn(httpConn), 'widget'), [])
assert.equal(validateManifest(withConn({ ...httpConn, service: 'Bad', calls: { a: { method: 'DELETE', path: '/x' }, b: { method: 'POST', path: '/x' }, c: { method: 'GET', path: '//evil/x' }, d: { method: 'GET', path: '/a/../b' }, e: { method: 'GET', path: '/x', body: {} }, f: { method: 'GET', path: '/x', map: 'y' }, g: { method: 'GET', path: '/{x' } } }), 'widget').length, 8)
assert.ok(allowed([httpConn], 'gh', 'issues') && !allowed([httpConn], 'gh', 'hasOwnProperty'))
// mcp connections: a server name and at least one tool
assert.deepEqual(validateManifest(withConn({ id: 'm', kind: 'mcp', server: 'github', operations: ['list_issues'] }), 'widget'), [])
assert.equal(validateManifest(withConn({ id: 'm', kind: 'mcp', server: 'Git Hub', operations: ['x'] }), 'widget').length, 1)
assert.equal(validateManifest(withConn({ id: 'm', kind: 'mcp', server: 'github', operations: [] }), 'widget').length, 1)
// task 027 writes: http write calls, mcp write tools and files write all need permissions.write
const W = { permissions: { write: true } }
const httpWrite = { ...httpConn, calls: { ...httpConn.calls, close: { method: 'PATCH', path: '/repos/{owner}/{repo}/issues/{n}', body: { state: 'closed' }, write: true }, drop: { method: 'DELETE', path: '/x/{id}', write: true } } }
assert.deepEqual(validateManifest({ ...withConn(httpWrite), ...W }, 'widget'), [])
assert.match(validateManifest(withConn(httpWrite), 'widget').join(), /needs "permissions": \{ "write": true \}/)
assert.equal(validateManifest({ ...withConn({ ...httpConn, calls: { a: { method: 'GET', path: '/x', write: true }, b: { method: 'PUT', path: '/x', write: 'yes' } } }), ...W }, 'widget').length, 2)
assert.ok(isWrite([httpWrite], 'gh', 'close') && !isWrite([httpWrite], 'gh', 'issues'))
const mcpWrite = { id: 'm', kind: 'mcp', server: 'github', operations: ['list_issues'], writes: ['create_issue'] }
assert.deepEqual(validateManifest({ ...withConn(mcpWrite), ...W }, 'widget'), [])
assert.equal(validateManifest(withConn(mcpWrite), 'widget').length, 1)
assert.equal(validateManifest({ ...withConn({ ...mcpWrite, writes: ['list_issues'] }), ...W }, 'widget').length, 1)
assert.ok(allowed([mcpWrite], 'm', 'create_issue') && isWrite([mcpWrite], 'm', 'create_issue') && !isWrite([mcpWrite], 'm', 'list_issues'))
const filesWrite = { id: 'sp', kind: 'files', root: 'project', paths: ['tasks/*.md'], operations: ['read', 'write'] }
assert.deepEqual(validateManifest({ ...withConn(filesWrite), ...W }, 'widget'), [])
assert.equal(validateManifest(withConn(filesWrite), 'widget').length, 1)
assert.ok(isWrite([filesWrite], 'sp', 'write') && !isWrite([filesWrite], 'sp', 'read') && !isWrite([{ ...filesWrite, operations: ['read'] }], 'sp', 'write'))
assert.ok(matchesGlob('a/**/*.md', 'a/b/c.md') && matchesGlob('a/**/*.md', 'a/c.md') && !matchesGlob('a/*.md', 'a/b/c.md') && !matchesGlob('a/*.md', 'b/c.md'))
assert.equal(validatePluginPackage({ name: 'x', version: '1', helm: { contract: 2, widgets: ['../evil', 'a', 'a'], tools: 'x' } }).length, 5)
assert.deepEqual(validatePluginPackage({ name: 'x', version: '1.0.0', helm: { contract: 1 } }), ['"helm" must list at least one widget, tool or theme directory'])
assert.deepEqual(validatePluginPackage({ name: 'x', version: '1.0.0', helm: { contract: 1, themes: ['themes/a'] } }), [])
// theme plugins: plain token values only; contrast below AA warns, does not fail
assert.deepEqual(parseThemeTokens('/* c */ --rgb-accent: 1 2 3; --c-text-0: #fff; --font-body: \'Inter\', system-ui; --glow-cyan: 0 0 0 1px rgb(1 2 3 / 0.2), 0 0 8px #000; --radius: 4px; --skew: -10deg').problems, [])
for (const bad of ['--nope: 1', '--c-text-0: url(x)', '--c-text-0: var(--c-red)', '--c-text-0: red', '--rgb-accent: 1 2 300', 'body { --c-text-0: #fff }', '@import "x"', 'color: #fff', '--radius: 4px !important', '--c-text-0: #fff; --c-text-0: #000', '--font-body: "a" ; --blur-panel: blur(1px) brightness(2)'])
  assert.ok(parseThemeTokens(bad).problems.length, bad)
assert.deepEqual(themeContrast({}), [], 'HUD defaults meet AA')
assert.equal(themeContrast({ '--c-text-3': '#333' }).length, 1)
assert.equal(themeContrast({ '--c-on-accent': '#5eeaff' }).length, 1)
const themeOk = { contract: 'helm.theme/1', id: 'ember', name: 'Ember', tagline: 'Warm.', tokens: 'tokens.css', chrome: 'chrome.css' }
const files = { 'tokens.css': '--c-text-3: #444;', 'chrome.css': '--c-text-0: #fff;' }
const tc = validateTheme(themeOk, (f) => files[f])
assert.deepEqual(tc.problems, [])
assert.equal(tc.warnings.length, 2, 'main and chrome both warn on text-3')
assert.deepEqual(tc.chrome, { '--c-text-0': '#fff' })
assert.equal(validateTheme({ ...themeOk, id: 'X', tokens: '../x.css', chrome: 'gone.css', extra: 1 }, () => undefined).problems.length, 4)
assert.ok(tokensCss({}).endsWith(KIT_CSS))

// CLI: create → build → validate for both kinds, then one broken copy per rule.
const cli = fileURLToPath(new URL('../bin/helm-sdk.js', import.meta.url))
const sdk = (...args) => {
  try {
    return { ok: true, out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (e) {
    return { ok: false, out: `${e.stdout}${e.stderr}` }
  }
}
const tmp = mkdtempSync(join(tmpdir(), 'helm-sdk-'))
try {
  assert.ok(sdk('validate', fileURLToPath(ex)).ok, 'the example plugin validates')
  const themeDir = join(tmp, 'demo-theme')
  assert.ok(sdk('create', 'theme', themeDir).ok)
  assert.ok(sdk('validate', themeDir).ok, 'scaffolded theme validates')
  assert.deepEqual(JSON.parse(readFileSync(join(themeDir, 'package.json'), 'utf8')).files, ['themes'], 'a theme packs its themes/ folder')
  writeFileSync(join(themeDir, 'themes/demo-theme/tokens.css'), '--c-text-3: #222;')
  const low = sdk('validate', themeDir)
  assert.ok(low.ok && /below WCAG AA/.test(low.out), 'contrast warns only')
  writeFileSync(join(themeDir, 'themes/demo-theme/tokens.css'), '--c-text-0: url(x); --made-up: 1;')
  const badTheme = sdk('validate', themeDir)
  assert.ok(!badTheme.ok && /url\(\)/.test(badTheme.out) && /--made-up is not a theme token/.test(badTheme.out), badTheme.out)
  for (const kind of ['widget', 'tool']) {
    const dir = join(tmp, `demo-${kind}`)
    assert.ok(sdk('create', kind, dir).ok)
    assert.match(sdk('validate', dir).out, /not built yet; run helm-sdk build/)
    const r = sdk('build', dir)
    assert.ok(r.ok, r.out)
    const html = readFileSync(join(dir, `dist/demo-${kind}/index.html`), 'utf8')
    assert.ok(!/src=|href=/.test(html) && html.includes('<script type="module">'), 'built entry is self-contained')
    assert.ok(!html.includes(tmp), 'no build paths in the bundle')
  }
  // --react: JSX source bundles React in; plain bundles above never contain it
  const REACT = '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'
  assert.ok(!readFileSync(join(tmp, 'demo-widget/dist/demo-widget/index.html'), 'utf8').includes(REACT), 'plain plugins do not ship React')
  for (const kind of ['widget', 'tool']) {
    const dir = join(tmp, `react-${kind}`)
    assert.ok(sdk('create', kind, dir, '--react').ok)
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).devDependencies.react, '^18.3.1')
    const r = sdk('build', dir)
    assert.ok(r.ok, r.out)
    const html = readFileSync(join(dir, `dist/react-${kind}/index.html`), 'utf8')
    assert.ok(!/<script\b[^>]*\bsrc=|<link\b/i.test(html) && html.includes(REACT) && !html.includes('process.env'), 'React bundle is self-contained')
  }
  assert.match(sdk('create', 'widget', join(tmp, 'Bad_Id')).out, /must match/)
  assert.match(sdk('create', 'widget', join(tmp, 'demo-widget')).out, /not empty/)

  const good = join(tmp, 'demo-widget')
  const b = 'dist/demo-widget'
  const edit = (p, file, fn) => {
    const j = JSON.parse(readFileSync(join(p, file), 'utf8'))
    fn(j)
    writeFileSync(join(p, file), JSON.stringify(j))
  }
  const html = (p, fn) => writeFileSync(join(p, b, 'index.html'), fn(readFileSync(join(p, b, 'index.html'), 'utf8')))
  const cases = {
    'helm.contract': [(p) => edit(p, 'package.json', (j) => (j.helm.contract = 2)), /"helm\.contract" must be 1/],
    'folder id': [(p) => edit(p, `${b}/manifest.json`, (j) => (j.id = 'other-id')), /"id" must match its folder name "demo-widget"/],
    size: [(p) => edit(p, `${b}/manifest.json`, (j) => (j.size = { w: 9, h: 3 })), /"size" needs w 1–6/],
    'settings limit': [(p) => edit(p, `${b}/manifest.json`, (j) => (j.settings = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, type: 'text', label: `S${i}` })))), /At most 24 settings/],
    'secret-like setting': [(p) => edit(p, `${b}/manifest.json`, (j) => j.settings.push({ id: 'apiToken', type: 'text', label: 'API token' })), /looks like a secret/],
    'undeclared call': [(p) => html(p, (h) => h.replace('</body>', '<script>helm.call("tdt","tdt_brain_write",{})</script></body>')), /calls tdt\.tdt_brain_write, which the manifest does not declare/],
    'script file': [(p) => html(p, (h) => h.replace('</body>', '<script src="extra.js"></script></body>')), /loads a script file/],
    'remote image': [(p) => html(p, (h) => h.replace('</body>', '<img src="https://example.com/x.png" alt=""></body>')), /references a file or URL/],
    'css url': [(p) => html(p, (h) => h.replace('</head>', '<style>body{background:url(bg.png)}</style></head>')), /CSS loads a file or URL/],
    'hard-coded colour': [(p) => html(p, (h) => h.replace('</head>', '<style>p{color:#ff0000}</style></head>')), /uses the colour #ff0000/],
    'hard-coded font': [(p) => html(p, (h) => h.replace('</head>', '<style>p{font-family:Arial}</style></head>')), /sets font-family Arial/],
    'missing entry': [(p) => rmSync(join(p, b, 'index.html')), /index\.html is missing/],
  }
  for (const [name, [breakIt, message]] of Object.entries(cases)) {
    const copy = join(tmp, 'bad', name.replace(/\W+/g, '-'))
    cpSync(good, copy, { recursive: true })
    breakIt(copy)
    const r = sdk('validate', copy)
    assert.equal(r.ok, false, `${name}: validate should fail`)
    assert.match(r.out, message, `${name}: ${r.out}`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
console.log('sdk checks ok')
