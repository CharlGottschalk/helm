// Helm local server. Loopback only, bearer token in the URL fragment (never sent
// in requests), exact Host check, no CORS. Serves the built frontend and a small
// JSON + WebSocket API. Same security posture as TDT's on-demand UI server.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { CONFIG_PATH, HELM_VERSION, loadConfig, type HostId } from './config.js'
import { BridgePool } from './mcp/bridge.js'
import { Orchestrator } from './orchestrator.js'
import { editRecord, knowledgeId } from './records.js'
import { createFrame, listExtensions, takeFrame } from './extensions.js'
import { addPlugin, approvePlugin, listPlugins, listThemes, removePlugin, setPluginEnabled, type PluginInfo } from './plugins.js'
import { SessionManager } from './sessions.js'
import { TerminalManager } from './terminal/pty.js'
import { ApiError } from './errors.js'
import { filesCall, filesConfirm, taskHandoff } from './files.js'
import { dbCall, dbConfirm, exploreConfirm, explorerWritesOn, exploreQuery, exploreSchema, exploreWrite, listProfiles, removeProfile, saveProfile, setExplorerWrites, testProfile } from './db.js'
import { connectHttpProfile, httpCall, httpConfirm, listHttpProfiles, removeHttpProfile, saveHttpProfile } from './http.js'
import { finishConnect, setRedirectUri } from './oauth.js'
import { closeAllMcp, listMcpServers, mcpCall, mcpConfirm, removeMcpServer, saveMcpServer, testMcpServer } from './mcp.js'
import { getWorkspace, looksLikeTdtWorkspace } from './workspaces.js'
import { addWorkspace, createFolder, installTdt, listFolder, tdtStatus } from './onboarding.js'
import { launchApp, listApps, removeApp, saveApp } from './apps.js'
import { usageLimits } from './usage.js'

const config = loadConfig()
const port = Number(process.env.HELM_PORT ?? config.port)
// --dev: fixed token "dev" and the Vite dev server (localhost:5173) allowed as an origin,
// so `npm run dev` + `npm run dev:server` work together via Vite's proxy.
const dev = process.argv.includes('--dev')
const token = process.env.HELM_TOKEN ?? (dev ? 'dev' : randomBytes(24).toString('hex'))
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
const MAX_BODY = 256 * 1024

const bridges = new BridgePool(config)
const terminals = new TerminalManager()
const sessions = new SessionManager(terminals)
const orchestrator = new Orchestrator(config, terminals, sessions)

