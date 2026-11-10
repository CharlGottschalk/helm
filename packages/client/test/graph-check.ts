// brainGraph paging self-check. Needs a running Helm dev server (token "dev") on a
// workspace whose TDT has tdt_brain_graph:
//   HELM_URL=http://127.0.0.1:4317 HELM_WS=main npx tsx packages/client/test/graph-check.ts
import assert from 'node:assert/strict'
import { brainGraph } from '../src/tdt'

const base = process.env.HELM_URL ?? 'http://127.0.0.1:4317'
const ws = process.env.HELM_WS ?? 'main'
let calls = 0
const real = async (w: string, name: string, args: Record<string, unknown> = {}) => {
  calls++
  const res = await fetch(`${base}/api/workspaces/${w}/tools/${name}`, {
    method: 'POST', headers: { Authorization: 'Bearer dev', 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  return res.json()
}
const ids = (g: { nodes: { id: string }[]; links: { source: string; target: string }[] }) =>
  [g.nodes.map((n) => n.id).sort(), g.links.map((l) => `${l.source}>${l.target}`).sort()]

// One big page, then the same workspace again: the first page's revision matches the cache.
const whole = await brainGraph(real as never, ws)
calls = 0
assert.equal(await brainGraph(real as never, ws, 20), whole)
assert.equal(calls, 1)

// Pages of 20 under a fresh cache key, routed back to the real workspace.
const viaKey = (_w: string, name: string, args?: Record<string, unknown>) => real(ws, name, args)
calls = 0
const multi = await brainGraph(viaKey as never, 'paged', 20)
const pages = calls
assert.ok(pages > 1, `expected several pages, got ${pages}`)
assert.deepEqual(ids(multi), ids(whole))
assert.equal(multi.revision, whole.revision)
calls = 0
assert.equal(await brainGraph(viaKey as never, 'paged', 20), multi, 'unchanged revision returns the cached object')
assert.equal(calls, 1)

// Stale cursor mid-paging (TDT: retry "reread") restarts once from the first page.
let stale = true
const flaky = async (_w: string, name: string, args: Record<string, unknown> = {}) => {
  if (args.cursor && stale) {
    stale = false
    return { ok: false, data: null, error: { code: 'stale_cursor', message: 'stale', retry: 'reread' } }
  }
  return real(ws, name, args)
}
const restarted = await brainGraph(flaky as never, 'flaky', 20)
assert.deepEqual(ids(restarted), ids(whole))
// A second stale cursor after the restart surfaces the error.
const alwaysStale = async (_w: string, name: string, args: Record<string, unknown> = {}) =>
  args.cursor ? { ok: false, data: null, error: { code: 'stale_cursor', message: 'stale', retry: 'reread' } } : real(ws, name, args)
await assert.rejects(brainGraph(alwaysStale as never, 'stale', 20), /stale/)

console.log(`graph-check ok: ${whole.nodes.length} nodes, ${whole.links.length} links, ${pages} pages of 20`)
