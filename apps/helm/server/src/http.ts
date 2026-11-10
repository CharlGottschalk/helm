// `http` connections (packages/sdk/docs/connection.md#http): named calls an extension's manifest
// declares, sent by the server to the base URL of an auth profile the user configured in Helm.
// The extension never sees the base URL or the token. Reads are GET, or POST with the
// manifest's own body (GraphQL queries); `write: true` calls (POST/PUT/PATCH/DELETE) run only with
// a one-time token from Helm's confirmation flow (confirm.ts). JSON only, no redirects, size and time caps.
import { HTTP_PLACEHOLDER, HTTP_WRITE_METHODS, SERVICE_NAME, type HttpResult } from '@usetdt/helm-sdk'
import { readHelmFile, writeHelmFile, type WorkspaceEntry } from './config.js'
import { digest, issue, spend } from './confirm.js'
import { ApiError } from './errors.js'
import { declaration } from './extensions.js'
import { accessToken, clientAccount, forgetOAuth, getRedirectUri, grantView, oauthRefusal, startConnect } from './oauth.js'
import { deleteSecret, getSecret, secretStore, setSecret } from './secrets.js'

export const TIMEOUT_MS = 10_000
export const MAX_BYTES = 1024 * 1024
const MAX_ARG = 4096

export interface HttpProfile {
  baseUrl: string
  /** header the token goes in, e.g. Authorization or X-API-Key */
  header: string
  /** bearer: `Bearer <token>`; raw: the token as is */
  scheme: 'bearer' | 'raw'
  /** oauth2: sign in through the declaring plugin's OAuth2 endpoints (oauth.ts); absent: a stored token */
  auth?: 'oauth2'
  /** the user's own OAuth2 client id (not a secret); the client secret is in the credential store */
  clientId?: string
}
type Value = string | number | boolean | null
const FILE = 'http.json'
const account = (name: string) => `http:${name}`
const fail = (code: string, message: string, status: number | null = null): HttpResult => ({ ok: false, status, data: null, error: { code, message } })
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

const readProfiles = () => readHelmFile<HttpProfile>(FILE, 'profiles')

/** Profiles as the browser sees them: no token, only whether one is stored. */
export function listHttpProfiles() {
  return {
    store: secretStore(),
    redirectUri: getRedirectUri(),
    profiles: Object.entries(readProfiles())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, p]) =>
        p.auth === 'oauth2'
          ? { name, ...p, hasToken: false, hasClientSecret: getSecret(clientAccount(name)) !== undefined, oauth: grantView(name) }
          : { name, ...p, auth: 'token' as const, hasToken: getSecret(account(name)) !== undefined }),
  }
}

/** A base URL Helm may send a token to: https, or http on this machine only; no credentials, query or fragment. */
export function checkBaseUrl(raw: unknown) {
  let u: URL
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    throw new ApiError(400, 'Base URL must be a full URL, e.g. https://api.example.com')
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) throw new ApiError(400, 'Base URL must use https (http only for 127.0.0.1 or localhost)')
  if (u.username || u.password || u.search || u.hash) throw new ApiError(400, 'Base URL must not contain credentials, a query or a fragment')
  return u.origin + u.pathname.replace(/\/+$/, '')
}

/** Add or replace a profile. `token` / `clientSecret` undefined keeps a stored one; '' clears it. Switching auth drops the other kind's secrets. */
export function saveHttpProfile(input: Record<string, unknown>) {
  const name = String(input.name ?? '')
  if (!SERVICE_NAME.test(name)) throw new ApiError(400, `Name must match ${SERVICE_NAME.source} (lowercase, digits, - and _)`)
  const header = String(input.header ?? 'Authorization').trim() || 'Authorization'
  if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) throw new ApiError(400, 'Header must be a header name such as Authorization or X-API-Key')
  const scheme = input.scheme === 'raw' ? 'raw' : 'bearer'
  const oauth = input.auth === 'oauth2'
  for (const k of ['token', 'clientSecret'])
    if (typeof input[k] === 'string' && ((input[k] as string).length > 8192 || /[\r\n\0]/.test(input[k] as string))) throw new ApiError(400, `${k === 'token' ? 'Token' : 'Client secret'} must be one line, up to 8192 characters`)
  const clientId = String(input.clientId ?? '').trim()
  if (oauth && !/^[\x21-\x7E]{1,512}$/.test(clientId)) throw new ApiError(400, 'OAuth2 sign-in needs a client id (no spaces)')
  const profiles = readProfiles()
  const before = profiles[name]
  // OAuth2 always sends `Authorization: Bearer <access token>`
  profiles[name] = oauth ? { baseUrl: checkBaseUrl(input.baseUrl), header: 'Authorization', scheme: 'bearer', auth: 'oauth2', clientId } : { baseUrl: checkBaseUrl(input.baseUrl), header, scheme }
  writeHelmFile(FILE, 'profiles', profiles)
  if (oauth) {
    deleteSecret(account(name))
    // a grant belongs to the client that obtained it
    if (before?.auth === 'oauth2' && before.clientId !== clientId) forgetOAuth(name, false)
    if (typeof input.clientSecret === 'string') input.clientSecret ? setSecret(clientAccount(name), input.clientSecret) : deleteSecret(clientAccount(name))
  } else {
    forgetOAuth(name)
    if (typeof input.token === 'string') input.token ? setSecret(account(name), input.token) : deleteSecret(account(name))
  }
  return listHttpProfiles().profiles.find((p) => p.name === name)!
}

