// Client for the Helm local server (apps/helm/server/src/index.ts), over a Transport.
// The HTTP/WS transport takes its token from the URL fragment (#token=…), keeps it in
// sessionStorage for refresh and removes it from the address bar. Without a token, or
// when no server answers, Helm runs in offline mode on mock data.
import { useSyncExternalStore } from 'react'
import type { DbEngine, DbRows, DbWrite, FilesResult, HttpResult, TdtResult } from '@usetdt/helm-sdk'
import { brainGraph, cached, projectGraph, listProjects, unwrap, useLoad, type Loaded } from './tdt'
import { useState } from 'react'

export type ServerStatus = 'connecting' | 'online' | 'offline'
export type HostId = 'claude' | 'codex'

/** Mirrors server/src/sessions.ts */
export interface AgentSession {
  id: string
  workspaceId: string
  kind: 'chat' | 'build'
  host: HostId
  title: string
  prompt: string
  status: 'starting' | 'running' | 'waiting' | 'exited' | 'failed'
  terminalId: string | null
  task?: { projectId: string; taskId: string }
  startedAt: number
  endedAt: number | null
  exitCode: number | null
}

export interface ServerWorkspace {
  id: string
  name: string
  path: string
  profile: 'read-only' | 'everyday'
  tdt: boolean
}

export interface TdtStatus {
  platform: string
  tdt: { ok: boolean; command: string; version?: string; error?: string }
  pipx: { ok: boolean; version?: string }
}

export interface FolderListing {
  path: string
  home: string
  parent: string | null
  crumbs: { name: string; path: string }[]
  /** this folder is a TDT workspace */
  workspace: boolean
  empty: boolean
  folders: { name: string; path: string; workspace: boolean }[]
}

interface Snapshot {
  status: ServerStatus
  sessions: AgentSession[]
  workspaces: ServerWorkspace[]
  /** bumped when plugins change, so extension lists reload */
  extensionsVersion: number
}

function takeToken(): string | null {
  try {
    const m = location.hash.match(/token=([A-Za-z0-9]+)/)
    if (m) {
      sessionStorage.setItem('helm.token', m[1])
      history.replaceState(null, '', location.pathname + location.search)
      return m[1]
    }
    return sessionStorage.getItem('helm.token')
  } catch {
    return null
  }
}

export interface SocketHandlers {
  onOpen: () => void
  onMessage: (msg: any) => void
  onClose: () => void
}

/** A widget or tool bundle from a plugin enabled in the workspace, or from work/helm/. */
/** A database profile as the server shows it: never the password, only whether one is stored. */
export interface DbProfileView {
  name: string
  engine: DbEngine
  path?: string
  host?: string
  port?: number
  database?: string
  user?: string
  hasPassword: boolean
}
/** Add/replace a profile; omit `password` to keep the stored one, '' to clear it. */
export type DbProfileInput = Omit<DbProfileView, 'hasPassword'> & { password?: string }

/** A service profile for `http` connections; the token is write-only. */
export interface HttpProfileView {
  name: string
  baseUrl: string
  header: string
  scheme: 'bearer' | 'raw'
  /** token: a stored token; oauth2: sign-in through the declaring plugin's OAuth2 endpoints */
  auth: 'token' | 'oauth2'
  hasToken: boolean
  /** oauth2 only */
  clientId?: string
  hasClientSecret?: boolean
  oauth?: { connected: boolean; scopes: string[]; tokenUrl: string | null; refreshable: boolean }
}
/** Omit `token` / `clientSecret` to keep the stored one, '' to clear it. */
export type HttpProfileInput = Pick<HttpProfileView, 'name' | 'baseUrl' | 'header' | 'scheme' | 'auth'> & { token?: string; clientId?: string; clientSecret?: string }

/** An MCP server for `mcp` connections: a stdio command or an HTTP URL; the token is write-only. */
export interface McpServerView {
  name: string
  command?: string
  args?: string[]
  tokenEnv?: string
  url?: string
  hasToken: boolean
}
export type McpServerInput = Omit<McpServerView, 'hasToken'> & { token?: string }

