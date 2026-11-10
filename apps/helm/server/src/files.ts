// `files` connections (packages/sdk/docs/connection.md#files): contained reads of the paths an
// extension's manifest declares, and `write`: replacing one existing declared file whose sha256
// the extension read, only with a one-time token from Helm's confirmation flow (confirm.ts).
// The server looks the declaration up itself, so the browser can't widen it.
import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { matchesGlob, validGlob, type FilesResult } from '@usetdt/helm-sdk'
import type { WorkspaceEntry } from './config.js'
import { digest, issue, spend } from './confirm.js'
import { ApiError } from './errors.js'
import { declaration, listExtensions } from './extensions.js'
import type { BridgePool } from './mcp/bridge.js'
import { isInside } from './workspaces.js'

const MAX_FILES = 1000
const MAX_FILE = 256 * 1024
const PROJECT_ID = /^[a-f0-9]{64}$/
const MAX_VISITS = 20_000
const MAX_BATCH = 100
const MAX_BATCH_BYTES = 2 * 1024 * 1024
type Decl = { id: string; kind: string; root?: string; paths?: unknown; operations?: unknown }

/** Read a regular file inside `root`; refuses symlinks, escapes and large files. Null when absent. */
export function readContained(root: string, rel: string): string | null {
  const realRoot = realpathSync(root)
  const file = join(realRoot, rel)
  let st
  try {
    st = lstatSync(file)
  } catch {
    return null
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new ApiError(403, 'Refusing a non-regular file')
  if (!isInside(realRoot, realpathSync(file))) throw new ApiError(403, 'Path is outside the project')
  if (st.size > MAX_FILE) throw new ApiError(413, 'File too large')
  return readFileSync(file, 'utf8')
}

/** A registered, available project's path, from TDT. */
export async function projectPath(bridges: BridgePool, ws: WorkspaceEntry, projectId: string) {
  return (await projectInfo(bridges, ws, projectId)).path
}

async function projectInfo(bridges: BridgePool, ws: WorkspaceEntry, projectId: string) {
  if (!PROJECT_ID.test(projectId)) throw new ApiError(400, 'Invalid project id')
  const result = await bridges.get(ws).call('tdt_project_read', { reference: projectId })
  const project = (result.data as { project?: { path: string; availability: string; title?: string; name?: string } } | null)?.project
  if (!result.ok || !project) throw new ApiError(404, result.error?.message ?? 'Unknown project')
  if (project.availability !== 'available') throw new ApiError(409, `The project is ${project.availability}`)
  return { path: project.path, name: project.title ?? project.name ?? basename(project.path) }
}

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

const fail = (code: string, message: string): FilesResult => ({ ok: false, data: null, error: { code, message } })

/** Regular files under `root` matching any glob; walks only below each glob's literal prefix, never into symlinks. */
export function listMatching(root: string, globs: string[]) {
  const files = new Map<string, number>()
  let visits = 0
  let truncated = false
  const walk = (rel: string) => {
    let names: string[]
    try {
      names = readdirSync(join(root, rel))
    } catch {
      return
    }
    for (const name of names.sort()) {
      if (++visits > MAX_VISITS || files.size >= MAX_FILES) return void (truncated = true)
      const path = rel ? `${rel}/${name}` : name
      const st = lstatSync(join(root, path))
      if (st.isDirectory()) walk(path)
      else if (st.isFile() && globs.some((g) => matchesGlob(g, path))) files.set(path, st.size)
    }
  }
  for (const glob of globs) {
    const segs = glob.split('/')
    const wild = segs.findIndex((s) => /[*?]/.test(s))
    const literal = segs.slice(0, wild === -1 ? segs.length - 1 : wild)
    // the literal prefix must be a real directory, reached without symlinks
    let ok = true
    for (let i = 1; i <= literal.length && ok; i++) {
      try {
        ok = lstatSync(join(root, ...literal.slice(0, i))).isDirectory()
      } catch {
        ok = false
      }
    }
    if (ok) walk(literal.join('/'))
  }
  return { files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, size]) => ({ path, size })), truncated }
}

