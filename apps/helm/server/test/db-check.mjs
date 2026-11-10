// `db` connection self-check against the built server (run `npm run build:server` first):
//   npm run check:db -w helm-command-deck
// SQLite always runs (a temp file). Postgres and MySQL run when these point at throwaway
// databases the check may seed (it creates and drops table `items`):
//   HELM_CHECK_PG=postgres://user:pass@127.0.0.1:5432/db  HELM_CHECK_MYSQL=mysql://user:pass@127.0.0.1:3306/db
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import mysql from 'mysql2/promise'
import pg from 'pg'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-db-')))
process.env.HELM_HOME = join(tmp, 'home')
process.env.HELM_KEYCHAIN = 'off' // exercise the 0600 file; the keychain path is the same calls
const wsPath = join(tmp, 'ws')
const ws = { id: 'w', name: 'w', path: wsPath, profile: 'read-only' }
mkdirSync(join(wsPath, 'work/helm/tools'), { recursive: true })
cpSync(fileURLToPath(new URL('./fixtures/db/tools/db-rows', import.meta.url)), join(wsPath, 'work/helm/tools/db-rows'), { recursive: true })
cpSync(fileURLToPath(new URL('./fixtures/db/tools/db-writes', import.meta.url)), join(wsPath, 'work/helm/tools/db-writes'), { recursive: true })
// the same write queries in a manifest without permissions.write
const noPerm = join(wsPath, 'work/helm/tools/db-writes-noperm')
cpSync(join(wsPath, 'work/helm/tools/db-writes'), noPerm, { recursive: true })
const noPermManifest = JSON.parse(readFileSync(join(noPerm, 'manifest.json'), 'utf8'))
delete noPermManifest.permissions
writeFileSync(join(noPerm, 'manifest.json'), JSON.stringify({ ...noPermManifest, id: 'db-writes-noperm' }))

const db = await import('../dist/db.js')
const { TOKEN_TTL_MS } = await import('../dist/confirm.js')
const call = (connection, operation, args = {}) => db.dbCall(ws, { key: 'work.db-rows', connection, operation, args })
const code = async (p, expected) => {
  const r = await p
  assert.equal(r.error?.code, expected, JSON.stringify(r))
  return r
}
const secrets = []
const noSecret = (r) => secrets.forEach((s) => assert.ok(!JSON.stringify(r).includes(s), 'a password reached a result'))

// the DB explorer (built-in tool) runs ad hoc SQL under the same guards; reuse the fixture's SQL
const manifest = JSON.parse(readFileSync(new URL('./fixtures/db/tools/db-rows/manifest.json', import.meta.url), 'utf8'))
const fixtureSql = (name, op) => manifest.connections.find((c) => c.id === name).queries[op].sql
async function explorer(name) {
  const profile = `fixture-${name}`
  const adhoc = (sql) => db.exploreQuery(profile, { sql })
  const schema = await db.exploreSchema(profile)
  assert.ok(schema.ok, JSON.stringify(schema))
  assert.deepEqual(schema.data.rows.filter((r) => r[1] === 'items').map((r) => r[2]), ['id', 'name'])
  noSecret(schema)
  const page = await adhoc('SELECT name FROM items ORDER BY id LIMIT 2 OFFSET 1')
  assert.deepEqual(page.data?.rows, [['beta'], ['gamma <b>']], JSON.stringify(page))
  for (const op of ['write', 'ddl']) noSecret(await code(adhoc(fixtureSql(name, op)), 'query_failed'))
  await code(adhoc('DELETE FROM items'), 'query_failed')
  // one statement only: a second one is never run
  await code(adhoc("SELECT 1; INSERT INTO items (name) VALUES ('second statement')"), 'query_failed')
  assert.equal((await adhoc('SELECT count(*) FROM items')).data.rows[0].map(Number)[0], 3, 'an explorer write went through')
  await code(adhoc(fixtureSql(name, 'many')), 'too_many_rows')
  await code(adhoc(fixtureSql(name, 'slow')), 'timeout')
  await code(adhoc('  '), 'refused')
  await code(adhoc('SELECT ' + 'x'.repeat(17 * 1024)), 'refused')
  await assert.rejects(db.exploreSchema('no-such-profile'), /No database profile/)
}

