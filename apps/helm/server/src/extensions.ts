// Sandboxed widgets and tools (contracts/README.md "Where extensions live").
// Discovery reads manifests from plugins enabled in the workspace (plugins.ts) and the
// workspace's work/helm/; the browser validates them against packages/sdk. Frames are served once per
// short-lived ticket with their own CSP, so the token never appears in a frame URL.
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { WorkspaceEntry } from './config.js'
import { ApiError } from './errors.js'
import { activePlugins } from './plugins.js'
import { isInside } from './workspaces.js'

const KINDS = { widgets: 'widget', tools: 'tool' } as const
const MAX_MANIFEST = 64 * 1024
const MAX_ENTRY = 1024 * 1024
const TICKET_MS = 60_000

export interface Extension {
  /** stable type key: `plugin.<package>.<id>` or `work.<id>` */
  key: string
  kind: 'widget' | 'tool'
  origin: { plugin: string } | 'generated'
  manifest: unknown
}

const safeList = (dir: string) => {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith('.')).sort()
  } catch {
    return []
  }
}

/** Real path of `path` when it is a regular file inside `root` (workspace or plugin) and ≤ max bytes. */
function confinedFile(root: string, path: string, max: number) {
  const real = realpathSync(path)
  if (!isInside(root, real)) throw new Error('points outside its folder')
  const st = statSync(real)
  if (!st.isFile()) throw new Error('is not a file')
  if (st.size > max) throw new Error(`is larger than ${max / 1024} KiB`)
  return real
}

export function listExtensions(ws: WorkspaceEntry) {
  const root = realpathSync(ws.path)
  const extensions: (Extension & { dir: string; root: string })[] = []
  const errors: { key: string; path: string; message: string }[] = []
  const base = join(root, 'work', 'helm')
  for (const [folder, kind] of Object.entries(KINDS))
    for (const id of safeList(join(base, folder))) {
      const key = `work.${id}`
      const dir = join(base, folder, id)
      const path = relative(root, join(dir, 'manifest.json')).split(sep).join('/')
      try {
        const manifest = JSON.parse(readFileSync(confinedFile(root, join(dir, 'manifest.json'), MAX_MANIFEST), 'utf8'))
        if (manifest?.id !== id) throw new Error(`"id" must match its folder name "${id}"`)
        extensions.push({ key, kind, origin: 'generated', manifest, dir, root })
      } catch (error) {
        const e = error as NodeJS.ErrnoException
        errors.push({ key, path, message: e.code === 'ENOENT' ? 'manifest.json is missing' : e instanceof SyntaxError ? `manifest.json is not valid JSON` : e.message })
      }
    }
  for (const p of activePlugins(ws.id)) {
    const where = `plugin ${p.name}`
    const blocked = !p.supported ? p.problems[0] : !p.approved ? 'changed what it declares since you approved it; review it again in Settings → Plugins' : undefined
    if (blocked || !p.root) {
      errors.push({ key: `plugin.${p.name}`, path: where, message: blocked ?? p.problems.join('; ') })
      continue
    }
    for (const b of p.bundles) {
      if (b.kind === 'theme') continue // themes are per Helm, served by /api/themes
      const key = `plugin.${p.name}.${b.id}`
      if (b.error) errors.push({ key, path: `${where}/${b.dir}/manifest.json`, message: b.error })
      else extensions.push({ key, kind: b.kind as 'widget' | 'tool', origin: { plugin: p.name }, manifest: b.manifest, dir: join(p.root, b.dir), root: p.root })
    }
  }
  return { extensions, errors }
}

/* ── frames ── */
const tickets = new Map<string, { html: string; expires: number }>()

const frameCsp = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:',
  "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'", 'sandbox allow-scripts',
].join('; ')

