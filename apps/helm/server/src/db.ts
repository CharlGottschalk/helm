// `db` connections (packages/sdk/docs/connection.md#db): named queries an extension's manifest
// declares, run against a database profile the user configured in Helm. The server looks up the
// declaration and the profile itself; passwords never leave it. Reads: SQLite opens read-only,
// Postgres and MySQL run inside read-only transactions. Writes (`write: true` queries and DB
// explorer writes) need a one-time confirmation token (confirm.ts) and run read-write for that call.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import mysql from 'mysql2'
import pg from 'pg'
import { DB_ENGINES, DB_PARAM_NAME, SERVICE_NAME, type DbEngine, type DbRows, type DbWrite, type FilesResult } from '@usetdt/helm-sdk'
import { HELM_HOME, type WorkspaceEntry } from './config.js'
import { ApiError } from './errors.js'
import { digest, issue, spend } from './confirm.js'
import { listExtensions } from './extensions.js'
import { deleteSecret, getSecret, secretStore, setSecret } from './secrets.js'

export const TIMEOUT_MS = 5000
export const MAX_ROWS = 1000
export const MAX_BYTES = 1024 * 1024

export type DbProfile =
  | { engine: 'sqlite'; path: string }
  | ServerProfile
type ServerProfile = { engine: 'postgres' | 'mysql'; host: string; port: number; database: string; user: string }

type Result = FilesResult<DbRows | DbWrite>
/** What Helm's write dialog shows; built here from the declaration, never from the browser's or extension's text. */
export type WriteSummary =
  | { kind: 'db-write'; actor: string; operation: string | null; profile: string; engine: DbEngine; sql: string; args: Value[] }
  | { kind: 'explorer-writes'; actor: string; profile: string; engine: DbEngine }
type Value = string | number | boolean | null
const fail = (code: string, message: string): Result => ({ ok: false, data: null, error: { code, message } })
class QueryError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

/* ── profiles: ~/.helm/db.json (no secrets), passwords in secrets.ts ───────── */
const FILE = () => join(HELM_HOME, 'db.json')
const account = (name: string) => `db:${name}`

function readProfiles(): Record<string, DbProfile> {
  if (!existsSync(FILE())) return {}
  try {
    return JSON.parse(readFileSync(FILE(), 'utf8')).profiles ?? {}
  } catch {
    throw new ApiError(500, `${FILE()} is unreadable; fix or remove it`)
  }
}

