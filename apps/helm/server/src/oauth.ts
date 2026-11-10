// OAuth2 sign-in for `http` service profiles (packages/sdk/docs/connection.md#oauth2): authorization
// code + PKCE with a loopback redirect to this server. Plugin manifests declare the authorize URL,
// token URL and scopes; the user's client id is in the profile and the client secret, refresh and
// access tokens are in the credential store (secrets.ts). Tokens never leave the server, and a call
// runs only when its connection's token URL and scopes match the stored grant. No provider names here.
import { createHash, randomBytes } from 'node:crypto'
import { lintOAuth2, SERVICE_NAME, type HttpOAuth2, type HttpResult } from '@usetdt/helm-sdk'
import type { WorkspaceEntry } from './config.js'
import { ApiError } from './errors.js'
import { listExtensions } from './extensions.js'
import { deleteSecret, getSecret, setSecret } from './secrets.js'

const STATE_MS = 10 * 60_000
const TIMEOUT_MS = 10_000
const MAX_BYTES = 64 * 1024
const EARLY_MS = 60_000 // refresh this long before the access token expires

/** What the credential store holds for a connected profile. */
interface Grant {
  token_url: string
  scopes: string[]
  access_token: string
  /** ms epoch; null when the provider gave no expiry */
  expires_at: number | null
  refresh_token?: string
}

export const clientAccount = (name: string) => `http:${name}:client`
const grantAccount = (name: string) => `http:${name}:oauth`
const fail = (code: string, message: string): HttpResult => ({ ok: false, status: null, data: null, error: { code, message } })

let redirectUri = ''
/** Set once at startup: the loopback callback the user registers with the provider. */
export const setRedirectUri = (uri: string) => void (redirectUri = uri)
export const getRedirectUri = () => redirectUri

function readGrant(name: string): Grant | undefined {
  const raw = getSecret(grantAccount(name))
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Grant
  } catch {
    return undefined
  }
}

/** The grant as the browser sees it: never a token. */
export function grantView(name: string) {
  const g = readGrant(name)
  return g ? { connected: true, scopes: g.scopes, tokenUrl: g.token_url, refreshable: !!g.refresh_token } : { connected: false, scopes: [] as string[], tokenUrl: null, refreshable: false }
}

export function forgetOAuth(name: string, client = true) {
  deleteSecret(grantAccount(name))
  if (client) deleteSecret(clientAccount(name))
}

/** A declaration's `oauth2` when it is valid; the server checks it again (browsers validate manifests). */
export function declaredOAuth(decl: Record<string, unknown>): HttpOAuth2 | undefined {
  return decl.oauth2 !== undefined && !lintOAuth2(decl.oauth2).length ? (decl.oauth2 as HttpOAuth2) : undefined
}

/**
 * Whether this declaration may use the profile's grant: it must declare oauth2, from the grant's
 * token URL, with every scope granted. Undefined when it may; otherwise the refusal.
 */
export function oauthRefusal(name: string, decl: Record<string, unknown>): HttpResult | undefined {
  const o = declaredOAuth(decl)
  if (!o) return fail('refused', `Service "${name}" signs in with OAuth2, but connection "${String(decl.id)}" declares no valid oauth2`)
  const g = readGrant(name)
  if (!g) return fail('not_authorized', `Service "${name}" is not connected. Connect it in Settings → Connections.`)
  if (o.tokenUrl !== g.token_url) return fail('refused', `Connection "${String(decl.id)}" declares a different token URL from the one service "${name}" was connected with`)
  const missing = o.scopes.filter((s) => !g.scopes.includes(s))
  if (missing.length) return fail('refused', `Service "${name}" was not granted ${missing.join(', ')}. Reconnect it in Settings → Connections.`)
  return undefined
}

/* ── connect ─────────────────────────────────────────────────────────────── */
const pending = new Map<string, { name: string; clientId: string; verifier: string; tokenUrl: string; scopes: string[]; expires: number }>()