/** Compose the frame document (tokens + bridge + entry) and return a one-time URL for it. */
export function createFrame(ws: WorkspaceEntry, body: Record<string, unknown>) {
  const { extensions } = listExtensions(ws)
  const ext = extensions.find((e) => e.key === body.key)
  if (!ext) throw new ApiError(404, 'Unknown extension')
  const entry = (ext.manifest as { entry?: unknown }).entry
  if (typeof entry !== 'string' || entry.split('/').includes('..')) throw new ApiError(400, 'Invalid entry')
  let html: string
  try {
    html = readFileSync(confinedFile(ext.root, join(ext.dir, entry), MAX_ENTRY), 'utf8')
  } catch (error) {
    throw new ApiError(400, `Entry ${entry} ${(error as Error).message.replace(/^ENOENT.*/, 'is missing')}`)
  }
  const instance = JSON.stringify(String(body.instance ?? '')).replace(/</g, '\\u003c')
  const css = String(body.css ?? '').replace(/</g, '')
  const head = `<style id="helm-tokens">${css}</style><script>${bridge.replace('__INSTANCE__', () => instance)}</script>`
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html
  const now = Date.now()
  for (const [id, t] of tickets) if (t.expires < now) tickets.delete(id)
  const ticket = randomBytes(18).toString('hex')
  tickets.set(ticket, { html, expires: now + TICKET_MS })
  return { url: `/frame/${ticket}` }
}

/** The frame document for a ticket (single use), with its headers; null when unknown or expired. */
export function takeFrame(ticket: string) {
  const t = tickets.get(ticket)
  tickets.delete(ticket)
  if (!t || t.expires < Date.now()) return null
  return {
    html: t.html,
    headers: {
      'content-type': 'text/html; charset=utf-8', 'content-security-policy': frameCsp, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    },
  }
}

// The `helm` object inside the frame (contracts/widget.md#bridge). Every request is
// checked again by the host page; this side only shapes messages.
const bridge = `(() => {
  const instance = __INSTANCE__, handlers = {}, pending = new Map()
  let seq = 0
  const post = (m) => parent.postMessage({ helm: 1, instance, ...m }, '*')
  const request = (type, body) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); post({ type, id, ...body }) })
  const on = (event, fn) => { (handlers[event] ||= []).push(fn) }
  addEventListener('message', (ev) => {
    const m = ev.data
    if (ev.source !== parent || !m || m.helm !== 1) return
    if (m.type === 'result') { const r = pending.get(m.id); pending.delete(m.id); if (r) r(m.value); return }
    if (m.type === 'theme') document.getElementById('helm-tokens').textContent = m.css
    for (const fn of handlers[m.type] || []) try { fn(m.value) } catch (e) { console.error(e) }
  })
  window.helm = Object.freeze({
    ready: () => post({ type: 'ready' }),
    on,
    call: (connection, operation, args = {}) => request('call', { connection, operation, args }),
    openSettings: () => post({ type: 'openSettings' }),
    openConnections: () => post({ type: 'openConnections' }),
    openTab: (tab) => post({ type: 'openTab', tab }),
    startChat: (prompt) => post({ type: 'startChat', prompt: String(prompt) }),
    resize: (size) => request('resize', { size }),
    orchestrate: Object.freeze({ build: (input, opts) => request('build', { input, orWrite: opts && opts.orWrite }) }),
    sessions: Object.freeze({ on: (event, fn) => event === 'change' && on('sessions', fn) }),
    openTerminal: (opts = {}) => request('openTerminal', { opts }),
  })
})()`

/**
 * The calling extension's own declaration of `connection`, when it has that kind; with the
 * manifest's name, its key, and whether it declares `permissions.write`.
 */
export function declaration(ws: WorkspaceEntry, key: unknown, connection: unknown, kind: string) {
  const ext = listExtensions(ws).extensions.find((e) => e.key === key)
  if (!ext) throw new ApiError(404, 'Unknown extension')
  const m = ext.manifest as { name?: unknown; connections?: { id?: unknown; kind?: unknown }[]; permissions?: { write?: unknown } }
  const decl = (Array.isArray(m.connections) ? m.connections : []).find((c) => c?.id === connection && c.kind === kind)
  return { decl: decl as Record<string, unknown> | undefined, actor: typeof m.name === 'string' ? m.name : String(key), key: ext.key, mayWrite: m.permissions?.write === true }
}