/** An allowlisted local app (Settings → Local apps); Quick actions launch it by id. */
/** Agent usage limits (task 048): percent of the plan's window used; resetsAt in epoch ms. */
export interface UsageWindow {
  pct: number
  resetsAt: number | null
}
export interface HostUsage {
  host: HostId
  state: 'ok' | 'stale' | 'unavailable'
  reason?: string
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  updatedAt: number | null
}

/** Context window of one agent session (task 051): token counts only. */
export interface SessionContext {
  state: 'ok' | 'none'
  reason?: string
  used: number
  size: number
  pct: number
  updatedAt: number | null
}

export interface LocalAppView {
  id: string
  name: string
  command: string
  args: string[]
}

/** What Helm's write dialog shows, built by the server from the declaration (or the explorer's exact SQL). */
export type WriteSummary =
  | { kind: 'db-write'; actor: string; operation: string | null; profile: string; engine: DbEngine; sql: string; args: (string | number | boolean | null)[] }
  | { kind: 'explorer-writes'; actor: string; profile: string; engine: DbEngine }
  | { kind: 'http-write'; actor: string; connection: string; operation: string; service: string; method: string; url: string; body: unknown }
  | { kind: 'mcp-write'; actor: string; connection: string; operation: string; server: string; args: Record<string, unknown> }
  | { kind: 'files-write'; actor: string; connection: string; root: string; path: string; diff: { op: ' ' | '-' | '+'; line: number; text: string }[]; omitted: number }
/** A one-time, short-lived token for exactly the summarised action; spend it only after the user confirms. */
export interface WriteConfirmation {
  token: string
  summary: WriteSummary
}

export interface ServerExtension {
  key: string
  kind: 'widget' | 'tool'
  origin: { plugin: string } | 'generated'
  manifest: unknown
}

/** An installed plugin as the server sees it (manifests are validated by the caller). */
export interface ServerPlugin {
  name: string
  version: string
  spec: string
  linked: boolean
  contract: unknown
  supported: boolean
  bundles: { kind: 'widget' | 'tool' | 'theme'; dir: string; id: string; manifest?: unknown; error?: string; theme?: { tokens: Record<string, string>; chrome?: Record<string, string>; warnings: string[] } }[]
  problems: string[]
  digest: string
  approved: boolean
  enabledIn: string[]
}

/** A theme from an approved plugin (`GET /api/themes`): available in every workspace. */
export interface ServerTheme {
  /** data-theme value `<plugin>/<id>`; the rail sub-theme is `<key>:chrome` */
  key: string
  plugin: string
  name: string
  tagline: string
  tokens: Record<string, string>
  chrome?: Record<string, string>
  /** contrast pairs below WCAG AA */
  warnings: string[]
}

/** How the client reaches the Helm server. */
export interface Transport {
  /** false: no server to reach, the client stays offline */
  readonly available: boolean
  request<T>(method: string, path: string, body?: unknown): Promise<T>
  /** Opens the live socket; returns null when there is none. */
  socket(handlers: SocketHandlers): { send: (msg: unknown) => void } | null
}