export async function filesCall(
  bridges: BridgePool, ws: WorkspaceEntry,
  body: { key?: unknown; connection?: unknown; operation?: unknown; args?: unknown },
): Promise<FilesResult> {
  const ext = listExtensions(ws).extensions.find((e) => e.key === body.key)
  if (!ext) throw new ApiError(404, 'Unknown extension')
  const decl = ((ext.manifest as { connections?: Decl[] }).connections ?? []).find((c) => c?.id === body.connection)
  if (!decl || decl.kind !== 'files') return fail('refused', `"${String(body.connection)}" is not a files connection in this extension's manifest`)
  const globs = Array.isArray(decl.paths) ? decl.paths.filter((g): g is string => typeof g === 'string' && validGlob(g)) : []
  const ops = Array.isArray(decl.operations) ? decl.operations : []
  if (!globs.length || (decl.root !== 'project' && decl.root !== 'workspace')) return fail('refused', `Connection "${decl.id}" has an invalid root or paths`)
  if (typeof body.operation !== 'string' || !ops.includes(body.operation) || !['list', 'read', 'write'].includes(body.operation))
    return fail('refused', `"${decl.id}.${String(body.operation)}" is not declared in this extension's manifest`)
  if (body.operation === 'write') return filesWrite(bridges, ws, body)
  const args = (typeof body.args === 'object' && body.args) || {}
  const { project, path } = args as { project?: unknown; path?: unknown }
  try {
    const root = realpathSync(decl.root === 'workspace' ? ws.path : await projectPath(bridges, ws, typeof project === 'string' ? project : ''))
    if (body.operation === 'list') return { ok: true, data: listMatching(root, globs), error: null }
    const { paths } = args as { paths?: unknown }
    if (Array.isArray(paths)) {
      // batch read: one call for a whole task folder, so a plugin stays under the call rate limit
      if (!paths.length || paths.length > MAX_BATCH) return fail('refused', `"paths" must list 1–${MAX_BATCH} files`)
      const files: ({ path: string; text: string } | { path: string; error: { code: string; message: string } })[] = []
      let bytes = 0
      let truncated = false
      for (const one of paths) {
        if (bytes >= MAX_BATCH_BYTES) {
          truncated = true
          break
        }
        const r = readOne(root, globs, one)
        if (r.ok) bytes += (r.data as { text: string }).text.length
        files.push(r.ok ? (r.data as { path: string; text: string }) : { path: String(one), error: r.error! })
      }
      return { ok: true, data: { files, truncated }, error: null }
    }
    return readOne(root, globs, path)
  } catch (e) {
    return caught(e)
  }
}

const caught = (e: unknown) => {
  const status = e instanceof ApiError ? e.status : 0
  return fail(status === 403 ? 'refused' : status === 413 ? 'too_large' : 'unavailable', (e as Error).message)
}

/** One declared, non-symlinked file under root. */
function readOne(root: string, globs: string[], path: unknown): FilesResult {
  try {
    if (typeof path !== 'string' || !validGlob(path) || /[*?]/.test(path) || !globs.some((g) => matchesGlob(g, path)))
      return fail('refused', `"${String(path)}" is not a path this extension declared`)
    // the real path must be the requested one: a symlinked folder could otherwise reach undeclared files
    let real: string
    try {
      real = realpathSync(join(root, path))
    } catch {
      return fail('not_found', `${path} does not exist`)
    }
    if (relative(root, real).split(sep).join('/') !== path) return fail('refused', `${path} goes through a symlink`)
    const text = readContained(root, path)
    return text === null ? fail('not_found', `${path} does not exist`) : { ok: true, data: { path, text, sha256: sha256(text) }, error: null }
  } catch (e) {
    return caught(e)
  }
}

/* ── writes ──────────────────────────────────────────────────────────────── */
type WriteBody = { key?: unknown; connection?: unknown; operation?: unknown; args?: unknown; token?: unknown }
/** What Helm's dialog shows for a file write: where, which file, and a line diff. */
export type FilesWriteSummary = { kind: 'files-write'; actor: string; connection: string; root: string; path: string; diff: DiffLine[]; omitted: number }
type DiffLine = { op: ' ' | '-' | '+'; line: number; text: string }
type Resolved = { root: string; path: string; text: string; summary: FilesWriteSummary; binding: unknown[] }

const MAX_DIFF = 200
/**
 * The changed block between two texts: common leading and trailing lines trimmed, two lines of
 * context. ponytail: one block, not a minimal diff; two far-apart edits show everything between them.
 */
export function diffLines(before: string, after: string): { diff: DiffLine[]; omitted: number } {
  if (before === after) return { diff: [], omitted: 0 }
  const a = before.split('\n'), b = after.split('\n')
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const from = Math.max(0, s - 2)
  const diff: DiffLine[] = []
  for (let i = from; i < s; i++) diff.push({ op: ' ', line: i + 1, text: a[i] })
  for (let i = s; i < a.length - e; i++) diff.push({ op: '-', line: i + 1, text: a[i] })
  for (let i = s; i < b.length - e; i++) diff.push({ op: '+', line: i + 1, text: b[i] })
  for (let i = b.length - e; i < Math.min(b.length, b.length - e + 2); i++) diff.push({ op: ' ', line: i + 1, text: b[i] })
  return { diff: diff.slice(0, MAX_DIFF), omitted: Math.max(0, diff.length - MAX_DIFF) }
}

