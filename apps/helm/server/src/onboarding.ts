// First-run onboarding (task 042): check/install TDT, browse folders, and register or
// initialise a workspace. Shared by the HTTP routes and `helm workspace`. Every command
// runs as an argument array (never a shell) on a path the user chose.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { CONFIG_PATH, HELM_HOME, type HelmConfig, type WorkspaceEntry } from './config.js'
import { ApiError } from './errors.js'
import { looksLikeTdtWorkspace } from './workspaces.js'

type Run = { ok: boolean; output: string }

/** Run a program (no shell) and collect stdout+stderr; never throws. */
export function run(command: string, args: string[], timeout = 60_000): Promise<Run> {
  return new Promise((res) => {
    execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim()
      res({ ok: !error, output: output || (error ? error.message : '') })
    })
  })
}

/* ── TDT and pipx ─────────────────────────────────────────────────────────── */
export async function tdtStatus(config: HelmConfig) {
  const [tdt, pipx] = await Promise.all([run(config.tdtCommand, ['--version']), run('pipx', ['--version'])])
  return {
    platform: process.platform,
    tdt: { ok: tdt.ok, command: config.tdtCommand, version: tdt.ok ? tdt.output : undefined, error: tdt.ok ? undefined : tdt.output },
    pipx: { ok: pipx.ok, version: pipx.ok ? pipx.output : undefined },
  }
}

/**
 * `pipx install 'thisdamnthing[mcp]'` (Helm needs the mcp extra), then `pipx ensurepath`.
 * When `tdt` is not on this process's PATH yet, point tdtCommand at pipx's bin directory
 * so Helm carries on without a restart.
 */
export async function installTdt(config: HelmConfig) {
  const install = await run('pipx', ['install', 'thisdamnthing[mcp]'], 10 * 60_000)
  if (!install.ok) return { ok: false, output: install.output, pathChanged: false }
  const ensure = await run('pipx', ['ensurepath'])
  let tdtCommand = config.tdtCommand
  if (!(await run(tdtCommand, ['--version'])).ok) {
    const bin = (await run('pipx', ['environment', '--value', 'PIPX_BIN_DIR'])).output
    const candidate = join(bin, process.platform === 'win32' ? 'tdt.exe' : 'tdt')
    if (bin && existsSync(candidate) && (await run(candidate, ['--version'])).ok) {
      tdtCommand = candidate
      config.tdtCommand = candidate
      updateConfigFile((raw) => ({ ...raw, tdtCommand: candidate }))
    }
  }
  return { ok: true, output: `${install.output}\n\n${ensure.output}`.trim(), pathChanged: /added|modified|will need to/i.test(ensure.output), tdtCommand }
}

/* ── folder browser (not confined: the user may pick any folder) ─────────── */
export function listFolder(requested?: string) {
  const path = resolve(requested && isAbsolute(requested) ? requested : homedir())
  let names: { name: string; dir: boolean }[]
  try {
    names = readdirSync(path, { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() || (d.isSymbolicLink() && isDir(join(path, d.name))) }))
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    throw new ApiError(code === 'ENOENT' ? 404 : code === 'ENOTDIR' ? 400 : 403,
      code === 'ENOENT' ? `${path} does not exist` : code === 'ENOTDIR' ? `${path} is not a folder` : `Helm cannot read ${path} (${code ?? 'permission denied'})`)
  }
  const crumbs: { name: string; path: string }[] = []
  for (let p = path; ; p = dirname(p)) {
    crumbs.unshift({ name: p === parse(p).root ? p : basename(p), path: p })
    if (p === dirname(p)) break
  }
  return {
    path, sep, home: homedir(), crumbs,
    parent: path === dirname(path) ? null : dirname(path),
    workspace: looksLikeTdtWorkspace(path),
    empty: names.length === 0,
    folders: names.filter((n) => n.dir && !n.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => ({ name: n.name, path: join(path, n.name), workspace: looksLikeTdtWorkspace(join(path, n.name)) })),
  }
}

function isDir(p: string) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function createFolder(parent: unknown, name: unknown) {
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new ApiError(400, 'Choose a parent folder')
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n || n === '.' || n === '..' || /[\\/\0]/.test(n) || n.length > 255) throw new ApiError(400, 'Give a folder name without slashes')
  const path = join(parent, n)
  try {
    mkdirSync(path)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    throw new ApiError(code === 'EEXIST' ? 409 : 403, code === 'EEXIST' ? `${n} already exists` : `Helm cannot create ${path} (${code})`)
  }
  return { path }
}

/* ── register / initialise ───────────────────────────────────────────────── */
export type AddResult = { workspace: WorkspaceEntry; created: boolean; output: string }

/**
 * Register an existing TDT workspace, or with `init` run `tdt init <path>` and
 * `tdt --workspace <path> doctor` first (registered only when both succeed).
 * Updates the config file (keeping everything else in it) and `config` in memory.
 */
export async function addWorkspace(config: HelmConfig, input: { path?: unknown; name?: unknown; init?: unknown }): Promise<AddResult> {
  if (typeof input.path !== 'string' || !input.path.trim()) throw new ApiError(400, 'Choose a folder')
  let path = resolve(input.path.trim())
  if (/\0/.test(path)) throw new ApiError(400, 'Invalid path')
  let output = ''
  if (input.init === true && !looksLikeTdtWorkspace(path)) {
    const init = await run(config.tdtCommand, ['init', path], 5 * 60_000)
    output = init.output
    if (!init.ok) throw new ApiError(422, `tdt init failed:\n${init.output}`)
    const doctor = await run(config.tdtCommand, ['--workspace', path, 'doctor'], 2 * 60_000)
    output += `\n\n${doctor.output}`
    if (!doctor.ok) throw new ApiError(422, `The workspace was created, but tdt doctor reported a problem:\n${doctor.output}`)
  }
  try {
    path = realpathSync(path)
  } catch {
    throw new ApiError(404, `${path} does not exist`)
  }
  if (!looksLikeTdtWorkspace(path)) throw new ApiError(422, `${path} is not a TDT workspace (no .tdt/config.json). Create one there first.`)

  const existing = config.workspaces.find((w) => w.path === path)
  if (existing) return { workspace: existing, created: false, output }
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : basename(path) || path
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
  let id = base
  for (let i = 2; config.workspaces.some((w) => w.id === id); i++) id = `${base}-${i}`
  const workspace: WorkspaceEntry = { id, name, path, profile: 'read-only' }
  updateConfigFile((raw) => ({ ...raw, workspaces: [...(Array.isArray(raw.workspaces) ? raw.workspaces : []), workspace] }))
  config.workspaces.push(workspace)
  return { workspace, created: true, output }
}

/** Change the raw config file atomically, keeping keys Helm doesn't know about (and not baking in defaults). */
function updateConfigFile(change: (raw: Record<string, unknown>) => Record<string, unknown>) {
  let raw: Record<string, unknown> = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''))
    } catch {
      throw new ApiError(409, `${CONFIG_PATH} is unreadable; fix or remove it first`)
    }
  }
  mkdirSync(HELM_HOME, { recursive: true, mode: 0o700 })
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(change(raw), null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, CONFIG_PATH)
}