/** What every enabled extension in this workspace declares for `name`: one authorize/token URL pair, scopes joined. */
function declaredFor(ws: WorkspaceEntry, name: string): HttpOAuth2 {
  const found: HttpOAuth2[] = []
  for (const e of listExtensions(ws).extensions) {
    const conns = (e.manifest as { connections?: unknown }).connections
    for (const c of Array.isArray(conns) ? conns : []) {
      if (c?.kind !== 'http' || c.service !== name || c.oauth2 === undefined) continue
      const o = declaredOAuth(c)
      if (!o) throw new ApiError(409, `${e.key} declares an invalid oauth2 for service "${name}"`)
      found.push(o)
    }
  }
  if (!found.length) throw new ApiError(409, `No plugin enabled in this workspace declares OAuth2 sign-in for service "${name}"`)
  const [first] = found
  if (found.some((o) => o.authorizeUrl !== first.authorizeUrl || o.tokenUrl !== first.tokenUrl))
    throw new ApiError(409, `Plugins declare different sign-in URLs for service "${name}"; enable only one of them in this workspace`)
  return { ...first, scopes: [...new Set(found.flatMap((o) => o.scopes))].sort() }
}

/** Start sign-in for one profile: the provider URL the browser opens, with PKCE and a one-time state. */
export function startConnect(ws: WorkspaceEntry, name: string, clientId: string | undefined) {
  if (!SERVICE_NAME.test(name)) throw new ApiError(400, 'Unknown service')
  if (!clientId) throw new ApiError(409, `Service "${name}" does not sign in with OAuth2`)
  if (!redirectUri) throw new ApiError(503, 'The OAuth2 callback is not ready yet')
  const o = declaredFor(ws, name)
  const now = Date.now()
  for (const [k, p] of pending) if (p.expires <= now) pending.delete(k)
  const state = randomBytes(24).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  pending.set(state, { name, clientId, verifier, tokenUrl: o.tokenUrl, scopes: o.scopes, expires: now + STATE_MS })
  const url = new URL(o.authorizeUrl)
  const params = {
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    ...(o.scopes.length ? { scope: o.scopes.join(' ') } : {}),
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v) // the manifest can't override these
  return { url: url.href, scopes: o.scopes }
}

/** The loopback redirect: exchange the code, store the grant. Authenticated by the one-time state only. */
export async function finishConnect(query: URLSearchParams): Promise<{ status: number; message: string }> {
  const state = query.get('state') ?? ''
  const p = pending.get(state)
  pending.delete(state)
  if (!p || p.expires <= Date.now()) return { status: 400, message: 'This sign-in link expired or was already used. Start again from Helm.' }
  if (query.get('error')) return { status: 400, message: `The service did not grant access (${query.get('error')}). Nothing was stored.` }
  const code = query.get('code')
  if (!code) return { status: 400, message: 'The service sent no authorization code. Nothing was stored.' }
  const r = await tokenRequest(p.tokenUrl, p.name, p.clientId, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: p.verifier })
  if ('error' in r) return { status: 502, message: `${r.error} Nothing was stored.` }
  const scopes = r.scope === undefined ? p.scopes : r.scope.split(' ').filter(Boolean)
  const extra = scopes.filter((s) => !p.scopes.includes(s))
  if (extra.length) return { status: 502, message: `The service granted scopes nobody declared (${extra.join(', ')}). Nothing was stored.` }
  saveGrant(p.name, p.tokenUrl, scopes, r)
  return { status: 200, message: `Service "${p.name}" is connected. You can close this window and return to Helm.` }
}

/* ── tokens ──────────────────────────────────────────────────────────────── */
type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }

function saveGrant(name: string, tokenUrl: string, scopes: string[], r: TokenResponse, previous?: Grant) {
  const g: Grant = {
    token_url: tokenUrl, scopes, access_token: r.access_token,
    expires_at: typeof r.expires_in === 'number' && r.expires_in > 0 ? Date.now() + r.expires_in * 1000 : null,
    refresh_token: r.refresh_token ?? previous?.refresh_token, // providers may or may not rotate it
  }
  setSecret(grantAccount(name), JSON.stringify(g))
  return g
}