export function removeHttpProfile(name: string) {
  const profiles = readProfiles()
  if (!profiles[name]) throw new ApiError(404, `No service profile "${name}"`)
  delete profiles[name]
  writeHelmFile(FILE, 'profiles', profiles)
  deleteSecret(account(name))
  forgetOAuth(name)
  return { ok: true }
}

/** Start OAuth2 sign-in for a profile with what this workspace's extensions declare; the browser opens `url`. */
export function connectHttpProfile(ws: WorkspaceEntry, name: string) {
  const profile = readProfiles()[name]
  if (!profile) throw new ApiError(404, `No service profile "${name}"`)
  return startConnect(ws, name, profile.auth === 'oauth2' ? profile.clientId : undefined)
}

/* ── extension calls ─────────────────────────────────────────────────────── */
type CallBody = { key?: unknown; connection?: unknown; operation?: unknown; args?: unknown; token?: unknown }
/** What Helm's dialog shows for an http write; built here from the declaration and the exact request. */
export type HttpWriteSummary = { kind: 'http-write'; actor: string; connection: string; operation: string; service: string; method: string; url: string; body: unknown }

const argValue = (args: Record<string, unknown>, name: string): Value | undefined => {
  const v = args[name]
  if (v === undefined || v === null) return v
  if (!['string', 'number', 'boolean'].includes(typeof v)) throw new TypeError(`Argument "${name}" must be a string, number, boolean or null`)
  if (typeof v === 'string' && v.length > MAX_ARG) throw new TypeError(`Argument "${name}" is longer than ${MAX_ARG} characters`)
  return v as Value
}

/** The declared body with every string that is exactly "{name}" replaced by that arg; other strings stay literal. */
function fillBody(v: unknown, args: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    const m = /^\{([A-Za-z_][A-Za-z0-9_]{0,31})\}$/.exec(v)
    return m ? (argValue(args, m[1]) ?? null) : v
  }
  if (Array.isArray(v)) return v.map((x) => fillBody(x, args))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillBody(x, args)]))
  return v
}

/** The request for one declared call, or a refusal. The URL always stays under the profile's base URL. */
export function buildRequest(profile: HttpProfile, call: { method?: unknown; path?: unknown; query?: unknown; body?: unknown; write?: unknown }, args: Record<string, unknown>) {
  const write = call.write === true
  if (write ? !HTTP_WRITE_METHODS.includes(call.method as string) : call.method !== 'GET' && call.method !== 'POST')
    throw new TypeError(write ? 'A write call must be POST, PUT, PATCH or DELETE' : 'A read call must be GET or POST; other methods need "write": true')
  if (typeof call.path !== 'string' || !call.path.startsWith('/') || call.path.startsWith('//')) throw new TypeError('The declared path is invalid')
  const path = call.path.replace(HTTP_PLACEHOLDER, (_, name: string) => {
    const v = argValue(args, name)
    if (v === undefined || v === null || v === '') throw new TypeError(`Argument "${name}" is required by the path`)
    if (String(v) === '.' || String(v) === '..') throw new TypeError(`Argument "${name}" is not a valid path segment`)
    return encodeURIComponent(String(v))
  })
  const base = new URL(profile.baseUrl)
  const prefix = base.pathname.replace(/\/+$/, '')
  const url = new URL(base.origin + prefix + path)
  if (url.origin !== base.origin || !(url.pathname === prefix || url.pathname.startsWith(prefix + '/'))) throw new TypeError('The call would leave the profile\'s base URL')
  const query = call.query && typeof call.query === 'object' ? (call.query as Record<string, unknown>) : {}
  for (const [k, t] of Object.entries(query)) {
    if (typeof t !== 'string') throw new TypeError('The declared query is invalid')
    let missing = false
    const value = t.replace(HTTP_PLACEHOLDER, (_, name: string) => {
      const v = argValue(args, name)
      if (v === undefined || v === null) missing = true
      return v === undefined || v === null ? '' : String(v)
    })
    if (!missing) url.searchParams.set(k, value) // an unset arg leaves its query parameter out
  }
  const body = call.method !== 'GET' && (call.method === 'POST' || call.body !== undefined) ? JSON.stringify(fillBody(call.body ?? null, args)) : undefined
  return { method: call.method as string, url, body, write }
}

type Resolved = { req: ReturnType<typeof buildRequest>; profile: HttpProfile; service: string; summary: HttpWriteSummary; binding: unknown[] }