function writeProfiles(profiles: Record<string, DbProfile>) {
  mkdirSync(HELM_HOME, { recursive: true, mode: 0o700 })
  const tmp = `${FILE()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ profiles }, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, FILE())
}

/** Profiles as the browser and CLI see them: no password, only whether one is stored. */
export function listProfiles() {
  return {
    store: secretStore(),
    profiles: Object.entries(readProfiles())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, p]) => ({ name, ...p, hasPassword: p.engine !== 'sqlite' && getSecret(account(name)) !== undefined })),
  }
}

const text = (v: unknown, what: string, max = 255) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\0\r\n]/.test(v)) throw new ApiError(400, `${what} is required (one line, up to ${max} characters)`)
  return v.trim()
}

/** Add or replace a profile. `password` undefined keeps a stored one; '' clears it. */
export function saveProfile(input: Record<string, unknown>) {
  const name = String(input.name ?? '')
  if (!SERVICE_NAME.test(name)) throw new ApiError(400, `Name must match ${SERVICE_NAME.source} (lowercase, digits, - and _)`)
  const engine = input.engine as DbEngine
  if (!DB_ENGINES.includes(engine)) throw new ApiError(400, `Engine must be one of ${DB_ENGINES.join(', ')}`)
  let profile: DbProfile
  if (engine === 'sqlite') {
    const path = text(input.path, 'File path', 4096)
    if (!isAbsolute(path)) throw new ApiError(400, 'File path must be absolute')
    if (!existsSync(path) || !statSync(path).isFile()) throw new ApiError(400, `${path} is not a file`)
    profile = { engine, path }
  } else {
    const port = Number(input.port ?? (engine === 'postgres' ? 5432 : 3306))
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError(400, 'Port must be 1–65535')
    const host = text(input.host, 'Host')
    if (/\s/.test(host)) throw new ApiError(400, 'Host must not contain spaces')
    profile = { engine, host, port, database: text(input.database, 'Database'), user: text(input.user, 'User') }
  }
  const profiles = readProfiles()
  profiles[name] = profile
  writeProfiles(profiles)
  explorerWrites.delete(name) // a changed profile may point elsewhere: confirm writes again
  if (engine === 'sqlite') deleteSecret(account(name))
  else if (typeof input.password === 'string') input.password ? setSecret(account(name), input.password) : deleteSecret(account(name))
  return listProfiles().profiles.find((p) => p.name === name)!
}

export function removeProfile(name: string) {
  const profiles = readProfiles()
  if (!profiles[name]) throw new ApiError(404, `No database profile "${name}"`)
  delete profiles[name]
  writeProfiles(profiles)
  explorerWrites.delete(name)
  deleteSecret(account(name))
  return { ok: true }
}

/** Connect and run a trivial read-only query, so setup can say whether the profile works. */
export async function testProfile(name: string): Promise<Result> {
  const profile = readProfiles()[name]
  if (!profile) return fail('not_found', `No database profile "${name}"`)
  return run(name, profile, 'SELECT 1 AS ok', [])
}

/* ── DB explorer: the built-in tool's routes; plugins can't reach them (they only get dbCall) ── */
const MAX_SQL = 16 * 1024
// one row per column; views included. Larger cap than ad hoc queries, the 1 MiB cap still applies.
const SCHEMA_ROWS = 10 * MAX_ROWS // ponytail: very large schemas hit too_many_rows; page by schema if that happens
const SCHEMA_SQL: Record<DbEngine, string> = {
  sqlite: `SELECT '' AS table_schema, m.name AS table_name, p.name AS column_name, p.type AS data_type
    FROM sqlite_schema m JOIN pragma_table_info(m.name) p
    WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid`,
  postgres: `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position`,
  mysql: `SELECT table_schema AS table_schema, table_name AS table_name, column_name AS column_name, data_type AS data_type
    FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`,
}

const profileOr404 = (name: string) => {
  const profile = readProfiles()[name]
  if (!profile) throw new ApiError(404, `No database profile "${name}"`)
  return profile
}

/** Tables and columns of a profile's database, as rows of (schema, table, column, type). */
export async function exploreSchema(name: string): Promise<Result> {
  const profile = profileOr404(name)
  return run(name, profile, SCHEMA_SQL[profile.engine], [], SCHEMA_ROWS)
}

/** One ad hoc statement, with the same read-only guards and caps as named queries. */
export async function exploreQuery(name: string, body: { sql?: unknown }): Promise<Result> {
  const profile = profileOr404(name)
  const sql = body.sql
  if (typeof sql !== 'string' || !sql.trim()) return fail('refused', 'Type a SQL statement to run')
  if (sql.length > MAX_SQL) return fail('refused', `SQL is longer than ${MAX_SQL / 1024} KiB`)
  return run(name, profile, sql, [])
}

// Explorer writes have no extension or named operation: tokens bind to the profile and the exact SQL.
// The per-profile toggle lasts until Helm restarts, the profile changes or the user turns it off.
const explorerWrites = new Set<string>()
export const explorerWritesOn = () => [...explorerWrites].sort()
const explorerSql = (sql: unknown) => {
  if (typeof sql !== 'string' || !sql.trim()) throw new ApiError(400, 'Type a SQL statement to run')
  if (sql.length > MAX_SQL) throw new ApiError(400, `SQL is longer than ${MAX_SQL / 1024} KiB`)
  return sql
}

/** A token for turning explorer writes on (`enable`), or for one explorer write statement (`sql`). */
export function exploreConfirm(name: string, body: { enable?: unknown; sql?: unknown }): { token: string; summary: WriteSummary } {
  const profile = profileOr404(name)
  if (body.enable === true)
    return { token: issue(['explorer-writes', name]), summary: { kind: 'explorer-writes', actor: 'DB explorer', profile: name, engine: profile.engine } }
  const sql = explorerSql(body.sql)
  if (!explorerWrites.has(name)) throw new ApiError(409, `Writes are off for "${name}"; turn them on first`)
  return { token: issue(['explorer', name, digest(sql)]), summary: { kind: 'db-write', actor: 'DB explorer', operation: null, profile: name, engine: profile.engine, sql, args: [] } }
}

/** Turn explorer writes on (needs a confirmed token) or off (never needs one). */
export function setExplorerWrites(name: string, body: { enabled?: unknown; token?: unknown }) {
  profileOr404(name)
  if (body.enabled !== true) explorerWrites.delete(name)
  else if (spend(body.token, ['explorer-writes', name])) explorerWrites.add(name)
  else throw new ApiError(403, 'Turning on writes needs your confirmation in Helm')
  return { enabled: explorerWrites.has(name) }
}

/** One confirmed ad hoc write statement, read-write for this call only. */
export async function exploreWrite(name: string, body: { sql?: unknown; token?: unknown }): Promise<Result> {
  const profile = profileOr404(name)
  const sql = explorerSql(body.sql)
  if (!explorerWrites.has(name)) return fail('refused', `Writes are off for "${name}"; turn them on first`)
  if (!spend(body.token, ['explorer', name, digest(sql)])) return fail('confirmation_required', 'This write was not confirmed in Helm, or its confirmation expired; nothing ran. Try again.')
  return run(name, profile, sql, [], MAX_ROWS, true)
}

/* ── extension calls ─────────────────────────────────────────────────────── */
type Decl = { id?: unknown; kind?: unknown; service?: unknown; engine?: unknown; queries?: unknown }
type CallBody = { key?: unknown; connection?: unknown; operation?: unknown; args?: unknown; token?: unknown }
type Resolved = { name: string; profile: DbProfile; sql: string; values: Value[]; write: boolean; actor: string; binding: unknown[] }

/** The extension's own declaration, its profile and the bound values for one call; a failed Result when refused. */
function resolveCall(ws: WorkspaceEntry, body: CallBody): Resolved | Result {
  const ext = listExtensions(ws).extensions.find((e) => e.key === body.key)
  if (!ext) throw new ApiError(404, 'Unknown extension')
  const manifest = ext.manifest as { name?: unknown; connections?: Decl[]; permissions?: { write?: unknown } }
  const decl = (manifest.connections ?? []).find((c) => c?.id === body.connection)
  if (!decl || decl.kind !== 'db') return fail('refused', `"${String(body.connection)}" is not a db connection in this extension's manifest`)
  const queries = (typeof decl.queries === 'object' && decl.queries) || {}
  const op = String(body.operation)
  const q = Object.prototype.hasOwnProperty.call(queries, op) ? (queries as Record<string, { sql?: unknown; params?: unknown; write?: unknown }>)[op] : undefined
  if (!q || typeof q.sql !== 'string' || !q.sql.trim()) return fail('refused', `"${String(decl.id)}.${op}" is not declared in this extension's manifest`)
  const write = q.write === true
  if (write && manifest.permissions?.write !== true) return fail('refused', `Query "${op}" writes, but the manifest does not declare permissions.write`)
  const names = q.params === undefined ? [] : q.params
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string' && DB_PARAM_NAME.test(n))) return fail('refused', `Query "${op}" has invalid params`)
  if (typeof decl.service !== 'string' || !SERVICE_NAME.test(decl.service)) return fail('refused', `Connection "${String(decl.id)}" has an invalid service`)
  const profile = readProfiles()[decl.service]
  if (!profile) return fail('not_configured', `No database profile "${decl.service}". Add it in Settings → Connections or with \`helm db add ${decl.service}\`.`)
  if (profile.engine !== decl.engine) return fail('refused', `Profile "${decl.service}" is ${profile.engine}, but this connection expects ${String(decl.engine)}`)
  const args = (typeof body.args === 'object' && body.args && !Array.isArray(body.args) ? body.args : {}) as Record<string, unknown>
  const values: Value[] = []
  for (const n of names) {
    const v = args[n]
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) return fail('refused', `Argument "${n}" must be a string, number, boolean or null`)
    if (typeof v === 'string' && v.length > 4096) return fail('refused', `Argument "${n}" is longer than 4096 characters`)
    values.push(v as Value)
  }
  const actor = typeof manifest.name === 'string' ? manifest.name : String(body.key)
  return { name: decl.service, profile, sql: q.sql, values, write, actor, binding: ['db', ws.id, ext.key, decl.id, op, q.sql, digest(values)] }
}

