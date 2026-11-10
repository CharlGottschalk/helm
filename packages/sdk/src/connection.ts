// Connection contract v1 (contracts/connection.md).

export type ConnectionDecl =
  | { id: string; kind: 'tdt-mcp'; operations: string[] }
  | { id: string; kind: 'mcp'; server: string; operations: string[]; writes?: string[] }
  | { id: string; kind: 'http'; service: string; calls: Record<string, HttpCall>; oauth2?: HttpOAuth2 }
  | { id: string; kind: 'files'; root: 'project' | 'workspace'; paths: string[]; operations: FilesOperation[] }
  | { id: string; kind: 'db'; service: string; engine: DbEngine; queries: Record<string, DbQuery> }

/** Database engines a `db` connection can target (connection.md#db). */
export type DbEngine = 'sqlite' | 'postgres' | 'mysql'
export const DB_ENGINES: readonly DbEngine[] = ['sqlite', 'postgres', 'mysql']

/**
 * A named query. `sql` uses the engine's own positional placeholders
 * (`?` for sqlite/mysql, `$1`… for postgres); `params` names the call args bound to them, in order.
 * Queries are read-only unless `write: true` (the manifest then needs `permissions.write`, and the
 * user confirms every call in a Helm dialog).
 */
export interface DbQuery {
  sql: string
  params?: string[]
  write?: boolean
}

/** Result of a `write: true` query. */
export interface DbWrite {
  rowsAffected: number
}

/** `db` results: `{ columns, rows }` with each row an array in column order; `truncated` is never set (caps are errors). */
export interface DbRows {
  columns: string[]
  rows: unknown[][]
}

/**
 * A named `http` call (connection.md#http). `{name}` placeholders in `path` and `query` values are
 * filled from the call args (URL-encoded); in `body`, a string that is exactly `"{name}"` becomes
 * that arg's value and every other string is sent as written (so GraphQL braces are safe).
 * A read call is GET, or POST with a declared `body` (e.g. a GraphQL query). A call with
 * `write: true` may also be PUT, PATCH or DELETE; the manifest then needs `permissions.write`,
 * and the user confirms every call in a Helm dialog.
 */
export interface HttpCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string>
  body?: unknown
  write?: boolean
}

/**
 * OAuth2 sign-in for an `http` connection (connection.md#oauth2): authorization code + PKCE, run
 * by Helm. The user's own client id/secret live in the service profile; Helm sends a call only
 * when the profile's grant came from this `tokenUrl` and covers every scope listed here.
 * `authorizeUrl` may carry provider-specific query parameters (e.g. to ask for a refresh token).
 */
export interface HttpOAuth2 {
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
}

/** One OAuth2 scope token (RFC 6749 §3.3). */
export const OAUTH_SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]{1,256}$/

/** Why `raw` can't be an OAuth2 endpoint (https, or http on this machine; no credentials or fragment; a query only when allowed), or null. */
export function oauthUrlProblem(raw: unknown, allowQuery: boolean): string | null {
  let u: URL
  try {
    u = new URL(String(raw))
  } catch {
    return 'must be a full URL'
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return 'must use https (http only for 127.0.0.1 or localhost)'
  if (u.username || u.password || u.hash || (!allowQuery && u.search)) return allowQuery ? 'must not contain credentials or a fragment' : 'must not contain credentials, a query or a fragment'
  return null
}

/** Problems with an `oauth2` declaration; empty when it is valid. */
export function lintOAuth2(o: unknown): string[] {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return ['"oauth2" must be an object']
  const x = o as Record<string, unknown>
  const p: string[] = []
  if (Object.keys(x).some((k) => !['authorizeUrl', 'tokenUrl', 'scopes'].includes(k))) p.push('"oauth2" may only have authorizeUrl, tokenUrl and scopes')
  const a = oauthUrlProblem(x.authorizeUrl, true)
  if (a) p.push(`"oauth2.authorizeUrl" ${a}`)
  const t = oauthUrlProblem(x.tokenUrl, false)
  if (t) p.push(`"oauth2.tokenUrl" ${t}`)
  if (!Array.isArray(x.scopes) || x.scopes.length > 32 || !x.scopes.every((v) => typeof v === 'string' && OAUTH_SCOPE.test(v)))
    p.push('"oauth2.scopes" must list up to 32 scopes (no spaces or quotes)')
  return p
}

/** Methods an `http` call may use: reads are GET or POST, writes POST, PUT, PATCH or DELETE. */
export const HTTP_WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE']

/** `http` results: `{ ok, status, data, error }`, JSON bodies only. */
export interface HttpResult<T = unknown> {
  ok: boolean
  status: number | null
  data: T | null
  error: { code: string; message: string } | null
}

/** `{name}` placeholders in an http path or query template. */
export const HTTP_PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]{0,31})\}/g

