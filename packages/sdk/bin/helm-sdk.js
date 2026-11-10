#!/usr/bin/env node
// helm-sdk create | validate | build | dev (docs/plugin.md#the-helm-sdk-cli). Source bundles live in
// src/<id>/ and build to dist/<id>/, which is what the "helm" field lists and Helm loads.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowed, validateManifest, validatePluginPackage, validateTheme } from '../dist/index.js'

const SDK = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_ENTRY = 1024 * 1024
const ID = /^[a-z][a-z0-9-]{1,63}$/
const DIR = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/
const ENTRY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.html$/
const usage = `Usage:
  helm-sdk create widget|tool|theme <dir> [--react]
                                      scaffold a plugin package (the folder name is the id);
                                      --react uses @usetdt/helm-sdk/react (docs/react.md);
                                      a theme is a token file, no build (docs/theme.md)
  helm-sdk validate [dir]             check package.json, manifests and bundles
  helm-sdk build [dir]                bundle src/<id>/ into self-contained dist/<id>/, then validate
  helm-sdk dev [dir]                  build, validate and rebuild on every change in src/`

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const safe = (dir) => typeof dir === 'string' && DIR.test(dir) && !dir.split('/').some((s) => s === '..' || s === '.')

/** The bundle directories a package.json declares, skipping unsafe entries (validate reports those). */
function bundles(pkg) {
  const out = []
  for (const [field, kind] of [['widgets', 'widget'], ['tools', 'tool']])
    for (const dir of Array.isArray(pkg?.helm?.[field]) ? pkg.helm[field] : []) if (safe(dir)) out.push({ kind, dir })
  return out
}
const sourceOf = (root, dir) => (dir.startsWith('dist/') ? join(root, 'src', dir.slice(5)) : null)