// writes (task 025): declared write queries and explorer writes run only with a confirmed one-time token
const wkey = 'work.db-writes'
const wcall = (connection, operation, args, token, key = wkey) => db.dbCall(ws, { key, connection, operation, args, token })
const confirm = (connection, operation, args, key = wkey) => db.dbConfirm(ws, { key, connection, operation, args })
const nameOf = async (name, id) => (await call(name, 'items', { minId: id })).data.rows[0][1]
const writesManifest = JSON.parse(readFileSync(new URL('./fixtures/db/tools/db-writes/manifest.json', import.meta.url), 'utf8'))
async function writes(name) {
  const args = { name: 'renamed', id: 2 }
  // no token, a made-up token, or a manifest without permissions.write: refused, row unchanged
  await code(wcall(name, 'rename', args), 'confirmation_required')
  await code(wcall(name, 'rename', args, 'f'.repeat(48)), 'confirmation_required')
  await code(wcall(name, 'rename', args, undefined, 'work.db-writes-noperm'), 'refused')
  await code(confirm(name, 'rename', args, 'work.db-writes-noperm'), 'refused')
  await code(confirm(name, 'items', { minId: 1 }), 'refused') // reads need no confirmation
  assert.equal(await nameOf(name, 2), 'beta')
  // the dialog's summary comes from the declaration, with the bound args
  const c = confirm(name, 'rename', args)
  assert.equal(c.summary.sql, writesManifest.connections.find((x) => x.id === name).queries.rename.sql)
  assert.deepEqual([c.summary.actor, c.summary.operation, c.summary.profile, c.summary.args], ['DB writes (fixture)', 'rename', `fixture-${name}`, ['renamed', 2]])
  noSecret(c)
  // different args than confirmed: refused, and the token is spent by the attempt
  await code(wcall(name, 'rename', { ...args, id: 3 }, c.token), 'confirmation_required')
  await code(wcall(name, 'rename', args, c.token), 'confirmation_required')
  assert.equal(await nameOf(name, 2), 'beta')
  // confirmed: runs once, read-write
  const ok = confirm(name, 'rename', args)
  const r = await wcall(name, 'rename', args, ok.token)
  assert.ok(r.ok, JSON.stringify(r))
  assert.equal(r.data.rowsAffected, 1)
  assert.equal(await nameOf(name, 2), 'renamed')
  await code(wcall(name, 'rename', args, ok.token), 'confirmation_required') // reused
  // expired
  const late = confirm(name, 'rename', { name: 'beta', id: 2 })
  const now = Date.now
  Date.now = () => now() + TOKEN_TTL_MS + 1000
  try {
    await code(wcall(name, 'rename', { name: 'beta', id: 2 }, late.token), 'confirmation_required')
  } finally {
    Date.now = now
  }
  assert.equal(await nameOf(name, 2), 'renamed')
  const back = confirm(name, 'rename', { name: 'beta', id: 2 })
  assert.ok((await wcall(name, 'rename', { name: 'beta', id: 2 }, back.token)).ok)
  // the read-only checks still hold next to write queries
  await code(call(name, 'write'), 'query_failed')

  // DB explorer: refused until the toggle is confirmed; then each statement is confirmed
  const profile = `fixture-${name}`
  const upd = "UPDATE items SET name = 'explored' WHERE id = 3"
  await code(db.exploreWrite(profile, { sql: upd }), 'refused')
  assert.throws(() => db.exploreConfirm(profile, { sql: upd }), /Writes are off/)
  assert.throws(() => db.setExplorerWrites(profile, { enabled: true }), /confirmation/)
  assert.throws(() => db.setExplorerWrites(profile, { enabled: true, token: confirm(name, 'rename', args).token }), /confirmation/) // a token for something else
  const on = db.exploreConfirm(profile, { enable: true })
  assert.deepEqual([on.summary.kind, on.summary.profile], ['explorer-writes', profile])
  assert.deepEqual(db.setExplorerWrites(profile, { enabled: true, token: on.token }), { enabled: true })
  assert.ok(db.explorerWritesOn().includes(profile))
  await code(db.exploreWrite(profile, { sql: upd }), 'confirmation_required')
  const st = db.exploreConfirm(profile, { sql: upd })
  assert.equal(st.summary.sql, upd)
  await code(db.exploreWrite(profile, { sql: upd + ' ', token: st.token }), 'confirmation_required') // different SQL
  const st2 = db.exploreConfirm(profile, { sql: upd })
  const w = await db.exploreWrite(profile, { sql: upd, token: st2.token })
  assert.equal(w.data?.rowsAffected, 1, JSON.stringify(w))
  assert.equal(await nameOf(name, 3), 'explored')
  // Run stays read-only while writes are on
  await code(db.exploreQuery(profile, { sql: 'DELETE FROM items WHERE id = 3' }), 'query_failed')
  const restore = "UPDATE items SET name = 'gamma <b>' WHERE id = 3"
  assert.ok((await db.exploreWrite(profile, { sql: restore, token: db.exploreConfirm(profile, { sql: restore }).token })).ok)
  // off needs no confirmation, and then writes are refused again even with a fresh token
  const fresh = db.exploreConfirm(profile, { sql: upd })
  assert.deepEqual(db.setExplorerWrites(profile, { enabled: false }), { enabled: false })
  await code(db.exploreWrite(profile, { sql: upd, token: fresh.token }), 'refused')
  assert.equal(await nameOf(name, 3), 'gamma <b>')
}