export async function dbCall(ws: WorkspaceEntry, body: CallBody): Promise<Result> {
  const r = resolveCall(ws, body)
  if ('ok' in r) return r
  if (r.write && !spend(body.token, r.binding)) return fail('confirmation_required', 'This write was not confirmed in Helm, or its confirmation expired; nothing ran. Try again.')
  return run(r.name, r.profile, r.sql, r.values, MAX_ROWS, r.write)
}

/** A one-time token for one declared write call with exactly these args, and what Helm's dialog shows. */
export function dbConfirm(ws: WorkspaceEntry, body: CallBody): { token: string; summary: WriteSummary } | Result {
  const r = resolveCall(ws, body)
  if ('ok' in r) return r
  if (!r.write) return fail('refused', `"${String(body.operation)}" is a read query; it needs no confirmation`)
  return { token: issue(r.binding), summary: { kind: 'db-write', actor: r.actor, operation: String(body.operation), profile: r.name, engine: r.profile.engine, sql: r.sql, args: r.values } }
}

/* ── drivers ─────────────────────────────────────────────────────────────── */
async function run(name: string, profile: DbProfile, sql: string, values: Value[], maxRows = MAX_ROWS, write = false): Promise<Result> {
  let cancel = () => {}
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => (cancel(), reject(new QueryError('timeout', `The query took longer than ${TIMEOUT_MS / 1000} s and was stopped`))), TIMEOUT_MS)
  })
  try {
    const job =
      profile.engine === 'sqlite' ? sqlite(profile.path, sql, values, maxRows, write, (c) => (cancel = c))
      : profile.engine === 'postgres' ? postgres(profile, getSecret(account(name)), sql, values, maxRows, write, (c) => (cancel = c))
      : mysqlQuery(profile, getSecret(account(name)), sql, values, maxRows, write, (c) => (cancel = c))
    return { ok: true, data: await Promise.race([job, timeout]), error: null }
  } catch (e) {
    if (e instanceof QueryError) return fail(e.code, e.message)
    return fail('query_failed', (e as Error).message || 'The database refused the query')
  } finally {
    clearTimeout(timer)
  }
}

