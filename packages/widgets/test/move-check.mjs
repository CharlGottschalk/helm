// Task 028: the move dialog's outcome does exactly one thing (Node 24 strips the .ts types).
// Run: npm run check:move -w @helm/widgets
import assert from 'node:assert/strict'
import { settleMove } from '../src/move.ts'

const run = async (choice, { writeOk = true, buildFails = false } = {}) => {
  const did = []
  const r = await settleMove(
    choice,
    async () => (did.push('write'), writeOk ? { ok: true, data: { path: 'p', sha256: 'h' } } : { ok: false, data: null, error: { code: 'conflict', message: 'changed' } }),
    async () => {
      did.push('build')
      if (buildFails) throw new Error('no server')
    },
  )
  return { r, did }
}

let x = await run('cancel')
assert.deepEqual(x.did, [])
assert.deepEqual(x.r, { ok: false, choice: 'cancel', error: 'Declined by the user' })
x = await run('build')
assert.deepEqual(x.did, ['build'])
assert.deepEqual(x.r, { ok: true, choice: 'build' })
x = await run('build', { buildFails: true })
assert.deepEqual(x.did, ['build'])
assert.equal(x.r.ok, false)
assert.equal(x.r.error, 'no server')
x = await run('write')
assert.deepEqual(x.did, ['write'])
assert.equal(x.r.ok, true)
assert.equal(x.r.write.data.sha256, 'h')
x = await run('write', { writeOk: false })
assert.deepEqual(x.did, ['write'])
assert.equal(x.r.ok, false)
assert.equal(x.r.write.error.code, 'conflict')
assert.equal(x.r.error, 'changed')
console.log('move-check ok')

// Task 026: orWrite accepts any declared files/http/mcp write, nothing else
const { orWriteKind } = await import('../src/move.ts')
const decls = [
  { id: 'tasks', kind: 'files', root: 'project', paths: ['t/*.md'], operations: ['read', 'write'] },
  { id: 'ro', kind: 'files', root: 'project', paths: ['t/*.md'], operations: ['read'] },
  { id: 'linear', kind: 'http', service: 'linear', calls: { issues: { method: 'POST', path: '/graphql', body: {} }, setState: { method: 'POST', path: '/graphql', body: {}, write: true } } },
  { id: 'gh', kind: 'mcp', server: 'github', operations: ['list_issues'], writes: ['update_issue'] },
  { id: 'db', kind: 'db', service: 'x', engine: 'sqlite', queries: { w: { sql: 'UPDATE t SET a = 1', write: true } } },
]
assert.equal(orWriteKind(decls, 'tasks', 'write'), 'files')
assert.equal(orWriteKind(decls, 'linear', 'setState'), 'http')
assert.equal(orWriteKind(decls, 'gh', 'update_issue'), 'mcp')
assert.equal(orWriteKind(decls, 'linear', 'issues'), null, 'http read')
assert.equal(orWriteKind(decls, 'gh', 'list_issues'), null, 'mcp read')
assert.equal(orWriteKind(decls, 'ro', 'write'), null, 'undeclared files write')
assert.equal(orWriteKind(decls, 'gh', 'delete_repo'), null, 'undeclared tool')
assert.equal(orWriteKind(decls, 'nope', 'write'), null, 'undeclared connection')
assert.equal(orWriteKind(decls, 'db', 'w'), null, 'db is not an orWrite kind')
console.log('orWrite-check ok')
