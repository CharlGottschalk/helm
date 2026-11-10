// `http` and `mcp` connection self-check against the built server (run `npm run build:server` first):
//   npm run check:connections -w helm-command-deck
// Starts a local stub HTTP service (and a second "foreign" one) and a stdio stub MCP server.
// Also covers task 027's confirmed http and mcp writes (confirm.ts tokens).
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-conn-')))
process.env.HELM_HOME = join(tmp, 'home')
process.env.HELM_KEYCHAIN = 'off' // exercise the 0600 file
process.env.HELM_CHECK_SENTINEL = 'must-not-reach-mcp' // stdio servers get only the default environment
const wsPath = join(tmp, 'ws')
const ws = { id: 'w', name: 'w', path: wsPath, profile: 'read-only' }
mkdirSync(join(wsPath, 'work/helm/tools'), { recursive: true })
for (const t of ['svc-calls', 'svc-writes']) cpSync(fileURLToPath(new URL(`./fixtures/connections/tools/${t}`, import.meta.url)), join(wsPath, `work/helm/tools/${t}`), { recursive: true })
const TOKEN = 'tok_' + 'x'.repeat(24) + '_secret'

// what the stub services saw
const seen = []
const foreignHits = []
const foreign = createServer((req, res) => (foreignHits.push(req.url), res.end('{}')))
const stub = createServer(async (req, res) => {
  let body = ''
  for await (const c of req) body += c
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, key: req.headers['x-api-key'], body })
  const json = (status, v) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(v)))
  if (req.url.startsWith('/api/items/')) return json(200, { url: req.url })
  if (req.url === '/api/graphql') return json(200, { data: JSON.parse(body) })
  if (req.url === '/api/big') return json(200, { big: 'x'.repeat(1024 * 1024 + 10) })
  if (req.url === '/api/html') return (res.writeHead(200, { 'content-type': 'text/html' }), res.end('<p>hi</p>'))
  if (req.url === '/api/redirect') return (res.writeHead(302, { location: `http://127.0.0.1:${foreign.address().port}/steal` }), res.end())
  if (req.url.startsWith('/api/status/')) return json(Number(req.url.split('/').pop()), { message: 'nope' })
  json(404, { url: req.url })
})
await Promise.all([new Promise((r) => stub.listen(0, '127.0.0.1', r)), new Promise((r) => foreign.listen(0, '127.0.0.1', r))])
const base = `http://127.0.0.1:${stub.address().port}/api`

const http = await import('../dist/http.js')
const mcp = await import('../dist/mcp.js')
const call = (connection, operation, args = {}) => (connection === 'tools' ? mcp.mcpCall : http.httpCall)(ws, { key: 'work.svc-calls', connection, operation, args })
const code = async (p, expected) => {
  const r = await p
  assert.equal(r.error?.code, expected, JSON.stringify(r).slice(0, 300))
  assert.ok(!JSON.stringify(r).includes(TOKEN), 'the token reached a result')
  return r
}