/** JSON-safe cell: bytes → base64, bigint → string, dates → ISO. */
function cell(v: unknown): unknown {
  if (typeof v === 'bigint') return String(v)
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  return v
}

/** Collects rows under the caps; throws when a cap is hit, so nothing is silently cut off. */
function collector(maxRows: number) {
  const rows: unknown[][] = []
  let bytes = 0
  return {
    rows,
    add(row: unknown[]) {
      if (rows.length >= maxRows) throw new QueryError('too_many_rows', `The query returned more than ${maxRows} rows; add a LIMIT`)
      const r = row.map(cell)
      bytes += JSON.stringify(r).length
      if (bytes > MAX_BYTES) throw new QueryError('too_large', `The result is larger than ${MAX_BYTES / 1024} KiB`)
      rows.push(r)
    },
  }
}

// SQLite runs in a child process: a slow query can't block the server, and killing the
// process stops even a single long step (node:sqlite has no interrupt). Rows stream as JSON lines.
// A write opens the file read-write for that call only; one statement is its own transaction.
const SQLITE_CHILD = `
const { DatabaseSync, constants: k } = require('node:sqlite')
const out = (m) => process.stdout.write(JSON.stringify(m, (_, v) => typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v) + '\\n')
let input = ''
process.stdin.setEncoding('utf8').on('data', (c) => (input += c)).on('end', () => {
  let db
  try {
    const w = JSON.parse(input)
    db = new DatabaseSync(w.path, { readOnly: !w.write })
    db.setAuthorizer((action) => (action === k.SQLITE_ATTACH ? k.SQLITE_DENY : k.SQLITE_OK))
    const st = db.prepare(w.sql)
    // prepare compiles only the first statement; refuse a second one like Postgres and MySQL do
    const tail = w.sql.slice(st.sourceSQL.length).replace(/--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|[\\s;]/g, '')
    if (tail) throw new Error('Only one SQL statement can run at a time')
    if (w.write) return out({ changes: Number(st.run(...w.values).changes) })
    st.setReturnArrays(true)
    out({ columns: st.columns().map((c) => c.name) })
    for (const row of st.iterate(...w.values)) out({ row })
    out({ done: true })
  } catch (e) {
    out({ error: String((e && e.message) || e) })
  } finally {
    try { db && db.close() } catch {}
  }
})`

function sqlite(path: string, sql: string, values: Value[], maxRows: number, write: boolean, onCancel: (c: () => void) => void): Promise<DbRows | DbWrite> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '-e', SQLITE_CHILD], { stdio: ['pipe', 'pipe', 'ignore'], env: {} })
    const stop = () => void child.kill('SIGKILL')
    onCancel(stop)
    const out = collector(maxRows)
    let columns: string[] = []
    let settled = false
    const settle = (fn: () => void) => !settled && ((settled = true), stop(), fn())
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (settled) return
      try {
        const m = JSON.parse(line) as { columns?: string[]; row?: unknown[]; done?: boolean; error?: string; changes?: number }
        if (m.changes !== undefined) settle(() => resolve({ rowsAffected: m.changes! }))
        else if (m.columns) columns = m.columns
        else if (m.row) out.add(m.row)
        else if (m.error !== undefined) settle(() => reject(new Error(m.error)))
        else if (m.done) settle(() => resolve({ columns, rows: out.rows }))
      } catch (e) {
        settle(() => reject(e))
      }
    })
    child.on('error', (e) => settle(() => reject(e)))
    child.on('exit', () => settle(() => reject(new Error('The SQLite reader stopped unexpectedly'))))
    child.stdin.end(JSON.stringify({ path, sql, write, values: values.map((v) => (typeof v === 'boolean' ? Number(v) : v)) }))
  })
}

