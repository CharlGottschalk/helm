// `files` connection self-check against the built server (run `npm run build:server` first):
//   npm run check:files -w helm-command-deck
// A throwaway workspace with a work/helm tool that declares files connections and parses
// software-production task files itself, the way a plugin would. No network, no TDT.
// Also covers task 027's confirmed `write` (hash-checked replace of one declared file).
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-files-')))
process.env.HELM_HOME = join(tmp, 'home')
const put = (path, text) => (mkdirSync(join(path, '..'), { recursive: true }), writeFileSync(path, text))
const wsPath = join(tmp, 'ws')
const project = join(tmp, 'project')
const ws = { id: 'w', name: 'w', path: wsPath, profile: 'read-only' }
const PID = 'a'.repeat(64)
const SP = '.tdt-project/tdt-software-production'

put(join(project, SP, 'config.json'), '{"task_system":{"kind":"internal"}}')
put(join(project, SP, 'tasks/018.md'), '# 018 — files kind\n\nStatus: doing\nPriority: medium\n')
put(join(project, SP, 'tasks/big.md'), 'x'.repeat(300 * 1024))
put(join(project, 'src/secret.ts'), 'secret')
put(join(tmp, 'outside.md'), 'outside')
symlinkSync(join(tmp, 'outside.md'), join(project, SP, 'tasks/link.md'))
symlinkSync(join(project, 'src'), join(project, SP, 'linked-dir'))
put(join(wsPath, `.tdt/state/software-production/${PID}/tasks/018.md`), '# handoff')
put(join(wsPath, 'work/helm/tools/sp-write/manifest.json'), JSON.stringify({
  contract: 'helm.tool/1', id: 'sp-write', name: 'SP write', description: 'x', version: '1.0.0', icon: 'layers', entry: 'index.html',
  permissions: { write: true },
  connections: [{ id: 'spw', kind: 'files', root: 'project', paths: [`${SP}/tasks/*.md`], operations: ['read', 'write'] }],
}))
put(join(wsPath, 'work/helm/tools/sp-check/manifest.json'), JSON.stringify({
  contract: 'helm.tool/1', id: 'sp-check', name: 'SP check', description: 'x', version: '1.0.0', icon: 'layers', entry: 'index.html',
  connections: [
    { id: 'sp', kind: 'files', root: 'project', paths: [`${SP}/**`], operations: ['list', 'read'] },
    { id: 'handoffs', kind: 'files', root: 'workspace', paths: ['.tdt/state/software-production/*/tasks/*.md'], operations: ['read'] },
    { id: 'tdt', kind: 'tdt-mcp', operations: ['tdt_project_list'] },
  ],
}))

const bridges = { get: () => ({ call: async (_tool, { reference }) =>
  reference === PID ? { ok: true, data: { project: { path: project, availability: 'available' } } } : { ok: false, data: null, error: { message: 'Unknown project' } } }) }
const { filesCall, filesConfirm, diffLines } = await import('../dist/files.js')
const call = (connection, operation, args = {}) => filesCall(bridges, ws, { key: 'work.sp-check', connection, operation, args })
const refused = async (p, code = 'refused') => assert.equal((await p).error?.code, code, JSON.stringify(await p))

