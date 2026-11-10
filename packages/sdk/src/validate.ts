// Manifest checks for sandboxed widgets and tools (contracts/widget.md, contracts/tool.md).
// A hand-written subset of schemas/{widget,tool}.schema.json: enough to refuse a bad
// manifest with a readable reason before Helm renders anything from it.
import { ICON_NAMES } from './icons.js'
import { lintSettingFields, type SettingField } from './settings.js'
import type { ToolManifest, WidgetManifest } from './extension.js'
import { DB_ENGINES, DB_PARAM_NAME, HTTP_PLACEHOLDER, HTTP_WRITE_METHODS, lintOAuth2, SERVICE_NAME, validGlob } from './connection.js'

const CATEGORIES = ['Overview', 'Work', 'Knowledge', 'Agents', 'Utility']
const CAPABILITIES = ['orchestrate', 'terminal', 'chat']
const KINDS = ['tdt-mcp', 'mcp', 'http', 'files', 'db']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, min: number, max = Infinity) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const isStrs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Problems with a manifest; empty means it may be loaded as `kind`. */
export function validateManifest(m: unknown, kind: 'widget' | 'tool'): string[] {
  if (!isObj(m)) return ['manifest.json must be a JSON object']
  const p: string[] = []
  const str = (k: string, max: number) => {
    if (typeof m[k] !== 'string' || !(m[k] as string).trim()) p.push(`"${k}" is required`)
    else if ((m[k] as string).length > max) p.push(`"${k}" is longer than ${max} characters`)
  }
  if (m.contract !== `helm.${kind}/1`) p.push(`"contract" must be "helm.${kind}/1"`)
  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(m.id)) p.push('"id" must match ^[a-z][a-z0-9-]{1,63}$')
  str('name', 60)
  str('description', 240)
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(m.version)) p.push('"version" must be semver')
  if (!(ICON_NAMES as readonly unknown[]).includes(m.icon)) p.push(`"icon" must be a Helm icon name`)
  if (m.multi !== undefined && typeof m.multi !== 'boolean') p.push('"multi" must be true or false')
  if (typeof m.entry !== 'string' || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.html$/.test(m.entry) || m.entry.split('/').includes('..'))
    p.push('"entry" must be a relative .html path inside the bundle')
  if (m.permissions !== undefined && !(isObj(m.permissions) && (m.permissions.write === undefined || typeof m.permissions.write === 'boolean')))
    p.push('"permissions.write" must be true or false')

  if (m.settings !== undefined) {
    if (!Array.isArray(m.settings) || !m.settings.every((f) => isObj(f) && typeof f.id === 'string' && typeof f.label === 'string' && typeof f.type === 'string'))
      p.push('"settings" must be a list of fields with id, type and label')
    else p.push(...lintSettingFields(m.settings as SettingField[]).map((x) => `settings: ${x}`))
  }
  const mayWrite = isObj(m.permissions) && m.permissions.write === true
  const needsWrite = `so the manifest needs "permissions": { "write": true }`
  if (m.connections !== undefined) {
    if (!Array.isArray(m.connections)) p.push('"connections" must be a list')
    else
      for (const c of m.connections) {
        if (!isObj(c) || typeof c.id !== 'string' || !KINDS.includes(c.kind as string)) p.push('each connection needs an id and a kind (tdt-mcp, mcp, http, files or db)')
        else if (c.kind === 'files') {
          if (c.root !== 'project' && c.root !== 'workspace') p.push(`connection "${c.id}": "root" must be "project" or "workspace"`)
          if (!isStrs(c.paths) || !(c.paths as string[]).length || (c.paths as string[]).length > 16 || !(c.paths as string[]).every(validGlob))
            p.push(`connection "${c.id}": "paths" must list 1–16 relative globs (no "." or ".." segments)`)
          if (!isStrs(c.operations) || !(c.operations as string[]).length || !(c.operations as string[]).every((o) => o === 'list' || o === 'read' || o === 'write'))
            p.push(`connection "${c.id}": "operations" may only contain list, read, write`)
          else if ((c.operations as string[]).includes('write') && !mayWrite) p.push(`connection "${c.id}" writes files, ${needsWrite}`)
        } else if (c.kind === 'db') p.push(...lintDb(c, mayWrite))
        else if (c.kind === 'http') p.push(...lintHttp(c, mayWrite))
        else if (c.kind === 'mcp') {
          const ops = isStrs(c.operations) ? (c.operations as string[]) : null
          const writes = c.writes === undefined ? [] : isStrs(c.writes) ? (c.writes as string[]) : null
          if (!ops || !writes) p.push(`connection "${c.id}": "operations" and "writes" must be lists of tool names`)
          else if (!ops.length && !writes.length) p.push(`connection "${c.id}" must list its operations`)
          else if (writes.some((w) => ops.includes(w))) p.push(`connection "${c.id}": a tool is either in "operations" (reads) or in "writes", not both`)
          else if (writes.length && !mayWrite) p.push(`connection "${c.id}" has write tools, ${needsWrite}`)
          else if (typeof c.server !== 'string' || !SERVICE_NAME.test(c.server)) p.push(`connection "${c.id}": "server" must match ${SERVICE_NAME.source}`)
        } else if (!isStrs(c.operations)) p.push(`connection "${c.id}" must list its operations`)
      }
  }

  if (kind === 'widget') {
    if (!CATEGORIES.includes(m.category as string)) p.push(`"category" must be one of ${CATEGORIES.join(', ')}`)
    const s = m.size
    if (!isObj(s) || !isInt(s.w, 1, 6) || !isInt(s.h, 1, 8)) p.push('"size" needs w 1–6 and h 1–8 grid units')
    else for (const k of ['minW', 'minH', 'maxW', 'maxH']) if (s[k] !== undefined && !isInt(s[k], 1)) p.push(`"size.${k}" must be a whole number ≥ 1`)
    if (m.refresh !== undefined && !(isObj(m.refresh) && isInt(m.refresh.intervalSeconds, 30))) p.push('"refresh.intervalSeconds" must be ≥ 30')
    if (m.capabilities !== undefined && !(isStrs(m.capabilities) && (m.capabilities as string[]).every((c) => c === 'orchestrate')))
      p.push('widget "capabilities" may only contain orchestrate')
  } else if (m.capabilities !== undefined && !(isStrs(m.capabilities) && (m.capabilities as string[]).every((c) => CAPABILITIES.includes(c))))
    p.push(`"capabilities" may only contain ${CAPABILITIES.join(', ')}`)
  return p
}