async function resolveWrite(bridges: BridgePool, ws: WorkspaceEntry, body: WriteBody): Promise<Resolved | FilesResult> {
  const { decl, actor, key, mayWrite } = declaration(ws, body.key, body.connection, 'files')
  if (!decl) return fail('refused', `"${String(body.connection)}" is not a files connection in this extension's manifest`)
  const globs = Array.isArray(decl.paths) ? decl.paths.filter((g): g is string => typeof g === 'string' && validGlob(g)) : []
  if (!Array.isArray(decl.operations) || !decl.operations.includes('write')) return fail('refused', `"${String(decl.id)}.write" is not declared in this extension's manifest`)
  if (!mayWrite) return fail('refused', 'This extension writes files, but its manifest does not declare permissions.write')
  if (!globs.length || (decl.root !== 'project' && decl.root !== 'workspace')) return fail('refused', `Connection "${String(decl.id)}" has an invalid root or paths`)
  const { project, path, text, expected_sha256: expected } = ((typeof body.args === 'object' && body.args) || {}) as Record<string, unknown>
  if (typeof text !== 'string') return fail('refused', '"text" must be the new file content')
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE) return fail('too_large', `"text" is larger than ${MAX_FILE / 1024} KiB`)
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return fail('refused', '"expected_sha256" must be the sha256 that read returned for this file')
  try {
    const where = decl.root === 'workspace' ? { path: ws.path, name: 'the workspace' } : await projectInfo(bridges, ws, typeof project === 'string' ? project : '')
    const root = realpathSync(where.path)
    // the same declared, contained, non-symlinked checks as read; write only replaces an existing file
    const current = readOne(root, globs, path)
    if (!current.ok) return current
    const before = (current.data as { text: string }).text
    if (sha256(before) !== expected) return fail('conflict', `${String(path)} changed since it was read; nothing was written. Read it again.`)
    const id = String(decl.id)
    return {
      root, path: path as string, text,
      summary: { kind: 'files-write', actor, connection: id, root: where.name, path: path as string, ...diffLines(before, text) },
      binding: ['files', ws.id, key, id, root, path, expected, digest(text)],
    }
  } catch (e) {
    return caught(e)
  }
}

/** A one-time token for replacing one declared file with exactly this text, and what Helm's dialog shows. */
export async function filesConfirm(bridges: BridgePool, ws: WorkspaceEntry, body: WriteBody): Promise<{ token: string; summary: FilesWriteSummary } | FilesResult> {
  if (body.operation !== 'write') return fail('refused', `"${String(body.operation)}" is a read; it needs no confirmation`)
  const r = await resolveWrite(bridges, ws, body)
  return 'ok' in r ? r : { token: issue(r.binding), summary: r.summary }
}

async function filesWrite(bridges: BridgePool, ws: WorkspaceEntry, body: WriteBody): Promise<FilesResult> {
  const r = await resolveWrite(bridges, ws, body) // rechecks the hash: a file changed since confirming is refused
  if ('ok' in r) return r
  if (!spend(body.token, r.binding)) return fail('confirmation_required', 'This write was not confirmed in Helm, or its confirmation expired; nothing was written. Try again.')
  const file = join(r.root, r.path)
  // replace atomically, keeping the file's mode; the temp file sits next to it so rename stays on one filesystem
  const tmp = join(dirname(file), `.${basename(file)}.helm-${randomBytes(6).toString('hex')}`)
  try {
    writeFileSync(tmp, r.text, { mode: lstatSync(file).mode & 0o777, flag: 'wx' })
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    return fail('unavailable', `Could not write ${r.path}: ${(e as Error).message}`)
  }
  return { ok: true, data: { path: r.path, sha256: sha256(r.text) }, error: null }
}

const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/**
 * The software-production build skill's workspace handoff for a task (Markdown), or null
 * when none was written yet. Read as text for the session view; Helm doesn't parse it.
 */
export function taskHandoff(ws: WorkspaceEntry, projectId: string, taskId: string) {
  if (!PROJECT_ID.test(projectId) || !TASK_ID.test(taskId)) throw new ApiError(400, 'Invalid project or task id')
  return readContained(ws.path, `.tdt/state/software-production/${projectId}/tasks/${taskId}.md`)
}
