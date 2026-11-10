// Plugins (packages/sdk/docs/plugin.md): npm packages installed into HELM_HOME/plugins
// with --ignore-scripts, approved for their exact declarations, enabled per workspace.
// Approvals and enablement live in plugins/state.json, read fresh on every call, so the
// `helm plugin` CLI and a running server never overwrite each other's view.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { validateTheme } from '@usetdt/helm-sdk'
import { promisify } from 'node:util'
import { HELM_HOME } from './config.js'
import { ApiError } from './errors.js'
import { isInside } from './workspaces.js'

export const PLUGIN_DIR = join(HELM_HOME, 'plugins')
/** Plugin contract versions this Helm understands (`"helm": { "contract": n }`). */
export const PLUGIN_CONTRACTS = [1]
const MAX_JSON = 64 * 1024
const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
// No shell metacharacters: npm runs through a shell on Windows.
const SPEC = /^[A-Za-z0-9@~.\/\\][A-Za-z0-9@~.\/\\:_+#=-]{0,511}$/
const DIR = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/
const KINDS = { widgets: 'widget', tools: 'tool', themes: 'theme' } as const

export interface PluginBundle {
  kind: 'widget' | 'tool' | 'theme'
  /** directory inside the plugin, as declared */
  dir: string
  id: string
  manifest?: unknown
  error?: string
  /** theme bundles: validated tokens and contrast warnings (below AA is offered, with a warning) */
  theme?: { tokens: Record<string, string>; chrome?: Record<string, string>; warnings: string[] }
}

export interface PluginInfo {
  name: string
  version: string
  /** what was installed: a registry range, `file:` path or git URL */
  spec: string
  linked: boolean
  contract: unknown
  supported: boolean
  bundles: PluginBundle[]
  problems: string[]
  /** sha256 over version, the "helm" field and every manifest: what an approval covers */
  digest: string
  approved: boolean
  /** workspace ids this plugin is enabled in */
  enabledIn: string[]
  /** real folder of the installed package (server only) */
  root: string
}

interface State {
  approved: Record<string, string>
  enabled: Record<string, string[]>
}

const run = promisify(execFile)
const statePath = () => join(PLUGIN_DIR, 'state.json')

function ensureStore() {
  mkdirSync(PLUGIN_DIR, { recursive: true, mode: 0o700 })
  const pkg = join(PLUGIN_DIR, 'package.json')
  if (!existsSync(pkg))
    writeFileSync(pkg, JSON.stringify({ private: true, description: 'Helm plugins, managed by `helm plugin`', dependencies: {} }, null, 2) + '\n')
}

function readJson(path: string): Record<string, unknown> {
  const st = statSync(path)
  if (!st.isFile() || st.size > MAX_JSON) throw new Error(`${basename(path)} is not a file of at most ${MAX_JSON / 1024} KiB`)
  const v = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${basename(path)} must be a JSON object`)
  return v
}

function loadState(): State {
  try {
    const s = readJson(statePath()) as Partial<State>
    return { approved: { ...s.approved }, enabled: { ...s.enabled } }
  } catch {
    return { approved: {}, enabled: {} }
  }
}

function saveState(s: State) {
  ensureStore()
  writeFileSync(statePath(), JSON.stringify(s, null, 2) + '\n', { mode: 0o600 })
}

function dependencies(): Record<string, string> {
  try {
    const deps = readJson(join(PLUGIN_DIR, 'package.json')).dependencies
    return deps && typeof deps === 'object' ? { ...(deps as Record<string, string>) } : {}
  } catch {
    return {}
  }
}

/** Read one installed plugin: its declarations, problems and approval state. */
function inspect(name: string, spec: string, state: State): PluginInfo {
  const info: PluginInfo = {
    name, version: '', spec, linked: spec.startsWith('file:'), contract: undefined, supported: false,
    bundles: [], problems: [], digest: '', approved: false, root: '',
    enabledIn: Object.entries(state.enabled).filter(([, names]) => names.includes(name)).map(([ws]) => ws),
  }
  const hash = createHash('sha256')
  try {
    if (!NAME.test(name)) throw new Error('is not a valid package name')
    info.root = realpathSync(join(PLUGIN_DIR, 'node_modules', name))
    const pkg = readJson(join(info.root, 'package.json'))
    info.version = typeof pkg.version === 'string' ? pkg.version : ''
    const helm = pkg.helm as Record<string, unknown> | undefined
    hash.update(JSON.stringify({ name, version: info.version, helm: helm ?? null }))
    if (!helm || typeof helm !== 'object') throw new Error('has no "helm" field, so it is not a Helm plugin')
    info.contract = helm.contract
    info.supported = PLUGIN_CONTRACTS.includes(helm.contract as number)
    if (!info.supported) info.problems.push(`uses plugin contract ${JSON.stringify(helm.contract)}; this Helm supports ${PLUGIN_CONTRACTS.join(', ')}, so it needs a newer Helm`)
    for (const [field, kind] of Object.entries(KINDS)) {
      const list = helm[field]
      if (list === undefined) continue
      if (!Array.isArray(list)) {
        info.problems.push(`"helm.${field}" must be a list`)
        continue
      }
      for (const dir of list) {
        const bundle: PluginBundle = { kind, dir: String(dir), id: basename(String(dir)) }
        info.bundles.push(bundle)
        try {
          if (typeof dir !== 'string' || !DIR.test(dir) || dir.split('/').some((p) => p === '..' || p === '.')) throw new Error('must be a relative folder inside the package')
          const real = realpathSync(join(info.root, dir, 'manifest.json'))
          if (!isInside(info.root, real)) throw new Error('manifest.json points outside the package')
          const text = readFileSync(real, 'utf8')
          if (text.length > MAX_JSON) throw new Error('manifest.json is too large')
          hash.update(`\0${kind}:${dir}\0${text}`)
          bundle.manifest = JSON.parse(text)
          if ((bundle.manifest as { id?: unknown })?.id !== bundle.id) throw new Error(`"id" must match its folder name "${bundle.id}"`)
          if (kind === 'theme') {
            const base = realpathSync(join(info.root, dir))
            const r = validateTheme(bundle.manifest, (f) => {
              try {
                const file = realpathSync(join(base, f))
                if (!isInside(base, file) || statSync(file).size > MAX_JSON) return undefined
                const css = readFileSync(file, 'utf8')
                hash.update(`\0${f}\0${css}`) // the approval covers the token values too
                return css
              } catch {
                return undefined
              }
            })
            if (r.problems.length) throw new Error(r.problems.join('; '))
            bundle.theme = { tokens: r.tokens, chrome: r.chrome, warnings: r.warnings }
          }
        } catch (error) {
          const e = error as NodeJS.ErrnoException
          bundle.error = e.code === 'ENOENT' ? 'manifest.json is missing' : e instanceof SyntaxError ? 'manifest.json is not valid JSON' : e.message
          hash.update(`\0${kind}:${dir}\0!${bundle.error}`)
        }
      }
    }
    if (!info.bundles.length) info.problems.push('declares no widgets, tools or themes')
  } catch (error) {
    info.problems.push(`${name} ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'is not installed (run `helm plugin add` again)' : (error as Error).message}`)
  }
  info.digest = hash.digest('hex')
  info.approved = state.approved[name] === info.digest
  return info
}

export function listPlugins(): PluginInfo[] {
  const state = loadState()
  return Object.entries(dependencies())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, spec]) => inspect(name, spec, state))
}

export function getPlugin(name: string) {
  const p = listPlugins().find((x) => x.name === name)
  if (!p) throw new ApiError(404, `Plugin ${name} is not installed`)
  return p
}

/** Plugins usable in a workspace: enabled there, approved as they are now, supported. */
export function activePlugins(wsId: string) {
  return listPlugins().filter((p) => p.enabledIn.includes(wsId))
}

export interface PluginTheme {
  /** data-theme value: `<plugin>/<id>`; the chrome sub-theme is `<key>:chrome` */
  key: string
  plugin: string
  name: string
  tagline: string
  tokens: Record<string, string>
  chrome?: Record<string, string>
  warnings: string[]
}

/** Themes of every approved, supported plugin: per Helm, in every workspace (no per-workspace enable). */
export function listThemes(): PluginTheme[] {
  return listPlugins()
    .filter((p) => p.approved && p.supported && !p.problems.length)
    .flatMap((p) =>
      p.bundles.flatMap((b) => {
        if (b.kind !== 'theme' || b.error || !b.theme) return []
        const m = b.manifest as { name: string; tagline: string }
        return [{ key: `${p.name}/${b.id}`, plugin: p.name, name: m.name, tagline: m.tagline, ...b.theme }]
      }),
    )
}

async function npm(args: string[]) {
  ensureStore()
  const win = process.platform === 'win32'
  try {
    await run(win ? 'npm.cmd' : 'npm', ['--prefix', PLUGIN_DIR, ...args, '--ignore-scripts', '--no-audit', '--no-fund', '--save'], {
      cwd: PLUGIN_DIR, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, shell: win,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
    })
  } catch (error) {
    const e = error as { stderr?: string; message: string }
    const line = (e.stderr ?? '').split('\n').find((l) => /npm (error|ERR!)/.test(l) && !/A complete log|^npm error\s*$/.test(l))
    throw new ApiError(400, `npm failed: ${(line ?? e.message).replace(/^npm (error|ERR!)\s*/, '').slice(0, 300)}`)
  }
}

/**
 * Install a plugin from an npm name/range, a git URL or a local folder (linked, for
 * development). Install scripts never run. Returns the plugin, not yet approved.
 */
export async function addPlugin(rawSpec: string, cwd = process.cwd()) {
  let spec = String(rawSpec ?? '').trim()
  if (!SPEC.test(spec)) throw new ApiError(400, 'Give an npm package name, a git URL or a folder path')
  // a folder: ./x, ../x, ~/x or an absolute path (anything else goes to npm as is)
  if (spec.startsWith('.') || spec.startsWith('~') || isAbsolute(spec)) {
    spec = resolve(cwd, spec.replace(/^~(?=$|[\\/])/, process.env.HOME ?? '~'))
    if (!existsSync(join(spec, 'package.json')) && !/\.tgz$/.test(spec)) throw new ApiError(400, `${spec} is not a plugin folder (no package.json) or a .tgz`)
    if (!SPEC.test(spec)) throw new ApiError(400, 'That folder path has characters Helm does not pass to npm')
  }
  const before = dependencies()
  await npm(['install', spec])
  const after = dependencies()
  const name = Object.keys(after).find((n) => before[n] !== after[n]) ?? Object.keys(after).find((n) => !(n in before))
  if (!name) {
    // reinstall of an unchanged spec: find it by what it points at
    const same = Object.entries(after).find(([, s]) => s === spec || s === `file:${spec}`)
    if (!same) throw new ApiError(400, 'npm finished but no plugin was added')
    return getPlugin(same[0])
  }
  const plugin = getPlugin(name)
  if (plugin.problems.some((p) => p.includes('not a Helm plugin'))) {
    await removePlugin(name)
    throw new ApiError(400, `${name} is not a Helm plugin (no "helm" field); removed it again`)
  }
  return plugin
}

export async function removePlugin(name: string) {
  if (!(name in dependencies())) throw new ApiError(404, `Plugin ${name} is not installed`)
  await npm(['uninstall', name])
  const s = loadState()
  delete s.approved[name]
  for (const ws of Object.keys(s.enabled)) s.enabled[ws] = s.enabled[ws].filter((n) => n !== name)
  saveState(s)
  return { ok: true }
}

/** Record the user's approval of exactly what the plugin declares now (`digest` from the review). */
export function approvePlugin(name: string, digest: unknown) {
  const p = getPlugin(name)
  if (digest !== p.digest) throw new ApiError(409, `${name} changed since you reviewed it; review it again`)
  if (!p.supported) throw new ApiError(400, `${name} needs a newer Helm`)
  const s = loadState()
  s.approved[name] = p.digest
  saveState(s)
  return getPlugin(name)
}

export function setPluginEnabled(wsId: string, name: string, enabled: unknown) {
  const p = getPlugin(name)
  if (enabled === true && !p.approved) throw new ApiError(409, `Review and approve ${name} before enabling it`)
  const s = loadState()
  const list = new Set(s.enabled[wsId] ?? [])
  if (enabled === true) list.add(name)
  else list.delete(name)
  s.enabled[wsId] = [...list].sort()
  saveState(s)
  return getPlugin(name)
}