/** REST + WebSocket to the local server, authenticated with the bearer token. */
export function httpTransport(token: string): Transport {
  return {
    available: true,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await fetch(path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      return res.json() as Promise<T>
    },
    socket({ onOpen, onMessage, onClose }) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`)
      ws.onopen = onOpen
      ws.onmessage = (ev) => onMessage(JSON.parse(String(ev.data)))
      ws.onclose = onClose
      return { send: (msg) => ws.send(JSON.stringify(msg)) }
    },
  }
}

/** No server: requests fail and Helm runs on mock data. */
export const offlineTransport: Transport = {
  available: false,
  request: () => Promise.reject(new Error('No Helm server token')),
  socket: () => null,
}

/** onReset runs before each scrollback replay (re-attach, reconnect) so output isn't written twice. */
type TermListener = { onData: (d: string) => void; onReset?: () => void; onExit: (code: number) => void }

export class HelmServer {
  private socket: { send: (msg: unknown) => void } | null = null
  private retry = 0
  private snapshot: Snapshot
  private listeners = new Set<() => void>()
  private terms = new Map<string, TermListener>()

  constructor(private transport: Transport) {
    this.snapshot = { status: transport.available ? 'connecting' : 'offline', sessions: [], workspaces: [], extensionsVersion: 0 }
    if (transport.available) void this.connect()
  }

  /* ── store plumbing for useSyncExternalStore ── */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snapshot
  private set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  get online() {
    return this.snapshot.status === 'online'
  }

  private async connect() {
    try {
      await this.request('GET', '/api/health')
      const workspaces = await this.request<ServerWorkspace[]>('GET', '/api/workspaces')
      this.set({ status: 'online', workspaces })
      this.openSocket()
    } catch {
      this.set({ status: 'offline' })
    }
  }

  private openSocket() {
    const socket = this.transport.socket({
      onOpen: () => {
        this.retry = 0
        for (const id of this.terms.keys()) socket?.send({ type: 'term:attach', id })
      },
      onMessage: (msg) => {
        if (msg.type === 'sessions') this.set({ sessions: msg.sessions })
        else if (msg.type === 'term:scrollback') {
          const t = this.terms.get(msg.id)
          t?.onReset?.()
          t?.onData(msg.data)
        } else if (msg.type === 'term:data') this.terms.get(msg.id)?.onData(msg.data)
        else if (msg.type === 'term:exit') this.terms.get(msg.id)?.onExit(msg.code)
      },
      onClose: () => {
        this.socket = null
        if (this.snapshot.status !== 'online') return
        // Back off up to 10s; the server may be restarting.
        const delay = Math.min(10000, 500 * 2 ** this.retry++)
        window.setTimeout(() => this.openSocket(), delay)
      },
    })
    this.socket = socket
  }

  request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.transport.request<T>(method, path, body)
  }

  /* ── TDT tools via the MCP bridge ── */
  callTool<T = unknown>(workspaceId: string, name: string, args: Record<string, unknown> = {}) {
    return this.request<TdtResult<T>>('POST', `/api/workspaces/${workspaceId}/tools/${name}`, args)
  }
  /** callTool, unwrapped: the data, or a TdtError carrying TDT's retry hint. */
  async tdt<T>(workspaceId: string, name: string, args: Record<string, unknown> = {}) {
    return unwrap(await this.callTool<T>(workspaceId, name, args))
  }
  projects(workspaceId: string) {
    return listProjects((ws, name, args) => this.callTool(ws, name, args), workspaceId)
  }
  brainGraph(workspaceId: string) {
    return brainGraph((ws, name, args) => this.callTool(ws, name, args), workspaceId)
  }
  projectGraph(workspaceId: string, projectId: string, limit?: number) {
    return projectGraph((ws, name, args) => this.callTool(ws, name, args), workspaceId, projectId, limit)
  }

  /** TDT tools the workspace's MCP profile exposes, with their read-only hint. */
  tdtTools(workspaceId: string) {
    return this.request<{ name: string; readOnly: boolean }[]>('GET', `/api/workspaces/${workspaceId}/tools`)
  }

  /* ── sandboxed extensions (manifests are validated by the caller) ── */
  extensions(workspaceId: string) {
    return this.request<{ extensions: ServerExtension[]; errors: { key: string; path: string; message: string }[] }>('GET', `/api/workspaces/${workspaceId}/extensions`)
  }
  /** One-time URL for an extension frame; `css` is the theme token CSS to start with. */
  /** A `files` connection call; the server checks it against the extension's manifest. `write` needs a confirmed `token`. */
  extensionFiles(workspaceId: string, body: { key: string; connection: string; operation: string; args: Record<string, unknown>; token?: string }) {
    return this.request<FilesResult>('POST', `/api/workspaces/${workspaceId}/extensions/files`, body)
  }
  /** A `db` connection call: a named query from the extension's manifest; write queries need a confirmed `token`. */
  extensionDb(workspaceId: string, body: { key: string; connection: string; operation: string; args: Record<string, unknown>; token?: string }) {
    return this.request<FilesResult<DbRows | DbWrite>>('POST', `/api/workspaces/${workspaceId}/extensions/db`, body)
  }
  /** Ask the server to prepare a declared write's confirmation (or refuse it): a one-time token and what Helm's dialog shows. */
  extensionConfirm(workspaceId: string, kind: 'db' | 'http' | 'mcp' | 'files', body: { key: string; connection: string; operation: string; args: Record<string, unknown> }) {
    return this.request<WriteConfirmation | FilesResult | HttpResult>('POST', `/api/workspaces/${workspaceId}/extensions/${kind}/confirm`, body)
  }
  /** An `http` connection call: a named call from the extension's manifest, sent by the server. Write calls need a confirmed `token`. */
  extensionHttp(workspaceId: string, body: { key: string; connection: string; operation: string; args: Record<string, unknown>; token?: string }) {
    return this.request<HttpResult>('POST', `/api/workspaces/${workspaceId}/extensions/http`, body)
  }
  /** An `mcp` connection call: a declared tool on a server configured in Helm. Write tools need a confirmed `token`. */
  extensionMcp(workspaceId: string, body: { key: string; connection: string; operation: string; args: Record<string, unknown>; token?: string }) {
    return this.request<FilesResult>('POST', `/api/workspaces/${workspaceId}/extensions/mcp`, body)
  }
  extensionFrame(workspaceId: string, body: { key: string; instance: string; css: string }) {
    return this.request<{ url: string }>('POST', `/api/workspaces/${workspaceId}/extensions/frame`, body)
  }

  /* ── service profiles and MCP servers (tokens are write-only) ── */
  httpProfiles() {
    return this.request<{ store: string; redirectUri: string; profiles: HttpProfileView[] }>('GET', '/api/http/profiles')
  }
  /** Start OAuth2 sign-in for a service profile with what this workspace's plugins declare; open `url` in a new window. */
  connectHttpProfile(workspaceId: string, name: string) {
    return this.request<{ url: string; scopes: string[] }>('POST', `/api/workspaces/${workspaceId}/http/profiles/${encodeURIComponent(name)}/connect`)
  }
  saveHttpProfile(body: HttpProfileInput) {
    return this.request<HttpProfileView>('POST', '/api/http/profiles', body)
  }
  removeHttpProfile(name: string) {
    return this.request<{ ok: true }>('DELETE', `/api/http/profiles/${encodeURIComponent(name)}`)
  }
  mcpServers() {
    return this.request<{ store: string; servers: McpServerView[] }>('GET', '/api/mcp/servers')
  }
  saveMcpServer(body: McpServerInput) {
    return this.request<McpServerView>('POST', '/api/mcp/servers', body)
  }
  removeMcpServer(name: string) {
    return this.request<{ ok: true }>('DELETE', `/api/mcp/servers/${encodeURIComponent(name)}`)
  }
  testMcpServer(name: string) {
    return this.request<FilesResult<{ tools: string[] }>>('POST', `/api/mcp/servers/${encodeURIComponent(name)}/test`)
  }

  /* ── agent usage limits (task 048) ── */
  usageLimits(focus = false) {
    return this.request<{ hosts: HostUsage[] }>('GET', `/api/usage/limits${focus ? '?focus=1' : ''}`)
  }

  sessionContext(wsId: string, sessionId: string) {
    return this.request<SessionContext>('GET', `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/context`)
  }

  /* ── local apps allowlist (task 045) ── */
  localApps() {
    return this.request<{ apps: LocalAppView[] }>('GET', '/api/apps')
  }
  saveLocalApp(body: LocalAppView) {
    return this.request<LocalAppView>('POST', '/api/apps', body)
  }
  removeLocalApp(id: string) {
    return this.request<{ ok: true }>('DELETE', `/api/apps/${encodeURIComponent(id)}`)
  }
  /** Start an allowlisted app; rejects with a message to show. */
  launchLocalApp(id: string) {
    return this.request<{ ok: true; name: string }>('POST', `/api/apps/${encodeURIComponent(id)}/launch`)
  }

  /* ── database profiles (passwords are write-only) ── */
  dbProfiles() {
    return this.request<{ store: string; profiles: DbProfileView[]; explorerWrites: string[] }>('GET', '/api/db/profiles')
  }
  saveDbProfile(body: DbProfileInput) {
    return this.request<DbProfileView>('POST', '/api/db/profiles', body)
  }
  removeDbProfile(name: string) {
    return this.request<{ ok: true }>('DELETE', `/api/db/profiles/${encodeURIComponent(name)}`)
  }
  testDbProfile(name: string) {
    return this.request<FilesResult<DbRows>>('POST', `/api/db/profiles/${encodeURIComponent(name)}/test`)
  }
  /** DB explorer: rows of (table_schema, table_name, column_name, data_type). */
  dbSchema(name: string) {
    return this.request<FilesResult<DbRows>>('GET', `/api/db/profiles/${encodeURIComponent(name)}/schema`)
  }
  /** DB explorer: one ad hoc statement, run read-only under the same caps as named queries. */
  dbQuery(name: string, sql: string) {
    return this.request<FilesResult<DbRows>>('POST', `/api/db/profiles/${encodeURIComponent(name)}/query`, { sql })
  }
  /** DB explorer: a confirmation for turning writes on (`enable`) or for one write statement (`sql`). */
  dbConfirm(name: string, body: { enable: true } | { sql: string }) {
    return this.request<WriteConfirmation>('POST', `/api/db/profiles/${encodeURIComponent(name)}/confirm`, body)
  }
  /** DB explorer: turn writes on with a confirmed token, or off. */
  dbSetWrites(name: string, enabled: boolean, token?: string) {
    return this.request<{ enabled: boolean }>('POST', `/api/db/profiles/${encodeURIComponent(name)}/writes`, { enabled, token })
  }
  /** DB explorer: one confirmed write statement. */
  dbWrite(name: string, sql: string, token: string) {
    return this.request<FilesResult<DbWrite>>('POST', `/api/db/profiles/${encodeURIComponent(name)}/write`, { sql, token })
  }

  /* ── plugins (installed per Helm, enabled per workspace) ── */
  themes() {
    return this.request<{ themes: ServerTheme[] }>('GET', '/api/themes')
  }
  plugins() {
    return this.request<{ plugins: ServerPlugin[] }>('GET', '/api/plugins')
  }
  private changed<T>(p: Promise<T>) {
    return p.then((v) => (this.set({ extensionsVersion: this.snapshot.extensionsVersion + 1 }), v))
  }
  installPlugin(spec: string) {
    return this.changed(this.request<ServerPlugin>('POST', '/api/plugins', { spec }))
  }
  removePlugin(name: string) {
    return this.changed(this.request<{ ok: boolean }>('DELETE', `/api/plugins/${encodeURIComponent(name)}`))
  }
  approvePlugin(name: string, digest: string) {
    return this.changed(this.request<ServerPlugin>('POST', `/api/plugins/${encodeURIComponent(name)}/approve`, { digest }))
  }
  setPluginEnabled(workspaceId: string, name: string, enabled: boolean) {
    return this.changed(this.request<ServerPlugin>('POST', `/api/workspaces/${workspaceId}/plugins/${encodeURIComponent(name)}`, { enabled }))
  }

  /** Resume a TDT UI interview (everyday profile) and get its private URL; open it, never store it. */
  openInterview(workspaceId: string, sessionId: string) {
    return this.request<{ url: string }>('POST', `/api/workspaces/${workspaceId}/interviews/${encodeURIComponent(sessionId)}/open`)
  }

  /* ── onboarding / add workspace (task 042) ── */
  tdtStatus() {
    return this.request<TdtStatus>('GET', '/api/onboarding/tdt')
  }
  installTdt() {
    return this.request<{ ok: boolean; output: string; pathChanged: boolean; tdtCommand?: string }>('POST', '/api/onboarding/tdt/install')
  }
  listFolder(path?: string) {
    return this.request<FolderListing>('POST', '/api/onboarding/folders/list', { path })
  }
  createFolder(parent: string, name: string) {
    return this.request<{ path: string }>('POST', '/api/onboarding/folders/create', { parent, name })
  }
  /** Register (or with `init`, create) a workspace; the new list is live at once. */
  async addWorkspace(input: { path: string; name?: string; init?: boolean }) {
    const r = await this.request<{ workspace: ServerWorkspace; created: boolean; output: string }>('POST', '/api/workspaces', input)
    if (!this.snapshot.workspaces.some((w) => w.id === r.workspace.id)) this.set({ workspaces: [...this.snapshot.workspaces, r.workspace] })
    return r
  }

  /* ── sessions ── */
  handoff(workspaceId: string, prompt: string, host?: HostId) {
    return this.request<AgentSession>('POST', `/api/workspaces/${workspaceId}/sessions/handoff`, { prompt, host })
  }
  build(workspaceId: string, input: { projectId: string; taskId: string; host?: HostId }) {
    return this.request<AgentSession>('POST', `/api/workspaces/${workspaceId}/sessions/build`, input)
  }
  /** The task's workspace handoff (Markdown), or null when the build skill hasn't written one. */
  async taskHandoff(workspaceId: string, projectId: string, taskId: string) {
    const r = await this.request<{ markdown: string | null }>(
      'GET', `/api/workspaces/${workspaceId}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/handoff`)
    return r.markdown
  }

  /* ── terminals ── */
  spawnTerminal(workspaceId: string, cwd?: string) {
    return this.request<{ id: string; cwd: string; title: string }>('POST', `/api/workspaces/${workspaceId}/terminals`, { cwd })
  }
  attachTerminal(id: string, listener: TermListener) {
    this.terms.set(id, listener)
    this.socket?.send({ type: 'term:attach', id })
    return {
      write: (data: string) => this.socket?.send({ type: 'term:input', id, data }),
      resize: (cols: number, rows: number) => this.socket?.send({ type: 'term:resize', id, cols, rows }),
      detach: () => {
        this.terms.delete(id)
        this.socket?.send({ type: 'term:detach', id })
      },
    }
  }
}

const token = takeToken()
export const server = new HelmServer(token ? httpTransport(token) : offlineTransport)

export function useServer() {
  return useSyncExternalStore(server.subscribe, server.getSnapshot)
}

export * from './tdt'
export * as offline from './offline'
export type { Note, Project, Workspace } from './offline'

/**
 * Shared, cached server data for widgets: `fetch` runs only online (workspaceId set).
 * Results are shared between widgets for 30 s; `reload` bypasses the cache.
 */
export function useServerData<T>(workspaceId: string | undefined, key: string, fetch: (ws: string) => Promise<T>): Loaded<T> {
  const [fresh, setFresh] = useState(0)
  const load = useLoad(workspaceId ? `${workspaceId}:${key}:${fresh}` : undefined, () => cached(`${workspaceId}:${key}`, () => fetch(workspaceId!), fresh > 0))
  return { ...load, reload: () => setFresh((n) => n + 1) }
}

/** A TDT tool result for widgets (cached like useServerData). */
export function useTdt<T>(workspaceId: string | undefined, tool: string, args: Record<string, unknown> = {}) {
  return useServerData<T>(workspaceId, `${tool}:${JSON.stringify(args)}`, (ws) => server.tdt<T>(ws, tool, args))
}