async function engine(name, setup) {
  const t0 = Date.now()
  await setup()
  const items = await call(name, 'items', { minId: 2 })
  assert.ok(items.ok, JSON.stringify(items))
  assert.deepEqual(items.data.columns, ['id', 'name'])
  assert.deepEqual(items.data.rows.map((r) => [Number(r[0]), r[1]]), [[2, 'beta'], [3, 'gamma <b>']])
  noSecret(items)
  // writes inside "read" queries are refused by the database itself
  noSecret(await code(call(name, 'write'), 'query_failed'))
  noSecret(await code(call(name, 'ddl'), 'query_failed'))
  assert.equal((await call(name, 'items', { minId: 1 })).data.rows.length, 3, 'a write went through')
  await code(call(name, 'many'), 'too_many_rows')
  const slow = Date.now()
  await code(call(name, 'slow'), 'timeout')
  assert.ok(Date.now() - slow < db.TIMEOUT_MS + 1500, 'timeout was late')
  // the server binds only declared params, of plain types
  await code(call(name, 'items', { minId: { $gt: 0 } }), 'refused')
  await code(call(name, 'nope'), 'refused')
  await code(call(name, 'toString'), 'refused')
  await explorer(name)
  await writes(name)
  console.log(`  ${name} ok (${Date.now() - t0} ms)`)
}

try {
  // sqlite: a temp file, opened read-only by Helm
  const file = join(tmp, 'app.db')
  const w = new DatabaseSync(file)
  w.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('alpha'), ('beta'), ('gamma <b>')")
  w.close()
  await code(call('sqlite', 'items'), 'not_configured')
  await engine('sqlite', async () => db.saveProfile({ name: 'fixture-sqlite', engine: 'sqlite', path: file }))

  const seed = async (exec) => {
    await exec('DROP TABLE IF EXISTS plugin_made')
    await exec('DROP TABLE IF EXISTS items')
    await exec('CREATE TABLE items (id INT PRIMARY KEY, name VARCHAR(40))')
    await exec("INSERT INTO items VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma <b>')")
  }
  for (const [name, env] of [['postgres', process.env.HELM_CHECK_PG], ['mysql', process.env.HELM_CHECK_MYSQL]]) {
    if (!env) {
      console.log(`  ${name} skipped (set HELM_CHECK_${name === 'postgres' ? 'PG' : 'MYSQL'})`)
      continue
    }
    const u = new URL(env)
    const password = decodeURIComponent(u.password)
    secrets.push(password)
    const profile = { name: `fixture-${name}`, engine: name, host: u.hostname, port: Number(u.port), database: u.pathname.slice(1), user: decodeURIComponent(u.username) }
    await engine(name, async () => {
      if (name === 'postgres') {
        const c = new pg.Client({ connectionString: env })
        await c.connect()
        await seed((q) => c.query(q))
        await c.end()
      } else {
        const c = await mysql.createConnection(env)
        await seed((q) => c.query(q))
        await c.end()
      }
      // a wrong password fails cleanly and is not echoed
      db.saveProfile({ ...profile, password: 'wrong-' + password })
      secrets.push('wrong-' + password)
      noSecret(await code(db.testProfile(profile.name), 'query_failed'))
      db.saveProfile({ ...profile, password })
      assert.ok((await db.testProfile(profile.name)).ok)
      // the profile listing never carries the password
      const listed = db.listProfiles()
      noSecret(listed)
      assert.equal(listed.profiles.find((p) => p.name === profile.name).hasPassword, true)
    })
  }

  // saving a profile again turns its explorer writes off
  db.setExplorerWrites('fixture-sqlite', { enabled: true, token: db.exploreConfirm('fixture-sqlite', { enable: true }).token })
  db.saveProfile({ name: 'fixture-sqlite', engine: 'sqlite', path: file })
  assert.ok(!db.explorerWritesOn().includes('fixture-sqlite'))

  // a profile on the wrong engine is refused before connecting
  db.saveProfile({ name: 'fixture-postgres', engine: 'sqlite', path: file })
  await code(call('postgres', 'items', { minId: 1 }), 'refused')

  // storage: profiles without secrets, passwords in a 0600 file
  const home = process.env.HELM_HOME
  noSecret(readFileSync(join(home, 'db.json'), 'utf8'))
  if (secrets.length) assert.equal(statSync(join(home, 'credentials.json')).mode & 0o777, 0o600)
  db.removeProfile('fixture-postgres')
  assert.ok(!db.listProfiles().profiles.some((p) => p.name === 'fixture-postgres'))
  console.log('db-check ok')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
