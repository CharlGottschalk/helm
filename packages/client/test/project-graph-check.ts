// projectGraph paging/caching self-check against a stub tdt_project_graph (no server):
//   npx tsx packages/client/test/project-graph-check.ts
import assert from 'node:assert/strict'
import { projectGraph } from '../src/tdt'

const N = 7
const nodes = Array.from({ length: N }, (_, i) => ({ id: `src/f${i}.ts`, kind: 'code', symbols: [`f${i}()`], symbols_total: 1 }))
let revision = 'r1'
let calls = 0
let staleOnce = false
const meta = (status: string) => ({
  project: 'p', status, revision, schema_version: 1, graphify_version: '0.9.107', built_at: '2026-11-12T09:00:00+00:00',
  built_at_commit: 'abc', code_only: true, hook_installed: false, nodes_total: N, links_total: N - 1,
})
const stub = async (_ws: string, name: string, args: Record<string, unknown> = {}) => {
  calls++
  assert.equal(name, 'tdt_project_graph')
  if (args.id === 'none') return { ok: true, data: { ...meta('no_graph'), nodes: [], links: [], next_cursor: null } }
  if (args.cursor && staleOnce) {
    staleOnce = false
    return { ok: false, data: null, error: { code: 'stale_cursor', message: 'stale', retry: 'reread' } }
  }
  const start = Number(args.cursor ?? 0)
  const limit = Number(args.limit)
  const page = nodes.slice(start, start + limit)
  // each link arrives with its source node's page
  const links = page.filter((n) => n.id !== 'src/f0.ts').map((n) => ({ source: n.id, target: 'src/f0.ts', relation: 'imports_from', confidence: 'EXTRACTED' }))
  const next = start + limit < N ? String(start + limit) : null
  return { ok: true, data: { ...meta('graph'), nodes: page, links, next_cursor: next } }
}
const call = stub as never

const g = await projectGraph(call, 'ws', 'p', 3)
assert.equal(calls, 3, 'three pages of 3 for 7 nodes')
assert.equal(g.nodes.length, N)
assert.equal(g.links.length, N - 1)
assert.equal(g.hook_installed, false)
assert.ok(!('next_cursor' in g), 'cursor is not part of the merged graph')

calls = 0
assert.equal(await projectGraph(call, 'ws', 'p', 3), g, 'unchanged revision returns the cached object')
assert.equal(calls, 1)

revision = 'r2'
staleOnce = true
calls = 0
const restarted = await projectGraph(call, 'ws', 'p', 3)
assert.notEqual(restarted, g)
assert.equal(restarted.revision, 'r2')
assert.equal(restarted.nodes.length, N, 'stale cursor restarts once from the first page')

const none = await projectGraph(call, 'ws', 'none')
assert.equal(none.status, 'no_graph')
assert.deepEqual(none.nodes, [])

await assert.rejects(
  projectGraph((async () => ({ ok: false, data: null, error: { code: 'unsupported_schema', message: 'schema 2', retry: null } })) as never, 'ws', 'x'),
  (e: { code: string }) => e.code === 'unsupported_schema',
)
console.log('project-graph-check ok')