/* â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(dev ? ['localhost:5173', '127.0.0.1:5173'] : [])])

function tokenMatches(candidate: string | null | undefined) {
  if (!candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new ApiError(413, 'Request too large')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw new ApiError(400, 'Body must be a JSON object')
  }
}

/* â”€â”€ API routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type Handler = (req: IncomingMessage, params: Record<string, string>) => Promise<unknown>
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = []

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = []
  const pattern = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$')
  routes.push({ method, pattern, keys, handler })
}

route('GET', '/api/health', async () => ({ ok: true, name: 'helm', version: HELM_VERSION }))

route('GET', '/api/workspaces', async () =>
  config.workspaces.map((w) => ({ ...w, tdt: looksLikeTdtWorkspace(w.path) })),
)
// Onboarding and "Add workspace" (task 042, onboarding.ts). Editing/removing workspaces stays out of scope.
route('POST', '/api/workspaces', async (req) => {
  const r = await addWorkspace(config, await readJson(req))
  return { ...r, workspace: { ...r.workspace, tdt: true } }
})
route('GET', '/api/onboarding/tdt', async () => tdtStatus(config))
route('POST', '/api/onboarding/tdt/install', async () => installTdt(config))
route('POST', '/api/onboarding/folders/list', async (req) => listFolder((await readJson(req)).path as string | undefined))
route('POST', '/api/onboarding/folders/create', async (req) => {
  const b = await readJson(req)
  return createFolder(b.parent, b.name)
})

route('GET', '/api/workspaces/:ws/tools', async (_req, p) => bridges.get(getWorkspace(config, p.ws)).listTools())

route('POST', '/api/workspaces/:ws/tools/:name', async (req, p) => {
  const ws = getWorkspace(config, p.ws)
  if (!/^tdt_[a-z_]+$/.test(p.name)) throw new ApiError(400, 'Unknown tool name')
  // Its result is a UI session's bearer URL: only the dedicated route below may ask for it,
  // so extensions (which reach TDT through this route) never see one.
  if (p.name === 'tdt_ui_start') throw new ApiError(403, 'tdt_ui_start is only available through Helm\'s interview Open action')
  // TDT enforces the profile (write tools are absent in read-only) and validates input.
  // TODO: for write tools, require a token from Helm's confirmation flow (confirm.ts, as db writes do)
  // and inject user_instruction server-side from that dialog, never from the extension.
  return bridges.get(ws).call(p.name, await readJson(req))
})

// Resume one retained TDT UI interview and return its private URL to the shell only (task 012).
// Resume only: an exact session id, never a new session; the URL is not logged or stored.
route('POST', '/api/workspaces/:ws/interviews/:session/open', async (_req, p) => {
  const ws = getWorkspace(config, p.ws)
  if (!/^[a-f0-9]{32}$/.test(p.session)) throw new ApiError(400, 'Unknown interview session')
  if (ws.profile !== 'everyday') throw new ApiError(409, `Opening an interview needs the everyday TDT profile. Set "profile": "everyday" on this workspace's entry in ${CONFIG_PATH}, then restart Helm.`)
  const r = await bridges.get(ws).call('tdt_ui_start', { session_id: p.session, open_browser: false })
  const url = (r.data as { url?: unknown } | undefined)?.url
  if (!r.ok || typeof url !== 'string') throw new ApiError(409, r.error?.message ?? 'TDT could not resume the interview')
  if (!/^http:\/\/127\.0\.0\.1:\d+\/#/.test(url)) throw new ApiError(502, 'TDT returned an unexpected interview URL')
  return { url }
})

// Brain record edits (preview → confirm → apply) through TDT's sanctioned operations.
route('POST', '/api/workspaces/:ws/records/knowledge-id', async (req, p) => knowledgeId(bridges, getWorkspace(config, p.ws), await readJson(req)))
route('POST', '/api/workspaces/:ws/records/edit', async (req, p) => editRecord(bridges, getWorkspace(config, p.ws), await readJson(req)))

// Sandboxed widgets/tools: manifests (validated in the browser) and one-time frame URLs.
route('GET', '/api/workspaces/:ws/extensions', async (_req, p) => {
  const { extensions, errors } = listExtensions(getWorkspace(config, p.ws))
  return { extensions: extensions.map(({ dir: _dir, root: _root, ...e }) => e), errors }
})
// `files` connections: the server checks the extension's own declaration (files.ts).
route('POST', '/api/workspaces/:ws/extensions/files', async (req, p) => filesCall(bridges, getWorkspace(config, p.ws), await readJson(req)))
// Every extension write (files `write`, http `write: true` calls, mcp `writes` tools, db write queries) needs
// a token from its kind's `confirm`, which only the shell can ask for, spent after the user confirms Helm's dialog.
route('POST', '/api/workspaces/:ws/extensions/files/confirm', async (req, p) => filesConfirm(bridges, getWorkspace(config, p.ws), await readJson(req)))
// `db` connections: named queries against a profile configured in Helm (db.ts). Write queries need a
// token from `confirm`, which the shell asks for and spends only after the user confirms Helm's dialog.
route('POST', '/api/workspaces/:ws/extensions/db', async (req, p) => dbCall(getWorkspace(config, p.ws), await readJson(req)))
route('POST', '/api/workspaces/:ws/extensions/db/confirm', async (req, p) => dbConfirm(getWorkspace(config, p.ws), await readJson(req)))
// Database profiles (Settings → Connections, `helm db`): passwords go in, never come back out.
route('GET', '/api/db/profiles', async () => ({ ...listProfiles(), explorerWrites: explorerWritesOn() }))
route('POST', '/api/db/profiles', async (req) => saveProfile(await readJson(req)))
route('DELETE', '/api/db/profiles/:name', async (_req, p) => removeProfile(decodeURIComponent(p.name)))
route('POST', '/api/db/profiles/:name/test', async (_req, p) => testProfile(decodeURIComponent(p.name)))
// DB explorer (built-in tool only): schema listing and ad hoc read-only SQL. Sandboxed frames can't call the API.
route('GET', '/api/db/profiles/:name/schema', async (_req, p) => exploreSchema(decodeURIComponent(p.name)))
route('POST', '/api/db/profiles/:name/query', async (req, p) => exploreQuery(decodeURIComponent(p.name), await readJson(req)))
// Explorer writes: a confirmed per-profile toggle, then a confirmed token per statement.
route('POST', '/api/db/profiles/:name/confirm', async (req, p) => exploreConfirm(decodeURIComponent(p.name), await readJson(req)))
route('POST', '/api/db/profiles/:name/writes', async (req, p) => setExplorerWrites(decodeURIComponent(p.name), await readJson(req)))
route('POST', '/api/db/profiles/:name/write', async (req, p) => exploreWrite(decodeURIComponent(p.name), await readJson(req)))
// `http` connections: declared calls to a service profile's base URL (http.ts); `mcp`: declared tools on a configured server (mcp.ts).
route('POST', '/api/workspaces/:ws/extensions/http', async (req, p) => httpCall(getWorkspace(config, p.ws), await readJson(req)))
route('POST', '/api/workspaces/:ws/extensions/mcp', async (req, p) => mcpCall(getWorkspace(config, p.ws), await readJson(req)))
route('POST', '/api/workspaces/:ws/extensions/http/confirm', async (req, p) => httpConfirm(getWorkspace(config, p.ws), await readJson(req)))
route('POST', '/api/workspaces/:ws/extensions/mcp/confirm', async (req, p) => mcpConfirm(getWorkspace(config, p.ws), await readJson(req)))
// Service profiles and MCP servers (Settings → Connections): tokens go in, never come back out.
route('GET', '/api/http/profiles', async () => listHttpProfiles())
route('POST', '/api/http/profiles', async (req) => saveHttpProfile(await readJson(req)))
route('DELETE', '/api/http/profiles/:name', async (_req, p) => removeHttpProfile(decodeURIComponent(p.name)))
// OAuth2 sign-in: the shell opens the returned provider URL; the provider redirects to /oauth/callback below.
route('POST', '/api/workspaces/:ws/http/profiles/:name/connect', async (_req, p) => connectHttpProfile(getWorkspace(config, p.ws), decodeURIComponent(p.name)))
// Local apps allowlist (task 045, apps.ts): launch takes an id only, never a command.
route('GET', '/api/apps', async () => listApps())
route('POST', '/api/apps', async (req) => saveApp(await readJson(req)))
route('DELETE', '/api/apps/:id', async (_req, p) => removeApp(decodeURIComponent(p.id)))
route('POST', '/api/apps/:id/launch', async (_req, p) => launchApp(decodeURIComponent(p.id)))
// Agent usage limits (task 048): percentages and reset times only; `?focus=1` allows an earlier check.
route('GET', '/api/usage/limits', async (req) => usageLimits(config, new URL(req.url ?? '/', 'http://localhost').searchParams.get('focus') === '1'))
route('GET', '/api/mcp/servers', async () => listMcpServers())
route('POST', '/api/mcp/servers', async (req) => saveMcpServer(await readJson(req)))
route('DELETE', '/api/mcp/servers/:name', async (_req, p) => removeMcpServer(decodeURIComponent(p.name)))
route('POST', '/api/mcp/servers/:name/test', async (_req, p) => testMcpServer(decodeURIComponent(p.name)))
// Plugins: installed per Helm (npm, scripts off), approved for exact declarations, enabled per workspace.
const pluginView = ({ root: _root, ...p }: PluginInfo) => p
route('GET', '/api/plugins', async () => ({ plugins: listPlugins().map(pluginView) }))
route('GET', '/api/themes', async () => ({ themes: listThemes() }))
route('POST', '/api/plugins', async (req) => pluginView(await addPlugin(String((await readJson(req)).spec ?? ''))))
route('DELETE', '/api/plugins/:name', async (_req, p) => removePlugin(decodeURIComponent(p.name)))
route('POST', '/api/plugins/:name/approve', async (req, p) => pluginView(approvePlugin(decodeURIComponent(p.name), (await readJson(req)).digest)))
route('POST', '/api/workspaces/:ws/plugins/:name', async (req, p) =>
  pluginView(setPluginEnabled(getWorkspace(config, p.ws).id, decodeURIComponent(p.name), (await readJson(req)).enabled)),
)
route('POST', '/api/workspaces/:ws/extensions/frame', async (req, p) => createFrame(getWorkspace(config, p.ws), await readJson(req)))

route('GET', '/api/workspaces/:ws/sessions', async (_req, p) => sessions.list(getWorkspace(config, p.ws).id))

route('POST', '/api/workspaces/:ws/sessions/handoff', async (req, p) => {
  const body = await readJson(req)
  return orchestrator.handoff(getWorkspace(config, p.ws), String(body.prompt ?? ''), body.host as HostId | undefined)
})

route('POST', '/api/workspaces/:ws/sessions/build', async (req, p) => {
  const body = await readJson(req)
  return orchestrator.build(getWorkspace(config, p.ws), {
    projectId: String(body.projectId ?? ''),
    taskId: String(body.taskId ?? ''),
    host: body.host as HostId | undefined,
  })
})

route('GET', '/api/workspaces/:ws/projects/:project/tasks/:task/handoff', async (_req, p) => ({
  markdown: taskHandoff(getWorkspace(config, p.ws), decodeURIComponent(p.project), decodeURIComponent(p.task)),
}))

route('POST', '/api/workspaces/:ws/terminals', async (req, p) => {
  const ws = getWorkspace(config, p.ws)
  const body = await readJson(req)
  return terminals.spawn({ workspaceId: ws.id, workspaceRoot: ws.path, cwd: typeof body.cwd === 'string' ? body.cwd : undefined, title: 'Terminal' })
})

route('DELETE', '/api/terminals/:id', async (_req, p) => {
  terminals.kill(p.id)
  return { ok: true }
})

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const auth = req.headers.authorization
  if (!tokenMatches(auth?.startsWith('Bearer ') ? auth.slice(7) : null)) return send(res, 401, { error: 'unauthorized' })
  const match = routes.find((r) => r.method === req.method && r.pattern.test(pathname))
  if (!match) return send(res, 404, { error: 'not_found' })
  const values = pathname.match(match.pattern)!.slice(1)
  const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]))
  try {
    send(res, 200, await match.handler(req, params))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    // Don't echo stack traces or filesystem details to the browser.
    send(res, status, { error: status === 500 ? 'internal_error' : (error as Error).message })
    if (status === 500) console.error('[helm]', error)
  }
}

/* â”€â”€ static frontend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json',
}
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ')

function serveStatic(res: ServerResponse, pathname: string) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  let file = join(DIST, safe)
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain' })
    return res.end('Frontend not built. Run `npm run build` (or use `npm run dev` for development).')
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  createReadStream(file).pipe(res)
}

/* â”€â”€ server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const server = createServer((req, res) => {
  if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 421, { error: 'bad_host' })
  const origin = req.headers.origin
  if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'bad_origin' })
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (pathname.startsWith('/api/')) return void handleApi(req, res, pathname)
  // The provider's redirect: no bearer token (a top-level navigation from the provider), so the
  // one-time state from startConnect is its only credential. The page shows a fixed message, escaped.
  if (pathname === '/oauth/callback' && req.method === 'GET')
    return void finishConnect(new URL(req.url ?? '/', 'http://localhost').searchParams).catch((error) => {
      console.error('[helm]', error)
      return { status: 500, message: 'Helm could not finish the sign-in. Try again from Helm.' }
    }).then(({ status, message }) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      })
      const text = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
      res.end(`<!doctype html><meta charset="utf-8"><title>Helm sign-in</title><body style="font:16px system-ui;margin:3rem;max-width:40rem"><p>${text}</p></body>`)
    })
  if (pathname.startsWith('/frame/')) {
    const frame = req.method === 'GET' ? takeFrame(pathname.slice(7)) : null
    if (!frame) return send(res, 404, { error: 'not_found' })
    res.writeHead(200, frame.headers)
    return void res.end(frame.html)
  }
  serveStatic(res, pathname)
})

/* â”€â”€ WebSocket: sessions + terminal streams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
// Client â†’ server: {type:'term:attach'|'term:input'|'term:resize'|'term:detach', id, data?, cols?, rows?}
// Server â†’ client: {type:'sessions', sessions} | {type:'term:scrollback'|'term:data', id, data} | {type:'term:exit', id, code}
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY })
const attached = new Map<WebSocket, Set<string>>()

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const origin = req.headers.origin
  const okOrigin = !origin || allowedHosts.has(origin.replace(/^https?:\/\//, ''))
  if (url.pathname !== '/ws' || !allowedHosts.has(req.headers.host ?? '') || !okOrigin || !tokenMatches(url.searchParams.get('token'))) {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
})

wss.on('connection', (ws: WebSocket) => {
  attached.set(ws, new Set())
  ws.send(JSON.stringify({ type: 'sessions', sessions: sessions.list() }))
  ws.on('message', (raw) => {
    let msg: { type?: string; id?: string; data?: string; cols?: number; rows?: number }
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    const ids = attached.get(ws)!
    try {
      if (msg.type === 'term:attach' && msg.id) {
        ids.add(msg.id)
        ws.send(JSON.stringify({ type: 'term:scrollback', id: msg.id, data: terminals.scrollback(msg.id) }))
      } else if (msg.type === 'term:detach' && msg.id) ids.delete(msg.id)
      else if (msg.type === 'term:input' && msg.id && typeof msg.data === 'string' && ids.has(msg.id)) terminals.write(msg.id, msg.data)
      else if (msg.type === 'term:resize' && msg.id && ids.has(msg.id)) terminals.resize(msg.id, Number(msg.cols), Number(msg.rows))
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: (error as Error).message }))
    }
  })
  ws.on('close', () => attached.delete(ws))
})

function broadcast(predicate: (ids: Set<string>) => boolean, payload: unknown) {
  const text = JSON.stringify(payload)
  for (const [ws, ids] of attached) if (predicate(ids) && ws.readyState === ws.OPEN) ws.send(text)
}
terminals.on('data', (id: string, data: string) => broadcast((ids) => ids.has(id), { type: 'term:data', id, data }))
terminals.on('exit', (id: string, code: number) => broadcast((ids) => ids.has(id), { type: 'term:exit', id, code }))
sessions.on('change', (list) => broadcast(() => true, { type: 'sessions', sessions: list }))

// 127.0.0.1, not localhost: the address the user registers with the provider must match exactly
setRedirectUri(`http://127.0.0.1:${port}/oauth/callback`)
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE')
    console.error(`[helm] Port ${port} is in use by another process (maybe another Helm). Set HELM_PORT or "port" in ${CONFIG_PATH} to use a different port.`)
  else console.error(`[helm] Cannot listen on 127.0.0.1:${port}: ${error.message}`)
  process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/#token=${token}`
  console.log(`[helm] Command Deck ready â†’ ${url}`)
  console.log(`[helm] ${config.workspaces.length} workspace(s) configured in ${CONFIG_PATH}`)
  // TODO: open the browser unless --no-open (e.g. `open` package or platform command).
})

async function shutdown() {
  sessions.closeAll()
  terminals.killAll()
  await Promise.all([bridges.closeAll(), closeAllMcp()])
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
