// `mcp` connections (packages/sdk/docs/connection.md#mcp): MCP servers the user configures in Helm
// (a stdio command, or an HTTP URL). Extensions name a server and may call only the tool names
// their manifest declares; results go back as untrusted data. A server's token (optional) is a
// bearer header for HTTP servers, or one environment variable for stdio servers. Tools listed in
// `writes` run only with a one-time token from Helm's confirmation flow (confirm.ts).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SERVICE_NAME, type FilesResult } from '@usetdt/helm-sdk'
import { HELM_VERSION, readHelmFile, writeHelmFile, type WorkspaceEntry } from './config.js'
import { digest, issue, spend } from './confirm.js'
import { ApiError } from './errors.js'
import { declaration } from './extensions.js'
import { checkBaseUrl } from './http.js'
import { deleteSecret, getSecret, secretStore, setSecret } from './secrets.js'

export const TIMEOUT_MS = 30_000
export const MAX_BYTES = 1024 * 1024

export type McpServer = { command: string; args: string[]; tokenEnv?: string } | { url: string }
const FILE = 'mcp.json'
const account = (name: string) => `mcp:${name}`
const fail = (code: string, message: string): FilesResult => ({ ok: false, data: null, error: { code, message } })
const readServers = () => readHelmFile<McpServer>(FILE, 'servers')

/** Servers as the browser sees them: no token, only whether one is stored. */
export function listMcpServers() {
  return {
    store: secretStore(),
    servers: Object.entries(readServers())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, s]) => ({ name, ...s, hasToken: getSecret(account(name)) !== undefined })),
  }
}

/** Add or replace a server. `token` undefined keeps a stored one; '' clears it. */
export function saveMcpServer(input: Record<string, unknown>) {
  const name = String(input.name ?? '')
  if (!SERVICE_NAME.test(name)) throw new ApiError(400, `Name must match ${SERVICE_NAME.source} (lowercase, digits, - and _)`)
  let server: McpServer
  if (typeof input.url === 'string' && input.url.trim()) server = { url: checkBaseUrl(input.url) }
  else {
    const command = String(input.command ?? '').trim()
    if (!command || command.length > 1024 || /[\0\r\n]/.test(command)) throw new ApiError(400, 'Give a command (for example npx) or a URL')
    const args = input.args === undefined ? [] : input.args
    if (!Array.isArray(args) || args.length > 64 || !args.every((a) => typeof a === 'string' && a.length <= 4096 && !/[\0\r\n]/.test(a))) throw new ApiError(400, 'Arguments must be a list of up to 64 one-line strings')
    const tokenEnv = typeof input.tokenEnv === 'string' && input.tokenEnv.trim() ? input.tokenEnv.trim() : undefined
    if (tokenEnv !== undefined && !/^[A-Z_][A-Z0-9_]{0,63}$/.test(tokenEnv)) throw new ApiError(400, 'Token variable must be an environment variable name such as GITHUB_TOKEN')
    server = { command, args: args as string[], ...(tokenEnv ? { tokenEnv } : {}) }
  }
  if (typeof input.token === 'string' && (input.token.length > 8192 || /[\r\n\0]/.test(input.token))) throw new ApiError(400, 'Token must be one line, up to 8192 characters')
  const servers = readServers()
  servers[name] = server
  writeHelmFile(FILE, 'servers', servers)
  if (typeof input.token === 'string') input.token ? setSecret(account(name), input.token) : deleteSecret(account(name))
  void disconnect(name)
  return listMcpServers().servers.find((s) => s.name === name)!
}

export function removeMcpServer(name: string) {
  const servers = readServers()
  if (!servers[name]) throw new ApiError(404, `No MCP server "${name}"`)
  delete servers[name]
  writeHelmFile(FILE, 'servers', servers)
  deleteSecret(account(name))
  void disconnect(name)
  return { ok: true }
}

/* ── clients: one per configured server, started on first use ─────────────── */
const clients = new Map<string, Promise<Client>>()

async function disconnect(name: string) {
  const c = clients.get(name)
  clients.delete(name)
  await c?.then((x) => x.close()).catch(() => {})
}

export const closeAllMcp = () => Promise.allSettled([...clients.keys()].map(disconnect))

function connect(name: string, server: McpServer) {
  let c = clients.get(name)
  if (!c) {
    const token = getSecret(account(name))
    const transport =
      'url' in server
        ? new StreamableHTTPClientTransport(new URL(server.url), token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined)
        : new StdioClientTransport({
            command: server.command, args: server.args, stderr: 'ignore',
            // the safe default environment (PATH, HOME…), plus the token in its one named variable
            env: { ...getDefaultEnvironment(), ...(server.tokenEnv && token ? { [server.tokenEnv]: token } : {}) },
          })
    const client = new Client({ name: 'helm', version: HELM_VERSION })
    transport.onclose = () => void (clients.get(name) === c && clients.delete(name)) // reconnect lazily next time
    c = client.connect(transport).then(() => client)
    c.catch(() => clients.get(name) === c && clients.delete(name))
    clients.set(name, c)
  }
  return c
}