/** Profile, service and MCP server names shared by `db`, `http` and `mcp` connections. */
export const SERVICE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const DB_PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/

/**
 * File access (connection.md#files). The plugin parses what it reads. `write` replaces one
 * existing declared file when `expected_sha256` matches it; it needs `permissions.write`, and the
 * user confirms every call in a Helm dialog.
 */
export type FilesOperation = 'list' | 'read' | 'write'

/** Result of a `files` `write`: the path and the new content's sha256. */
export interface FilesWrite {
  path: string
  sha256: string
}

/** `files` and `db` results: `list` → `{ files: { path, size }[] }`, `read` → `{ path, text }`; db reads → `DbRows`, writes → `DbWrite`. */
export interface FilesResult<T = unknown> {
  ok: boolean
  data: T | null
  error: { code: string; message: string } | null
}

/**
 * Is `glob` a valid `files` path pattern? Relative, `/`-separated, no `.`/`..` segments;
 * `*` and `?` match within a segment, a `**` segment matches any number of segments.
 */
export function validGlob(glob: string) {
  return /^[A-Za-z0-9_.*?@+-]+(\/[A-Za-z0-9_.*?@+-]+)*$/.test(glob) && !glob.split('/').some((s) => s === '.' || s === '..' || (s.includes('**') && s !== '**'))
}

/** Does relative path `path` match `glob`? (see validGlob) */
export function matchesGlob(glob: string, path: string) {
  const re = glob
    .split('/')
    .map((seg) => (seg === '**' ? '(?:[^/]+/)*' : seg.replace(/[.+@-]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '/'))
    .join('')
  return new RegExp(`^${re}$`).test(path + '/')
}

/** TDT's response envelope, passed through unchanged by the Helm server. */
export interface TdtResult<T = unknown> {
  api_version: 1
  ok: boolean
  data: T | null
  coverage: { truncated: boolean; omissions: string[] }
  warnings: string[]
  error: { code: string; message: string; retry: 'safe' | 'reread' | 'inspect_outcome' } | null
}

/** Is `operation` a declared write (it then needs the user's confirmation in Helm)? */
export function isWrite(decls: ConnectionDecl[] = [], connectionId: string, operation: string) {
  const c = decls.find((d) => d.id === connectionId)
  if (!c) return false
  if (c.kind === 'db') return Object.prototype.hasOwnProperty.call(c.queries, operation) && c.queries[operation]?.write === true
  if (c.kind === 'http') return Object.prototype.hasOwnProperty.call(c.calls, operation) && c.calls[operation]?.write === true
  if (c.kind === 'mcp') return c.writes?.includes(operation) === true
  if (c.kind === 'files') return operation === 'write' && c.operations.includes('write')
  return false
}

/** Allowlist check: may this extension call `operation` on connection `connectionId`? */
export function allowed(decls: ConnectionDecl[] = [], connectionId: string, operation: string) {
  const c = decls.find((d) => d.id === connectionId)
  if (!c) return false
  if (c.kind === 'http') return Object.prototype.hasOwnProperty.call(c.calls, operation)
  if (c.kind === 'db') return Object.prototype.hasOwnProperty.call(c.queries, operation)
  if (c.kind === 'mcp' && c.writes?.includes(operation)) return true
  return (c.operations as string[]).includes(operation)
}