/** One declared call with these args, resolved to its exact request; or a refusal. */
function resolve(ws: WorkspaceEntry, body: CallBody): Resolved | HttpResult {
  const { decl, actor, key, mayWrite } = declaration(ws, body.key, body.connection, 'http')
  if (!decl) return fail('refused', `"${String(body.connection)}" is not an http connection in this extension's manifest`)
  const calls = (decl.calls && typeof decl.calls === 'object' ? decl.calls : {}) as Record<string, Record<string, unknown>>
  const op = String(body.operation)
  if (!Object.prototype.hasOwnProperty.call(calls, op)) return fail('refused', `"${String(decl.id)}.${op}" is not declared in this extension's manifest`)
  if (typeof decl.service !== 'string' || !SERVICE_NAME.test(decl.service)) return fail('refused', `Connection "${String(decl.id)}" has an invalid service`)
  const profile = readProfiles()[decl.service]
  if (!profile) return fail('not_configured', `No service profile "${decl.service}". Add it in Settings → Connections.`)
  const args = (typeof body.args === 'object' && body.args && !Array.isArray(body.args) ? body.args : {}) as Record<string, unknown>
  if (calls[op].write === true && !mayWrite) return fail('refused', `Call "${op}" writes, but the manifest does not declare permissions.write`)
  if (profile.auth === 'oauth2') {
    const refusal = oauthRefusal(decl.service, decl)
    if (refusal) return refusal
  }
  let req: ReturnType<typeof buildRequest>
  try {
    req = buildRequest(profile, calls[op], args)
  } catch (e) {
    return fail('refused', (e as Error).message)
  }
  const id = String(decl.id)
  return {
    req, profile, service: decl.service,
    summary: { kind: 'http-write', actor, connection: id, operation: op, service: decl.service, method: req.method, url: req.url.href, body: req.body === undefined ? null : JSON.parse(req.body) },
    // the exact request (profile URL included): a changed profile or other args can't spend this token
    binding: ['http', ws.id, key, id, op, req.method, req.url.href, digest(req.body ?? null)],
  }
}

export async function httpCall(ws: WorkspaceEntry, body: CallBody): Promise<HttpResult> {
  const r = resolve(ws, body)
  if ('ok' in r) return r
  if (r.req.write && !spend(body.token, r.binding)) return fail('confirmation_required', 'This write was not confirmed in Helm, or its confirmation expired; nothing was sent. Try again.')
  if (r.profile.auth !== 'oauth2') return send(r.profile, getSecret(account(r.service)), r.req)
  const token = await accessToken(r.service, r.profile.clientId ?? '')
  return typeof token === 'string' ? send(r.profile, token, r.req) : token
}

/** A one-time token for one declared write call with exactly these args, and what Helm's dialog shows. */
export function httpConfirm(ws: WorkspaceEntry, body: CallBody): { token: string; summary: HttpWriteSummary } | HttpResult {
  const r = resolve(ws, body)
  if ('ok' in r) return r
  if (!r.req.write) return fail('refused', `"${String(body.operation)}" is a read call; it needs no confirmation`)
  return { token: issue(r.binding), summary: r.summary }
}

async function send(profile: HttpProfile, token: string | undefined, req: ReturnType<typeof buildRequest>): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'Helm' }
  if (req.body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers[profile.header.toLowerCase()] = profile.scheme === 'bearer' ? `Bearer ${token}` : token
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    // never follow a redirect: it could take the token, or the call, to another host
    const res = await fetch(req.url, { method: req.method, headers, body: req.body, redirect: 'manual', signal: abort.signal })
    if (res.status >= 300 && res.status < 400) return (void res.body?.cancel(), fail('redirect', `The service answered with a redirect (HTTP ${res.status}); Helm does not follow redirects`, res.status))
    const type = res.headers.get('content-type') ?? ''
    const size = Number(res.headers.get('content-length') ?? 0)
    if (size > MAX_BYTES) return (void res.body?.cancel(), fail('too_large', `The response is larger than ${MAX_BYTES / 1024} KiB`, res.status))
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of res.body ?? []) {
      bytes += (chunk as Uint8Array).length
      if (bytes > MAX_BYTES) break // leaving the loop cancels the stream
      chunks.push(chunk as Uint8Array)
    }
    if (bytes > MAX_BYTES) return fail('too_large', `The response is larger than ${MAX_BYTES / 1024} KiB`, res.status)
    const text = Buffer.concat(chunks).toString('utf8')
    let data: unknown = null
    if (text.trim()) {
      if (!/^application\/([a-z0-9.+-]+\+)?json\b/i.test(type)) return fail('not_json', `The service answered with ${type.split(';')[0] || 'no content type'}, not JSON`, res.status)
      try {
        data = JSON.parse(text)
      } catch {
        return fail('not_json', 'The service sent invalid JSON', res.status)
      }
    }
    if (!res.ok) return { ok: false, status: res.status, data, error: { code: 'http_error', message: `The service answered HTTP ${res.status}` } }
    return { ok: true, status: res.status, data, error: null }
  } catch (e) {
    if (abort.signal.aborted) return fail('timeout', `The service did not answer within ${TIMEOUT_MS / 1000} s`)
    return fail('unavailable', `Could not reach the service: ${(e as Error & { cause?: Error }).cause?.message ?? (e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}