const refreshing = new Map<string, Promise<string | HttpResult>>()

/** A current access token for the profile, refreshed on the server when it is (nearly) expired. */
export function accessToken(name: string, clientId: string): Promise<string | HttpResult> {
  const g = readGrant(name)
  if (!g) return Promise.resolve(fail('not_authorized', `Service "${name}" is not connected. Connect it in Settings → Connections.`))
  if (g.expires_at === null || g.expires_at - EARLY_MS > Date.now()) return Promise.resolve(g.access_token)
  if (!g.refresh_token) return Promise.resolve(fail('not_authorized', `The sign-in for service "${name}" expired. Reconnect it in Settings → Connections.`))
  // one refresh per profile at a time: concurrent calls share it (a rotated refresh token is single-use)
  let p = refreshing.get(name)
  if (!p) {
    p = refresh(name, clientId, g).finally(() => refreshing.delete(name))
    refreshing.set(name, p)
  }
  return p
}

async function refresh(name: string, clientId: string, g: Grant): Promise<string | HttpResult> {
  const r = await tokenRequest(g.token_url, name, clientId, { grant_type: 'refresh_token', refresh_token: g.refresh_token! })
  if ('error' in r) return fail(r.status === 400 || r.status === 401 ? 'not_authorized' : 'unavailable', `${r.error} Reconnect service "${name}" in Settings → Connections if this persists.`)
  const scopes = r.scope === undefined ? g.scopes : r.scope.split(' ').filter(Boolean)
  if (scopes.some((s) => !g.scopes.includes(s))) return fail('not_authorized', `The service widened the scopes of "${name}" on refresh; reconnect it in Settings → Connections.`)
  return saveGrant(name, g.token_url, scopes, r, g).access_token
}

/** POST a form to the token URL (client_secret_post when a secret is stored). No redirects, JSON only, capped. */
async function tokenRequest(tokenUrl: string, name: string, clientId: string, form: Record<string, string>): Promise<TokenResponse | { error: string; status: number | null }> {
  const body = new URLSearchParams({ ...form, client_id: clientId })
  // ponytail: client secret in the body (client_secret_post); add HTTP Basic if a provider requires it
  const secret = getSecret(clientAccount(name))
  if (secret) body.set('client_secret', secret)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST', redirect: 'manual', signal: abort.signal, body,
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Helm' },
    })
    if (res.status >= 300 && res.status < 400) return (void res.body?.cancel(), { error: `The token endpoint answered with a redirect (HTTP ${res.status}); Helm does not follow redirects.`, status: res.status })
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of res.body ?? []) {
      bytes += (chunk as Uint8Array).length
      if (bytes > MAX_BYTES) return { error: 'The token response is too large.', status: res.status } // leaving the loop cancels the stream
      chunks.push(chunk as Uint8Array)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(text)
    } catch {
      return { error: `The token endpoint answered HTTP ${res.status} without JSON.`, status: res.status }
    }
    // the provider's error code only: its description is untrusted text
    if (!res.ok) return { error: `The token endpoint answered HTTP ${res.status}${typeof data.error === 'string' && /^[\w.-]{1,64}$/.test(data.error) ? ` (${data.error})` : ''}.`, status: res.status }
    if (typeof data.access_token !== 'string' || !data.access_token || /[\r\n\0]/.test(data.access_token)) return { error: 'The token response has no access token.', status: res.status }
    if (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer') return { error: `Helm only supports Bearer tokens, not ${String(data.token_type).slice(0, 32)}.`, status: res.status }
    return {
      access_token: data.access_token,
      refresh_token: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined,
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || undefined,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
    }
  } catch (e) {
    return { error: abort.signal.aborted ? 'The token endpoint did not answer in time.' : `Could not reach the token endpoint: ${(e as Error & { cause?: Error }).cause?.message ?? (e as Error).message}.`, status: null }
  } finally {
    clearTimeout(timer)
  }
}