async function postgres(p: ServerProfile, password: string | undefined, sql: string, values: Value[], maxRows: number, write: boolean, onCancel: (c: () => void) => void): Promise<DbRows | DbWrite> {
  const client = new pg.Client({
    host: p.host, port: p.port, database: p.database, user: p.user, password,
    application_name: 'helm', connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS + 1000, // backstop; Helm's own timer stops it first
  })
  client.on('error', () => {}) // a torn-down connection reports here; the query promise carries the error
  onCancel(() => (client as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy())
  try {
    await client.connect()
    if (write) {
      await client.query('BEGIN READ WRITE')
      const r = await client.query({ text: sql, values, queryMode: 'extended' } as pg.QueryConfig)
      await client.query('COMMIT')
      return { rowsAffected: r.rowCount ?? 0 }
    }
    await client.query('BEGIN READ ONLY')
    // extended protocol always: one statement per query, so the SQL can't COMMIT and carry on
    return await new Promise<DbRows>((resolve, reject) => {
      const out = collector(maxRows)
      let columns: string[] = []
      const query = new pg.Query({ text: sql, values, rowMode: 'array', queryMode: 'extended' } as pg.QueryConfig)
      let failed = false
      query.on('row', (row: unknown[], result?: pg.QueryResult) => {
        if (failed) return
        if (!columns.length && result?.fields) columns = result.fields.map((f) => f.name)
        try {
          out.add(row)
        } catch (e) {
          failed = true
          reject(e)
          ;(client as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy()
        }
      })
      query.on('end', (result: pg.QueryResult) => !failed && resolve({ columns: columns.length ? columns : (result.fields ?? []).map((f) => f.name), rows: out.rows }))
      query.on('error', (e: Error) => !failed && reject(e))
      client.query(query)
    })
  } finally {
    client.query('ROLLBACK').catch(() => {}).finally(() => client.end().catch(() => {}))
  }
}

function mysqlQuery(p: ServerProfile, password: string | undefined, sql: string, values: Value[], maxRows: number, write: boolean, onCancel: (c: () => void) => void): Promise<DbRows | DbWrite> {
  const conn = mysql.createConnection({
    host: p.host, port: p.port, database: p.database, user: p.user, password,
    connectTimeout: TIMEOUT_MS, multipleStatements: false, rowsAsArray: true,
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  })
  conn.on('error', () => {})
  onCancel(() => conn.destroy())
  const exec = (q: string) => new Promise<void>((res, rej) => conn.query(q, (e) => (e ? rej(e) : res())))
  return (async () => {
    try {
      if (write) {
        await exec('START TRANSACTION READ WRITE')
        const r = await new Promise<{ affectedRows?: number }>((res, rej) => conn.query({ sql, values }, (e, out) => (e ? rej(e) : res(out as { affectedRows?: number }))))
        await exec('COMMIT')
        return { rowsAffected: r.affectedRows ?? 0 }
      }
      // session read-only too: DDL commits implicitly, and the next transaction must still be read-only
      await exec('SET SESSION TRANSACTION READ ONLY')
      await exec('START TRANSACTION READ ONLY')
      return await new Promise<DbRows>((resolve, reject) => {
        const out = collector(maxRows)
        let columns: string[] = []
        let failed = false
        conn
          .query({ sql, values, rowsAsArray: true })
          .on('fields', (fields: { name: string }[]) => (columns = (fields ?? []).map((f) => f.name)))
          .on('result', (row: unknown) => {
            if (failed || !Array.isArray(row)) return
            try {
              out.add(row)
            } catch (e) {
              failed = true
              conn.destroy()
              reject(e)
            }
          })
          .on('error', (e: Error) => !failed && ((failed = true), reject(e)))
          .on('end', () => !failed && resolve({ columns, rows: out.rows }))
      })
    } finally {
      try {
        conn.query('ROLLBACK', () => conn.end())
      } catch {
        conn.destroy()
      }
    }
  })()
}