try {
  // profiles: base URL rules, token write-only
  assert.throws(() => http.saveHttpProfile({ name: 'stub', baseUrl: 'http://example.com' }), /https/)
  assert.throws(() => http.saveHttpProfile({ name: 'stub', baseUrl: 'https://u:p@example.com' }), /credentials/)
  assert.throws(() => http.saveHttpProfile({ name: 'Bad Name', baseUrl: 'https://example.com' }), /Name/)
  await code(call('svc', 'item', { id: '1' }), 'not_configured')
  const saved = http.saveHttpProfile({ name: 'stub', baseUrl: base + '/', token: TOKEN })
  assert.deepEqual(saved, { name: 'stub', baseUrl: base, header: 'Authorization', scheme: 'bearer', auth: 'token', hasToken: true })
  assert.ok(!JSON.stringify(http.listHttpProfiles()).includes(TOKEN))

  // a declared GET: path arg URL-encoded, query filled, bearer token sent by the server
  const item = await code(call('svc', 'item', { id: 'a b/../c', limit: 2 }), undefined)
  assert.equal(item.ok, true)
  assert.equal(item.status, 200)
  assert.equal(item.data.url, '/api/items/a%20b%2F..%2Fc?limit=2&fixed=yes')
  assert.equal(seen.at(-1).auth, `Bearer ${TOKEN}`)
  // a missing query arg drops its parameter; a missing path arg is refused
  assert.equal((await call('svc', 'item', { id: 7 })).data.url, '/api/items/7?fixed=yes')
  await code(call('svc', 'item', {}), 'refused')
  await code(call('svc', 'item', { id: '..' }), 'refused')
  await code(call('svc', 'item', { id: { nested: 1 } }), 'refused')
  // a declared POST: the manifest's body, GraphQL braces literal, "{n}" replaced by the arg
  const gql = await call('svc', 'graphql', { n: 3, query: 'mutation { evil }' })
  assert.deepEqual(gql.data.data, { query: 'query($n: Int) { items(first: $n) { id } }', variables: { n: 3 } })
  // undeclared call or connection, oversize, not JSON, redirect to another host, error status
  const before = seen.length
  await code(call('svc', 'secret'), 'refused')
  await code(call('nope', 'item', { id: 1 }), 'refused')
  assert.equal(seen.length, before, 'a refused call reached the service')
  await code(call('svc', 'big'), 'too_large')
  await code(call('svc', 'html'), 'not_json')
  await code(call('svc', 'away'), 'redirect')
  assert.deepEqual(foreignHits, [], 'a redirect was followed to another host')
  const err = await code(call('svc', 'status', { code: 403 }), 'http_error')
  assert.deepEqual([err.status, err.data], [403, { message: 'nope' }])
  // raw header scheme
  http.saveHttpProfile({ name: 'stub', baseUrl: base, header: 'X-API-Key', scheme: 'raw' })
  await call('svc', 'item', { id: 1 })
  assert.deepEqual([seen.at(-1).key, seen.at(-1).auth], [TOKEN, undefined]) // token kept when not re-sent
  // a foreign base URL is the only way to another host, and only the user sets it
  assert.throws(() => http.buildRequest({ baseUrl: base, header: 'Authorization', scheme: 'bearer' }, { method: 'GET', path: '//evil.example/x' }, {}), /path/)
  assert.throws(() => http.buildRequest({ baseUrl: base, header: 'Authorization', scheme: 'bearer' }, { method: 'DELETE', path: '/x' }, {}), /GET or POST/)

  // mcp: a stdio stub server; declared tools only; token only in its one variable
  const stubPath = fileURLToPath(new URL('./fixtures/connections/mcp-stub.mjs', import.meta.url))
  await code(call('tools', 'echo', { text: 'hi' }), 'not_configured')
  assert.throws(() => mcp.saveMcpServer({ name: 'stub', command: 'node', tokenEnv: 'lower' }), /variable/)
  mcp.saveMcpServer({ name: 'stub', command: process.execPath, args: [stubPath], tokenEnv: 'STUB_TOKEN', token: TOKEN })
  assert.ok(!JSON.stringify(mcp.listMcpServers()).includes(TOKEN))
  const t = await mcp.testMcpServer('stub')
  assert.deepEqual(t.data?.tools, ['bump', 'echo', 'hidden', 'token_seen'], JSON.stringify(t))
  const echo = await call('tools', 'echo', { text: 'hi' })
  assert.equal(echo.ok, true, JSON.stringify(echo))
  assert.deepEqual(echo.data.structuredContent, { echoed: 'hi' })
  await code(call('tools', 'hidden'), 'refused')
  const env = await call('tools', 'token_seen')
  assert.deepEqual(env.data.structuredContent, { length: TOKEN.length, home: true, leaked: false })
  await code(call('tools', 'echo', { text: 5 }), 'tool_error') // the tool's own validation, as data

  // task 027: confirmed writes. A token is one-time, bound to the exact call, and expires.
  const KEY = 'work.svc-writes'
  const wcall = (fn, connection, operation, args, token) => fn(ws, { key: KEY, connection, operation, args, token })
  const realNow = Date.now
  const expired = async (p) => {
    Date.now = () => realNow() + 5 * 60_000 + 1
    try {
      return await p()
    } finally {
      Date.now = realNow
    }
  }
  const confirmHttp = (operation, args) => http.httpConfirm(ws, { key: KEY, connection: 'svc', operation, args })
  let sent = seen.length
  await code(wcall(http.httpCall, 'svc', 'update', { id: 7, state: 'closed' }), 'confirmation_required')
  await code(wcall(http.httpCall, 'svc', 'update', { id: 7, state: 'closed' }, 'f'.repeat(48)), 'confirmation_required')
  await code(confirmHttp('item', { id: 1 }), 'refused') // a read needs no confirmation
  await code(confirmHttp('nope', {}), 'refused') // undeclared
  await code(call('svc', 'update', { id: 7, state: 'closed' }), 'refused') // another extension's write
  assert.equal(seen.length, sent, 'an unconfirmed write reached the service')
  const c1 = confirmHttp('update', { id: 7, state: 'closed' })
  assert.deepEqual(c1.summary, { kind: 'http-write', actor: 'Service writes (fixture)', connection: 'svc', operation: 'update', service: 'stub', method: 'PATCH', url: `${base}/items/7`, body: { state: 'closed', note: '{ literal }' } })
  assert.ok(!JSON.stringify(c1).includes(TOKEN))
  await code(wcall(http.httpCall, 'svc', 'update', { id: 7, state: 'closed' }, c1.token), undefined)
  assert.deepEqual([seen.at(-1).method, seen.at(-1).url, JSON.parse(seen.at(-1).body)], ['PATCH', '/api/items/7', { state: 'closed', note: '{ literal }' }])
  sent = seen.length
  await code(wcall(http.httpCall, 'svc', 'update', { id: 7, state: 'closed' }, c1.token), 'confirmation_required') // reused
  const c2 = confirmHttp('update', { id: 7, state: 'closed' })
  await code(wcall(http.httpCall, 'svc', 'update', { id: 8, state: 'closed' }, c2.token), 'confirmation_required') // other args
  await code(wcall(http.httpCall, 'svc', 'update', { id: 7, state: 'closed' }, c2.token), 'confirmation_required') // a mismatch spends it
  await code(wcall(http.httpCall, 'svc', 'update', { id: 7 }, confirmHttp('remove', { id: 7 }).token), 'confirmation_required') // other call
  const c3 = confirmHttp('remove', { id: 7 })
  await expired(() => code(wcall(http.httpCall, 'svc', 'remove', { id: 7 }, c3.token), 'confirmation_required'))
  const c4 = confirmHttp('remove', { id: 7 })
  http.saveHttpProfile({ name: 'stub', baseUrl: base + '/v2', header: 'X-API-Key', scheme: 'raw' }) // profile changed after confirming
  await code(wcall(http.httpCall, 'svc', 'remove', { id: 7 }, c4.token), 'confirmation_required')
  http.saveHttpProfile({ name: 'stub', baseUrl: base, header: 'X-API-Key', scheme: 'raw' })
  assert.equal(seen.length, sent, 'an unconfirmed write reached the service')
  await code(wcall(http.httpCall, 'svc', 'remove', { id: 7 }, confirmHttp('remove', { id: 7 }).token), undefined)
  assert.deepEqual([seen.at(-1).method, seen.at(-1).body, seen.length], ['DELETE', '', sent + 1])

  const confirmMcp = (operation, args) => mcp.mcpConfirm(ws, { key: KEY, connection: 'tools', operation, args })
  await code(wcall(mcp.mcpCall, 'tools', 'bump', { by: 2 }), 'confirmation_required')
  await code(confirmMcp('echo', { text: 'x' }), 'refused') // a read tool
  await code(confirmMcp('hidden', {}), 'refused') // undeclared
  await code(call('tools', 'bump', { by: 1 }), 'refused') // svc-calls doesn't declare it
  const m1 = confirmMcp('bump', { by: 2 })
  assert.deepEqual(m1.summary, { kind: 'mcp-write', actor: 'Service writes (fixture)', connection: 'tools', operation: 'bump', server: 'stub', args: { by: 2 } })
  assert.equal((await code(wcall(mcp.mcpCall, 'tools', 'bump', { by: 2 }, m1.token), undefined)).data.structuredContent.count, 2)
  await code(wcall(mcp.mcpCall, 'tools', 'bump', { by: 2 }, m1.token), 'confirmation_required') // reused
  await code(wcall(mcp.mcpCall, 'tools', 'bump', { by: 3 }, confirmMcp('bump', { by: 2 }).token), 'confirmation_required') // other args
  const m2 = confirmMcp('bump', { by: 1 })
  await expired(() => code(wcall(mcp.mcpCall, 'tools', 'bump', { by: 1 }, m2.token), 'confirmation_required'))
  // only the one confirmed call ran: the counter is 2, so this one makes it 3
  assert.equal((await code(wcall(mcp.mcpCall, 'tools', 'bump', { by: 1 }, confirmMcp('bump', { by: 1 }).token), undefined)).data.structuredContent.count, 3)

  // the token is only in the 0600 credentials file: not in other Helm files, not in the workspace
  const files = (dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile())
  for (const f of files(wsPath)) assert.ok(!readFileSync(f, 'utf8').includes(TOKEN), `token in ${f}`)
  for (const f of files(process.env.HELM_HOME)) if (!f.endsWith('credentials.json')) assert.ok(!readFileSync(f, 'utf8').includes(TOKEN), `token in ${f}`)
  assert.equal(statSync(join(process.env.HELM_HOME, 'credentials.json')).mode & 0o777, 0o600)
  // removing a profile or server removes its token
  http.removeHttpProfile('stub')
  mcp.removeMcpServer('stub')
  assert.ok(!readFileSync(join(process.env.HELM_HOME, 'credentials.json'), 'utf8').includes(TOKEN))
  console.log('connections check: ok (http: declared GET/POST, refusals, caps, redirect, token handling; mcp: declared tools, refusal, env; confirmed http/mcp writes)')
} finally {
  await mcp.closeAllMcp()
  stub.close()
  foreign.close()
  rmSync(tmp, { recursive: true, force: true })
}
