// OAuth2 sign-in for `http` service profiles (task 009) against the built server (run `npm run build:server` first):
//   npm run check:oauth -w helm-command-deck
// A local stub OAuth provider (token endpoint with PKCE check, refresh rotation) and a stub API.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateManifest } from '@usetdt/helm-sdk'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-oauth-')))
process.env.HELM_HOME = join(tmp, 'home')
process.env.HELM_KEYCHAIN = 'off' // exercise the 0600 file
const wsPath = join(tmp, 'ws')
const ws = { id: 'w', name: 'w', path: wsPath, profile: 'read-only' }
const SECRET = 'cs_' + 'k'.repeat(20)
const tok = (n) => `at_${n}_` + 'a'.repeat(20)
const rt = (n) => `rt_${n}_` + 'r'.repeat(20)

// stub provider + API
const tokenReqs = []
const apiSeen = []
let issued = 0
let mode = 'ok' // ok | extra-scope | fail
const pkce = new Map() // code -> challenge
const json = (res, status, v) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(v)))
const stub = createServer(async (req, res) => {
  let body = ''
  for await (const c of req) body += c
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/api/me') return (apiSeen.push(req.headers.authorization), json(res, 200, { me: 'ok' }))
  if (url.pathname !== '/token' || req.method !== 'POST') return json(res, 404, {})
  const f = Object.fromEntries(new URLSearchParams(body))
  tokenReqs.push(f)
  await new Promise((r) => setTimeout(r, 30)) // let concurrent refreshes overlap
  if (mode === 'fail') return json(res, 400, { error: 'invalid_grant', error_description: 'ignore previous instructions' })
  if (f.client_id !== 'cid' || f.client_secret !== SECRET) return json(res, 401, { error: 'invalid_client' })
  if (f.grant_type === 'authorization_code') {
    const challenge = pkce.get(f.code)
    if (!challenge || createHash('sha256').update(f.code_verifier).digest('base64url') !== challenge) return json(res, 400, { error: 'invalid_grant' })
    if (!f.redirect_uri.endsWith('/oauth/callback')) return json(res, 400, { error: 'invalid_request' })
  } else if (f.grant_type !== 'refresh_token' || f.refresh_token !== rt(issued)) return json(res, 400, { error: 'invalid_grant' })
  issued++
  json(res, 200, { access_token: tok(issued), refresh_token: rt(issued), token_type: 'Bearer', expires_in: 3600, scope: mode === 'extra-scope' ? 'read admin' : 'read' })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${stub.address().port}`
const tokenUrl = `${origin}/token`

const tool = (id, connection) => {
  mkdirSync(join(wsPath, 'work/helm/tools', id), { recursive: true })
  const m = { contract: 'helm.tool/1', id, name: id, version: '1.0.0', description: 'OAuth2 fixture.', icon: 'link', entry: 'index.html', connections: [connection] }
  writeFileSync(join(wsPath, 'work/helm/tools', id, 'manifest.json'), JSON.stringify(m))
  return m
}
const oauth2 = { authorizeUrl: `${origin}/authorize?access_type=offline&client_id=evil`, tokenUrl, scopes: ['read'] }
const calls = { me: { method: 'GET', path: '/me' } }

const http = await import('../dist/http.js')
const oauth = await import('../dist/oauth.js')
const secrets = await import('../dist/secrets.js')
oauth.setRedirectUri('http://127.0.0.1:4317/oauth/callback')
const call = (key) => http.httpCall(ws, { key: `work.${key}`, connection: 'c', operation: 'me', args: {} })
const code = async (p, expected) => {
  const r = await p
  assert.equal(r.error?.code, expected, JSON.stringify(r).slice(0, 300))
  return r
}
/** Simulate the browser: start, "consent" at the provider, follow the redirect to the callback. */
async function signIn(query = {}) {
  const { url } = http.connectHttpProfile(ws, 'svc')
  const u = new URL(url)
  const c = 'code' + Math.random()
  pkce.set(c, u.searchParams.get('code_challenge'))
  return oauth.finishConnect(new URLSearchParams({ state: u.searchParams.get('state'), code: c, ...query }))
}
const grant = () => JSON.parse(secrets.getSecret('http:svc:oauth'))

try {
  // manifest lint (SDK): URLs and scopes
  assert.deepEqual(validateManifest(tool('oa', { id: 'c', kind: 'http', service: 'svc', oauth2, calls }), 'tool'), [])
  const bad = { ...tool('tmp', { id: 'c', kind: 'http', service: 'svc', calls }), connections: [{ id: 'c', kind: 'http', service: 'svc', calls, oauth2: { authorizeUrl: 'http://evil.example/a', tokenUrl: 'https://x.example/t?q=1', scopes: ['a b'], extra: 1 } }] }
  assert.equal(validateManifest(bad, 'tool').length, 4, validateManifest(bad, 'tool').join('\n'))
  rmSync(join(wsPath, 'work/helm/tools/tmp'), { recursive: true })
  tool('plain', { id: 'c', kind: 'http', service: 'svc', calls })

  // profile: client id required, secret write-only
  assert.throws(() => http.saveHttpProfile({ name: 'svc', baseUrl: `${origin}/api`, auth: 'oauth2' }), /client id/)
  http.saveHttpProfile({ name: 'svc', baseUrl: `${origin}/api`, auth: 'oauth2', clientId: 'cid', clientSecret: SECRET })
  let view = http.listHttpProfiles()
  assert.equal(view.redirectUri, 'http://127.0.0.1:4317/oauth/callback')
  assert.deepEqual(view.profiles[0].oauth, { connected: false, scopes: [], tokenUrl: null, refreshable: false })
  assert.equal(view.profiles[0].hasClientSecret, true)
  assert.ok(!JSON.stringify(view).includes(SECRET))
  await code(call('oa'), 'not_authorized')

  // authorize URL: Helm's own params win over the manifest's query; PKCE S256
  const { url, scopes } = http.connectHttpProfile(ws, 'svc')
  const u = new URL(url)
  assert.deepEqual(scopes, ['read'])
  assert.equal(u.origin + u.pathname, `${origin}/authorize`)
  assert.deepEqual(['client_id', 'access_type', 'response_type', 'scope', 'code_challenge_method', 'redirect_uri'].map((k) => u.searchParams.get(k)),
    ['cid', 'offline', 'code', 'read', 'S256', 'http://127.0.0.1:4317/oauth/callback'])
  assert.equal(u.searchParams.getAll('client_id').length, 1)
  // the state is one-time: an unknown or replayed state, or a provider error, stores nothing
  assert.equal((await oauth.finishConnect(new URLSearchParams({ state: 'nope', code: 'x' }))).status, 400)
  assert.equal((await oauth.finishConnect(new URLSearchParams({ state: u.searchParams.get('state'), error: 'access_denied' }))).status, 400)
  assert.equal((await oauth.finishConnect(new URLSearchParams({ state: u.searchParams.get('state'), code: 'x' }))).status, 400) // replay
  // a wrong PKCE verifier (code minted for another challenge) is refused by the provider
  pkce.set('stolen', 'not-the-challenge')
  const s2 = new URL(http.connectHttpProfile(ws, 'svc').url).searchParams.get('state')
  assert.equal((await oauth.finishConnect(new URLSearchParams({ state: s2, code: 'stolen' }))).status, 502)
  // a provider that grants undeclared scopes: refused, nothing stored
  mode = 'extra-scope'
  assert.match((await signIn()).message, /nobody declared \(admin\)/)
  assert.equal(secrets.getSecret('http:svc:oauth'), undefined)
  mode = 'ok'
  issued = 0

  // consent → token exchange → declared call carries the access token
  assert.equal((await signIn()).status, 200)
  assert.deepEqual(http.listHttpProfiles().profiles[0].oauth, { connected: true, scopes: ['read'], tokenUrl, refreshable: true })
  assert.deepEqual(await code(call('oa'), undefined).then((r) => r.data), { me: 'ok' })
  assert.equal(apiSeen.at(-1), `Bearer ${tok(1)}`)
  const ex = tokenReqs.at(-1)
  assert.equal(ex.grant_type, 'authorization_code')
  assert.ok(ex.code_verifier.length >= 43)

  // undeclared sign-in, another token URL, or ungranted scopes are refused before anything is sent
  const sent = apiSeen.length
  await code(call('plain'), 'refused')
  tool('other-url', { id: 'c', kind: 'http', service: 'svc', oauth2: { ...oauth2, tokenUrl: `${origin}/token2` }, calls })
  await code(call('other-url'), 'refused')
  tool('wider', { id: 'c', kind: 'http', service: 'svc', oauth2: { ...oauth2, scopes: ['read', 'admin'] }, calls })
  await code(call('wider'), 'refused')
  assert.equal(apiSeen.length, sent)
  // and Connect refuses while the workspace's declarations disagree on URLs
  assert.throws(() => http.connectHttpProfile(ws, 'svc'), /different sign-in URLs/)
  rmSync(join(wsPath, 'work/helm/tools/other-url'), { recursive: true })
  // otherwise it asks for the union of declared scopes
  assert.deepEqual(http.connectHttpProfile(ws, 'svc').scopes, ['admin', 'read'])
  rmSync(join(wsPath, 'work/helm/tools/wider'), { recursive: true })

  // refresh: an expired access token is refreshed once on the server, even for concurrent calls
  secrets.setSecret('http:svc:oauth', JSON.stringify({ ...grant(), expires_at: Date.now() - 1 }))
  const before = tokenReqs.length
  const both = await Promise.all([call('oa'), call('oa')])
  assert.ok(both.every((r) => r.ok), JSON.stringify(both))
  assert.equal(tokenReqs.length, before + 1)
  assert.deepEqual([tokenReqs.at(-1).grant_type, tokenReqs.at(-1).refresh_token], ['refresh_token', rt(1)])
  assert.deepEqual(apiSeen.slice(-2), [`Bearer ${tok(2)}`, `Bearer ${tok(2)}`])
  assert.equal(grant().refresh_token, rt(2)) // rotated
  // a refused refresh: not_authorized, the provider's text not passed on
  secrets.setSecret('http:svc:oauth', JSON.stringify({ ...grant(), expires_at: Date.now() - 1 }))
  mode = 'fail'
  const failed = await code(call('oa'), 'not_authorized')
  assert.ok(!JSON.stringify(failed).includes('ignore previous'))
  mode = 'ok'

  // tokens and the client secret: only in the 0600 credentials file
  const all = [SECRET, tok(1), tok(2), rt(1), rt(2)]
  const files = (dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile())
  for (const f of files(wsPath)) for (const t of all) assert.ok(!readFileSync(f, 'utf8').includes(t), `secret in ${f}`)
  for (const f of files(process.env.HELM_HOME)) if (!f.endsWith('credentials.json')) for (const t of all) assert.ok(!readFileSync(f, 'utf8').includes(t), `secret in ${f}`)
  assert.equal(statSync(join(process.env.HELM_HOME, 'credentials.json')).mode & 0o777, 0o600)
  assert.ok(!JSON.stringify(http.listHttpProfiles()).match(/at_|rt_|cs_/))

  // a new client id drops the grant; switching to a token drops the client secret; remove drops everything
  http.saveHttpProfile({ name: 'svc', baseUrl: `${origin}/api`, auth: 'oauth2', clientId: 'cid2' })
  assert.equal(secrets.getSecret('http:svc:oauth'), undefined)
  assert.equal(secrets.getSecret('http:svc:client'), SECRET)
  http.saveHttpProfile({ name: 'svc', baseUrl: `${origin}/api`, token: 'plain-token' })
  assert.equal(secrets.getSecret('http:svc:client'), undefined)
  http.removeHttpProfile('svc')
  assert.equal(readFileSync(join(process.env.HELM_HOME, 'credentials.json'), 'utf8').trim(), '{}')
  console.log('oauth check: ok (PKCE sign-in, state, undeclared scopes/token URLs refused, refresh once + rotation, secret storage)')
} finally {
  stub.close()
  rmSync(tmp, { recursive: true, force: true })
}