try {
  // list: only declared, regular, non-symlinked files
  const list = await call('sp', 'list', { project: PID })
  assert.ok(list.ok, JSON.stringify(list))
  assert.deepEqual(list.data.files.map((f) => f.path), [`${SP}/config.json`, `${SP}/tasks/018.md`, `${SP}/tasks/big.md`])

  // read + parse in the "plugin"
  const t = await call('sp', 'read', { project: PID, path: `${SP}/tasks/018.md` })
  assert.equal(t.data.text.match(/^Status:\s*(.+)$/m)[1], 'doing')
  assert.ok((await call('handoffs', 'read', { path: `.tdt/state/software-production/${PID}/tasks/018.md` })).ok)

  // batch read: per-file results, refusals inline, never a whole-call failure
  const batch = await call('sp', 'read', { project: PID, paths: [`${SP}/tasks/018.md`, 'src/secret.ts', `${SP}/tasks/big.md`] })
  assert.ok(batch.ok, JSON.stringify(batch))
  assert.equal(batch.data.files[0].text.startsWith('# 018'), true)
  assert.deepEqual(batch.data.files.slice(1).map((f) => f.error?.code), ['refused', 'too_large'])
  await refused(call('sp', 'read', { project: PID, paths: [] }))
  await refused(call('sp', 'read', { project: PID, paths: Array(101).fill(`${SP}/tasks/018.md`) }))

  // refusals
  await refused(call('sp', 'read', { project: PID, path: 'src/secret.ts' }))               // outside declared globs
  await refused(call('sp', 'read', { project: PID, path: `${SP}/../src/secret.ts` }))      // escape
  await refused(call('sp', 'read', { project: PID, path: `${SP}/tasks/link.md` }))         // symlinked file
  await refused(call('sp', 'read', { project: PID, path: `${SP}/linked-dir/secret.ts` }))  // symlinked directory
  await refused(call('sp', 'read', { project: PID, path: `${SP}/tasks/*.md` }))            // a glob is not a path
  await refused(call('sp', 'read', { project: PID, path: `${SP}/tasks/big.md` }), 'too_large')
  await refused(call('sp', 'read', { project: PID, path: `${SP}/tasks/nope.md` }), 'not_found')
  await refused(call('sp', 'write', { project: PID }))                                     // undeclared operation
  await refused(call('handoffs', 'list'))                                                  // declared read only
  await refused(call('tdt', 'list'))                                                       // not a files connection
  await refused(call('sp', 'list', { project: 'b'.repeat(64) }), 'unavailable')            // unknown project
  await assert.rejects(filesCall(bridges, ws, { key: 'work.other', connection: 'sp', operation: 'list' }), (e) => e.status === 404)

  // task 027 writes: read returns the hash; write replaces the file only with a confirmed token and a matching hash
  const task = join(project, SP, 'tasks/018.md')
  chmodSync(task, 0o640)
  const original = readFileSync(task, 'utf8')
  const w = (args, token) => filesCall(bridges, ws, { key: 'work.sp-write', connection: 'spw', operation: 'write', args: { project: PID, ...args }, token })
  const confirm = (args) => filesConfirm(bridges, ws, { key: 'work.sp-write', connection: 'spw', operation: 'write', args: { project: PID, ...args } })
  const r = await filesCall(bridges, ws, { key: 'work.sp-write', connection: 'spw', operation: 'read', args: { project: PID, path: `${SP}/tasks/018.md` } })
  const path = `${SP}/tasks/018.md`
  const text = r.data.text.replace('Status: doing', 'Status: done')
  const unchanged = () => assert.equal(readFileSync(task, 'utf8'), original, 'a refused write changed the file')
  await refused(w({ path, text, expected_sha256: r.data.sha256 }), 'confirmation_required')
  await refused(w({ path, text, expected_sha256: r.data.sha256 }, 'f'.repeat(48)), 'confirmation_required')
  await refused(confirm({ path, text, expected_sha256: 'b'.repeat(64) }), 'conflict') // stale hash at confirm
  await refused(confirm({ path: 'src/secret.ts', text, expected_sha256: r.data.sha256 }))  // undeclared path
  await refused(confirm({ path: `${SP}/tasks/new.md`, text, expected_sha256: r.data.sha256 }), 'not_found') // never creates
  await refused(confirm({ path: `${SP}/tasks/link.md`, text, expected_sha256: r.data.sha256 })) // symlink
  await refused(confirm({ path, text: 'x'.repeat(300 * 1024), expected_sha256: r.data.sha256 }), 'too_large')
  await refused(filesConfirm(bridges, ws, { key: 'work.sp-check', connection: 'sp', operation: 'write', args: { project: PID, path, text, expected_sha256: r.data.sha256 } })) // read-only connection
  const c = await confirm({ path, text, expected_sha256: r.data.sha256 })
  assert.equal(c.summary.kind, 'files-write')
  unchanged() // confirming alone writes nothing: task 028's "Move and start build" never spends the token
  assert.deepEqual([c.summary.actor, c.summary.root, c.summary.path], ['SP write', 'project', path])
  assert.deepEqual(c.summary.diff.filter((d) => d.op !== ' '), [{ op: '-', line: 3, text: 'Status: doing' }, { op: '+', line: 3, text: 'Status: done' }])
  await refused(w({ path, text: text + 'more', expected_sha256: r.data.sha256 }, c.token), 'confirmation_required') // other text spends it
  unchanged()
  // a file changed after confirming: refused, and the other change survives
  const c2 = await confirm({ path, text, expected_sha256: r.data.sha256 })
  writeFileSync(task, original + 'edited elsewhere\n')
  await refused(w({ path, text, expected_sha256: r.data.sha256 }, c2.token), 'conflict')
  assert.equal(readFileSync(task, 'utf8'), original + 'edited elsewhere\n')
  writeFileSync(task, original)
  // expired
  const c3 = await confirm({ path, text, expected_sha256: r.data.sha256 })
  const realNow = Date.now
  Date.now = () => realNow() + 5 * 60_000 + 1
  try {
    await refused(w({ path, text, expected_sha256: r.data.sha256 }, c3.token), 'confirmation_required')
  } finally {
    Date.now = realNow
  }
  unchanged()
  // confirmed: written once, mode kept, no temp file left; the token can't be reused
  const c4 = await confirm({ path, text, expected_sha256: r.data.sha256 })
  const done = await w({ path, text, expected_sha256: r.data.sha256 }, c4.token)
  assert.ok(done.ok, JSON.stringify(done))
  assert.equal(readFileSync(task, 'utf8'), text)
  assert.equal(statSync(task).mode & 0o777, 0o640)
  assert.deepEqual(readdirSync(join(project, SP, 'tasks')).filter((f) => f.startsWith('.')), [])
  assert.equal(done.data.sha256, (await filesCall(bridges, ws, { key: 'work.sp-write', connection: 'spw', operation: 'read', args: { project: PID, path } })).data.sha256)
  await refused(w({ path, text, expected_sha256: done.data.sha256 }, c4.token), 'confirmation_required')
  // the diff is one block with context
  assert.deepEqual(diffLines('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne').diff.map((d) => d.op + d.text), [' a', ' b', '-c', '+X', ' d', ' e'])
  assert.deepEqual(diffLines('a', 'a').diff, [])
  console.log('files-check ok')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