/** A `db` connection: a profile name, an engine and 1–32 named queries; `write: true` ones need `permissions.write`. */
function lintDb(c: Record<string, unknown>, mayWrite: boolean) {
  const p: string[] = []
  const at = `connection "${String(c.id)}"`
  if (typeof c.service !== 'string' || !SERVICE_NAME.test(c.service)) p.push(`${at}: "service" must match ${SERVICE_NAME.source}`)
  if (!DB_ENGINES.includes(c.engine as never)) p.push(`${at}: "engine" must be one of ${DB_ENGINES.join(', ')}`)
  const queries = isObj(c.queries) ? Object.entries(c.queries) : []
  if (!queries.length || queries.length > 32) p.push(`${at}: "queries" must name 1–32 queries`)
  for (const [name, q] of queries) {
    if (!DB_PARAM_NAME.test(name)) p.push(`${at}: query name "${name}" must match ${DB_PARAM_NAME.source}`)
    else if (!isObj(q) || typeof q.sql !== 'string' || !q.sql.trim() || q.sql.length > 16384) p.push(`${at}: query "${name}" needs "sql" (up to 16384 characters)`)
    else if (q.params !== undefined && !(isStrs(q.params) && (q.params as string[]).length <= 32 && (q.params as string[]).every((x) => DB_PARAM_NAME.test(x))))
      p.push(`${at}: query "${name}": "params" must list up to 32 argument names`)
    else if (Object.keys(q).some((k) => k !== 'sql' && k !== 'params' && k !== 'write')) p.push(`${at}: query "${name}" may only have sql, params and write`)
    else if (q.write !== undefined && typeof q.write !== 'boolean') p.push(`${at}: query "${name}": "write" must be true or false`)
    else if (q.write === true && !mayWrite) p.push(`${at}: query "${name}" writes, so the manifest needs "permissions": { "write": true }`)
  }
  return p
}

/** An `http` connection: an auth profile name and 1–16 named calls; reads are GET or POST with a declared body, `write: true` calls need `permissions.write`. */
function lintHttp(c: Record<string, unknown>, mayWrite: boolean) {
  const p: string[] = []
  const at = `connection "${String(c.id)}"`
  if (typeof c.service !== 'string' || !SERVICE_NAME.test(c.service)) p.push(`${at}: "service" must match ${SERVICE_NAME.source}`)
  if (c.oauth2 !== undefined) p.push(...lintOAuth2(c.oauth2).map((x) => `${at}: ${x}`))
  const calls = isObj(c.calls) ? Object.entries(c.calls) : []
  if (!calls.length || calls.length > 16) p.push(`${at}: "calls" must name 1–16 calls`)
  for (const [name, x] of calls) {
    const call = `${at}: call "${name}"`
    if (!DB_PARAM_NAME.test(name)) p.push(`${at}: call name "${name}" must match ${DB_PARAM_NAME.source}`)
    else if (!isObj(x)) p.push(`${call} must be an object`)
    else if (Object.keys(x).some((k) => !['method', 'path', 'query', 'body', 'write'].includes(k))) p.push(`${call} may only have method, path, query, body and write`)
    else if (x.write !== undefined && typeof x.write !== 'boolean') p.push(`${call}: "write" must be true or false`)
    else if (x.write === true && !HTTP_WRITE_METHODS.includes(x.method as string)) p.push(`${call}: a write's "method" must be POST, PUT, PATCH or DELETE`)
    else if (x.write === true && !mayWrite) p.push(`${call} writes, so the manifest needs "permissions": { "write": true }`)
    else if (x.write !== true && x.method !== 'GET' && x.method !== 'POST') p.push(`${call}: "method" must be GET or POST, or set "write": true for ${x.method}`)
    else if (x.write !== true && x.method === 'POST' && x.body === undefined) p.push(`${call}: a read POST needs a declared "body" (for example a GraphQL query)`)
    else if (x.method === 'GET' && x.body !== undefined) p.push(`${call}: a GET has no "body"`)
    else if (typeof x.path !== 'string' || !/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/{}]*$/.test(x.path) || x.path.startsWith('//') || x.path.split('/').some((s) => s === '..' || s === '.'))
      p.push(`${call}: "path" must start with one "/" and have no "." or ".." segments`)
    else if (x.path.replace(HTTP_PLACEHOLDER, '').includes('{') || x.path.replace(HTTP_PLACEHOLDER, '').includes('}')) p.push(`${call}: "path" has a malformed {placeholder}`)
    else if (x.query !== undefined && !(isObj(x.query) && Object.values(x.query).every((v) => typeof v === 'string' && v.length <= 1024)))
      p.push(`${call}: "query" must map names to template strings`)
    else if (x.body !== undefined && JSON.stringify(x.body).length > 16384) p.push(`${call}: "body" is larger than 16 KiB`)
  }
  return p
}

export type ExtensionManifest = WidgetManifest | ToolManifest