function withTimeout<T>(p: Promise<T>, what: string) {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([p, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`${what} did not answer within ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS)))]).finally(() => clearTimeout(timer))
}

/** Start (or reuse) a server and list its tool names, so setup can say whether it works. */
export async function testMcpServer(name: string): Promise<FilesResult<{ tools: string[] }>> {
  const server = readServers()[name]
  if (!server) return fail('not_found', `No MCP server "${name}"`) as FilesResult<{ tools: string[] }>
  try {
    const client = await withTimeout(connect(name, server), `MCP server "${name}"`)
    const { tools } = await withTimeout(client.listTools(), `MCP server "${name}"`)
    return { ok: true, data: { tools: tools.map((t) => t.name).sort() }, error: null }
  } catch (e) {
    void disconnect(name)
    return fail('unavailable', (e as Error).message) as FilesResult<{ tools: string[] }>
  }
}

/* ── extension calls ─────────────────────────────────────────────────────── */
type CallBody = { key?: unknown; connection?: unknown; operation?: unknown; args?: unknown; token?: unknown }
/** What Helm's dialog shows for an mcp write tool call. */
export type McpWriteSummary = { kind: 'mcp-write'; actor: string; connection: string; operation: string; server: string; args: Record<string, unknown> }
type Resolved = { name: string; server: McpServer; op: string; args: Record<string, unknown>; write: boolean; summary: McpWriteSummary; binding: unknown[] }

function resolve(ws: WorkspaceEntry, body: CallBody): Resolved | FilesResult {
  const { decl, actor, key, mayWrite } = declaration(ws, body.key, body.connection, 'mcp')
  if (!decl) return fail('refused', `"${String(body.connection)}" is not an mcp connection in this extension's manifest`)
  const op = String(body.operation)
  const write = Array.isArray(decl.writes) && decl.writes.includes(op)
  if (!write && !(Array.isArray(decl.operations) && decl.operations.includes(op))) return fail('refused', `"${String(decl.id)}.${op}" is not declared in this extension's manifest`)
  if (write && !mayWrite) return fail('refused', `Tool "${op}" writes, but the manifest does not declare permissions.write`)
  if (typeof decl.server !== 'string' || !SERVICE_NAME.test(decl.server)) return fail('refused', `Connection "${String(decl.id)}" has an invalid server`)
  const server = readServers()[decl.server]
  if (!server) return fail('not_configured', `No MCP server "${decl.server}". Add it in Settings → Connections.`)
  const args = (typeof body.args === 'object' && body.args && !Array.isArray(body.args) ? body.args : {}) as Record<string, unknown>
  const id = String(decl.id)
  return {
    name: decl.server, server, op, args, write,
    summary: { kind: 'mcp-write', actor, connection: id, operation: op, server: decl.server, args },
    // bound to the server's current config too, so a server changed after confirming can't spend it
    binding: ['mcp', ws.id, key, id, op, decl.server, digest(server), digest(args)],
  }
}

/** A one-time token for one declared write tool call with exactly these args, and what Helm's dialog shows. */
export function mcpConfirm(ws: WorkspaceEntry, body: CallBody): { token: string; summary: McpWriteSummary } | FilesResult {
  const r = resolve(ws, body)
  if ('ok' in r) return r
  if (!r.write) return fail('refused', `"${r.op}" is a read tool; it needs no confirmation`)
  return { token: issue(r.binding), summary: r.summary }
}

/** One declared tool call; returns `{ ok, data: CallToolResult, error }` (ok is false when the tool reports isError). */
export async function mcpCall(ws: WorkspaceEntry, body: CallBody): Promise<FilesResult> {
  const r = resolve(ws, body)
  if ('ok' in r) return r
  if (r.write && !spend(body.token, r.binding)) return fail('confirmation_required', 'This write was not confirmed in Helm, or its confirmation expired; nothing ran. Try again.')
  const { name, server, op, args } = r
  try {
    const client = await withTimeout(connect(name, server), `MCP server "${name}"`)
    const result = await withTimeout(client.callTool({ name: op, arguments: args }), `Tool "${op}"`)
    if (JSON.stringify(result).length > MAX_BYTES) return fail('too_large', `The tool result is larger than ${MAX_BYTES / 1024} KiB`)
    return { ok: result.isError !== true, data: result, error: result.isError ? { code: 'tool_error', message: `Tool "${op}" reported an error` } : null }
  } catch (e) {
    return fail('unavailable', (e as Error).message)
  }
}