/* ── create ── */
function create(kind, dir, react) {
  if (!['widget', 'tool', 'theme'].includes(kind) || !dir || (react && kind === 'theme')) throw new Error(usage)
  const root = resolve(dir)
  const id = basename(root)
  if (!ID.test(id)) throw new Error(`The folder name "${id}" is the plugin id, so it must match ${ID} (lowercase letters, digits and dashes)`)
  if (existsSync(root) && readdirSync(root).length) throw new Error(`${root} already exists and is not empty`)
  const name = id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
  const theme = kind === 'theme'
  const src = join(root, theme ? 'themes' : 'src', id)
  mkdirSync(src, { recursive: true })
  const fill = (from, to, edit = (t) => t) => writeFileSync(join(src, to), edit(readFileSync(from, 'utf8')).replaceAll('__ID__', id).replaceAll('__NAME__', name))
  for (const f of readdirSync(join(SDK, 'templates', kind)))
    if (!(react && f === 'main.js')) fill(join(SDK, 'templates', kind, f), f, react && f === 'index.html' ? (t) => t.replace('src="main.js"', 'src="main.jsx"') : undefined)
  if (react) fill(join(SDK, 'templates', 'react', `${kind}.jsx`), 'main.jsx')
  const pkg = {
    name: id,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `${name}: a Helm ${kind}`,
    keywords: ['helm-plugin'],
    files: [theme ? 'themes' : 'dist'],
    helm: { contract: 1, [`${kind}s`]: [theme ? `themes/${id}` : `dist/${id}`] },
    scripts: theme ? { validate: 'helm-sdk validate' } : { build: 'helm-sdk build', validate: 'helm-sdk validate', dev: 'helm-sdk dev' },
    // React is bundled into dist/ at build time, so it is a dev dependency like the SDK
    devDependencies: { '@usetdt/helm-sdk': `^${readJson(join(SDK, 'package.json')).version}`, ...(react && { react: '^18.3.1', 'react-dom': '^18.3.1' }) },
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  // dist/ stays tracked: Helm installs with --ignore-scripts, so a plugin ships built
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
  if (theme)
    return console.log(`Created theme plugin ${id} in ${root}
  edit themes/${id}/manifest.json and tokens.css (tokens: node_modules/@usetdt/helm-sdk/docs/theme.md)
  helm-sdk validate ${dir}     check the tokens and their contrast
  helm plugin link ${dir}      install it in Helm, then review and approve it in Settings → Plugins`)
  console.log(`Created ${kind} plugin ${id} in ${root}
  edit src/${id}/manifest.json, index.html and main.${react ? 'jsx' : 'js'} (docs: node_modules/@usetdt/helm-sdk/docs/)
  helm-sdk build ${dir}        bundle to dist/${id}/ and validate
  helm plugin link ${dir}      install it in Helm, then review and enable it in Settings → Plugins`)
}

/* ── validate ── */
/** Problems in an entry document that the frame CSP or the contracts would refuse. */
function lintEntry(html, manifest) {
  const p = []
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) p.push('loads a script file; Helm frames run only inline scripts (run helm-sdk build)')
  if (/<link\b[^>]*\bhref\s*=/i.test(html)) p.push('links a file; inline stylesheets (helm-sdk build does) and assets as data: URLs')
  if (/<(img|iframe|source|video|audio|embed|object)\b[^>]*\b(src|data)\s*=\s*["']?(?!data:)/i.test(html)) p.push('references a file or URL; Helm frames load only data: URLs')
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), ...html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join('\n')
  if (/@import\b|url\(\s*["']?(?!data:|#)/i.test(css)) p.push('CSS loads a file or URL; Helm frames load only data: URLs')
  const color = css.match(/:[^;{}]*?(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\()/)
  if (color) p.push(`CSS uses the colour ${color[1].replace(/\($/, '()')}; use theme tokens such as var(--c-text-0) (docs/theme.md)`)
  const font = css.match(/font-family\s*:(?!\s*var\()\s*([^;}"]+)/i)
  if (font) p.push(`CSS sets font-family ${font[1].trim()}; use var(--font-body), var(--font-display) or var(--font-mono)`)
  const conns = Array.isArray(manifest.connections) ? manifest.connections : []
  for (const m of html.matchAll(/\bcall\(\s*(['"`])([^'"`]+)\1\s*,\s*(['"`])([^'"`]+)\3/g))
    if (!allowed(conns, m[2], m[4])) p.push(`calls ${m[2]}.${m[4]}, which the manifest does not declare under "connections"`)
  return [...new Set(p)]
}

/** Every problem with the plugin at root; empty means Helm can load it. Contrast warnings go to `warnings`. */
function validatePlugin(root, warnings = []) {
  let pkg
  try {
    pkg = readJson(join(root, 'package.json'))
  } catch (e) {
    return [`package.json: ${e.code === 'ENOENT' ? 'missing (is this a plugin folder?)' : e.message}`]
  }
  const p = validatePluginPackage(pkg).map((x) => `package.json: ${x}`)
  for (const { kind, dir } of bundles(pkg)) {
    const at = (x) => p.push(`${dir}: ${x}`)
    const base = join(root, dir)
    const src = sourceOf(root, dir)
    if (!existsSync(base)) {
      at(src && existsSync(src) ? 'not built yet; run helm-sdk build' : 'folder is missing')
      continue
    }
    let m
    try {
      m = readJson(join(base, 'manifest.json'))
    } catch (e) {
      at(e.code === 'ENOENT' ? 'manifest.json is missing' : `manifest.json is not valid JSON (${e.message})`)
      continue
    }
    validateManifest(m, kind).forEach((x) => at(`manifest.json: ${x}`))
    if (m?.id !== basename(dir)) at(`manifest.json: "id" must match its folder name "${basename(dir)}"`)
    if (typeof m?.entry !== 'string' || !ENTRY.test(m.entry) || m.entry.split('/').includes('..')) continue
    const file = join(base, m.entry)
    if (!existsSync(file)) at(`${m.entry} is missing`)
    else if (statSync(file).size > MAX_ENTRY) at(`${m.entry} is larger than ${MAX_ENTRY / 1024} KiB`)
    else lintEntry(readFileSync(file, 'utf8'), m).forEach((x) => at(`${m.entry} ${x}`))
  }
  for (const dir of Array.isArray(pkg?.helm?.themes) ? pkg.helm.themes.filter(safe) : []) {
    const base = join(root, dir)
    let m
    try {
      m = readJson(join(base, 'manifest.json'))
    } catch (e) {
      p.push(`${dir}: ${e.code === 'ENOENT' ? 'manifest.json is missing' : `manifest.json is not valid JSON (${e.message})`}`)
      continue
    }
    const r = validateTheme(m, (f) => {
      const path = resolve(base, f)
      return path.startsWith(base + sep) && existsSync(path) ? readFileSync(path, 'utf8') : undefined
    })
    r.problems.forEach((x) => p.push(`${dir}: ${x}`))
    if (m?.id !== basename(dir)) p.push(`${dir}: manifest.json: "id" must match its folder name "${basename(dir)}"`)
    r.warnings.forEach((x) => warnings.push(`${dir}: ${x}`))
  }
  return p
}

/* ── build ── */
const sdkAliases = { '@usetdt/helm-sdk/frame': join(SDK, 'dist', 'frame.js'), '@usetdt/helm-sdk/react': join(SDK, 'dist', 'react.js'), '@usetdt/helm-sdk': join(SDK, 'dist', 'index.js') }
/** SDK entries, plus one react/react-dom (the plugin's own, else the SDK's), so a linked SDK never bundles a second React. */
function aliases(dir) {
  const own = {}
  for (const name of ['react', 'react-dom'])
    for (const from of [dir, join(SDK, 'dist')])
      try {
        own[name] = dirname(createRequire(join(from, 'x.js')).resolve(`${name}/package.json`))
        break
      } catch {}
  return { ...sdkAliases, ...own }
}

/** Inline local <script src> (bundled with esbuild) and <link rel=stylesheet> into the document. */
async function inline(html, dir) {
  const { build } = await import('esbuild')
  const local = (ref) => {
    if (/^([a-z]+:|\/)/i.test(ref)) return null // remote or absolute: left for validate to report
    const path = resolve(dir, ref)
    if (!path.startsWith(dir + sep)) throw new Error(`${ref} is outside the bundle folder`)
    return path
  }
  let out = ''
  let last = 0
  for (const m of html.matchAll(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>|<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi)) {
    out += html.slice(last, m.index)
    last = m.index + m[0].length
    if (m[2] !== undefined) {
      const path = local(m[2])
      if (!path) {
        out += m[0]
        continue
      }
      const module = /\btype\s*=\s*["']?module/i.test(m[1] + m[3])
      const r = await build({ entryPoints: [path], bundle: true, write: false, format: module ? 'esm' : 'iife', target: 'es2020', minify: true, alias: aliases(dir), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, absWorkingDir: dir, logLevel: 'silent', charset: 'utf8' })
      out += `<script${module ? ' type="module"' : ''}>\n${r.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1')}</script>`
    } else {
      const href = m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
      const path = href && local(href)
      out += path ? `<style>\n${readFileSync(path, 'utf8').replace(/<\/(style)/gi, '<\\/$1')}</style>` : m[0]
    }
  }
  return out + html.slice(last)
}

async function buildPlugin(root) {
  const pkg = readJson(join(root, 'package.json'))
  let built = 0
  for (const { dir } of bundles(pkg)) {
    const src = sourceOf(root, dir)
    if (!src) continue // listed outside dist/: shipped as is
    if (!existsSync(join(src, 'manifest.json'))) throw new Error(`${dir}: no source at src/${dir.slice(5)}/manifest.json`)
    const out = join(root, dir)
    const manifest = readJson(join(src, 'manifest.json'))
    rmSync(out, { recursive: true, force: true })
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    if (typeof manifest.entry === 'string' && ENTRY.test(manifest.entry) && !manifest.entry.split('/').includes('..')) {
      const from = join(src, manifest.entry)
      if (!existsSync(from)) throw new Error(`${dir}: src/${dir.slice(5)}/${manifest.entry} is missing`)
      mkdirSync(dirname(join(out, manifest.entry)), { recursive: true })
      writeFileSync(join(out, manifest.entry), await inline(readFileSync(from, 'utf8'), dirname(from)))
    }
    built++
  }
  return built
}

function report(root, problems, warnings = []) {
  for (const w of warnings) console.log(`  ⚠ ${w} (Helm offers it with a warning)`)
  if (problems.length) {
    console.error(`${problems.length} problem${problems.length > 1 ? 's' : ''} in ${root}:\n${problems.map((x) => `  ✗ ${x}`).join('\n')}`)
    return false
  }
  console.log(`✓ ${root} is a valid Helm plugin`)
  return true
}

/* ── dev ── */
/** Is the plugin at root installed in Helm (linked), and is Helm answering? */
async function helmStatus(root) {
  const home = process.env.HELM_HOME ?? join(homedir(), '.helm')
  let linked = false
  let port = 4317
  try {
    const deps = readJson(join(home, 'plugins', 'package.json')).dependencies ?? {}
    linked = Object.values(deps).some((s) => typeof s === 'string' && s.startsWith('file:') && resolve(home, 'plugins', s.slice(5)) === root)
  } catch {}
  try {
    port = readJson(join(home, 'config.json')).port ?? port
  } catch {}
  const running = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)
  return { linked, running, port }
}

async function dev(root) {
  const once = async () => {
    try {
      await buildPlugin(root)
      const warnings = []
      report(root, validatePlugin(root, warnings), warnings)
    } catch (e) {
      console.error(`✗ ${e.message}`)
    }
  }
  await once()
  const h = await helmStatus(root)
  console.log(h.running ? `Helm is running on http://127.0.0.1:${h.port}/` : `Helm is not answering on port ${h.port}: start it with \`helm\``)
  if (!h.linked) console.log(`Not linked yet: run \`helm plugin link ${root}\`, then review and enable it in Settings → Plugins`)
  console.log('Watching src/ — reload the widget or tool in Helm after a rebuild. Manifest changes need a new approval.')
  let timer
  watch(join(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => (console.log(`\n${new Date().toLocaleTimeString()} rebuilding…`), once()), 100)
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const [command, a, b] = argv.filter((x) => !x.startsWith('--'))
  switch (command) {
    case 'create':
      return create(a, b, argv.includes('--react'))
    case 'validate': {
      const warnings = []
      if (!report(resolve(a ?? '.'), validatePlugin(resolve(a ?? '.'), warnings), warnings)) process.exitCode = 1
      return
    }
    case 'build': {
      const root = resolve(a ?? '.')
      const n = await buildPlugin(root)
      console.log(`Built ${n} bundle${n === 1 ? '' : 's'}`)
      const warnings = []
      if (!report(root, validatePlugin(root, warnings), warnings)) process.exitCode = 1
      return
    }
    case 'dev':
      return dev(resolve(a ?? '.'))
    default:
      console.log(usage)
      if (command && command !== 'help') process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
