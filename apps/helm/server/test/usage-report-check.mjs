// Token usage report self-check (task 050) against the built server (run `npm run build:server` first):
//   npm run check:usage-report -w @usetdt/helm
// Fixture transcripts in both hosts' shapes, including repeated response lines, a resumed copy, a
// subagent file, Codex repeats and malformed lines: totals match a hand sum, message text and
// paths never appear, and an empty HOME gives an empty report.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-usage-report-')))
process.env.HELM_HOME = join(tmp, 'home')
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude')
process.env.CODEX_HOME = join(tmp, 'codex')
const r = await import('../dist/usage-report.js')
const SECRET = 'TOP-SECRET-MESSAGE-TEXT'
const day = new Date(2026, 10, 12) // local midnight
const at = (h, m = 0) => new Date(2026, 10, 12, h, m).toISOString()
const jl = (rows) => rows.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n'

try {
  // empty HOME: nothing, no errors
  const none = r.usageReport(day.getTime(), day.getTime() + 86_400_000)
  assert.equal(none.sessions.length, 0)
  assert.equal(none.days.length, 1)
  assert.deepEqual(none.days[0].claude, { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })

  // Claude: a response written on two lines (counted once, larger output wins), a second response,
  // a user line with text, a malformed line, and a subagent file for the same session
  const proj = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-secret-path-myproj')
  mkdirSync(join(proj, 'sess-a', 'subagents'), { recursive: true })
  const asst = (id, req, ts, u, text = SECRET) => ({ type: 'assistant', requestId: req, timestamp: ts, cwd: '/secret/path/myproj', sessionId: 'sess-a', message: { id, model: 'claude-opus-5-5', content: [{ type: 'text', text }], usage: u } })
  const u1 = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 50 }
  writeFileSync(join(proj, 'sess-a.jsonl'), jl([
    { type: 'user', timestamp: at(9), cwd: '/secret/path/myproj', message: { content: SECRET } },
    asst('m1', 'r1', at(9, 1), { ...u1, output_tokens: 20 }),
    asst('m1', 'r1', at(9, 1), u1),
    '{not json',
    asst('m2', 'r2', at(10), { input_tokens: 5, cache_creation_input_tokens: 200, cache_read_input_tokens: 6000, output_tokens: 30 }),
    asst('m0', 'r0', at(23, 59), { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
  ]))
  writeFileSync(join(proj, 'sess-a', 'subagents', 'agent-1.jsonl'), jl([
    { ...asst('m3', 'r3', at(9, 30), { input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 400, output_tokens: 7 }), isSidechain: true },
  ]))
  // a resumed session that copied m2 (same id) and added m4, plus one entry on the previous day
  writeFileSync(join(proj, 'sess-b.jsonl'), jl([
    asst('m2', 'r2', at(10), { input_tokens: 5, cache_creation_input_tokens: 200, cache_read_input_tokens: 6000, output_tokens: 30 }),
    asst('m4', 'r4', at(14), { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 1000, output_tokens: 40 }),
    asst('m5', 'r5', new Date(2026, 10, 11, 22).toISOString(), { input_tokens: 9, cache_creation_input_tokens: 9, cache_read_input_tokens: 9, output_tokens: 9 }),
  ]))

  // Codex: session meta, model, per-turn counts, a repeated total, a null info and a malformed line
  const cdir = join(process.env.CODEX_HOME, 'sessions', '2026', '11', '12')
  mkdirSync(cdir, { recursive: true })
  const tc = (ts, total, last) => ({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: last } } })
  writeFileSync(join(cdir, 'rollout-x.jsonl'), jl([
    { timestamp: at(11), type: 'session_meta', payload: { id: 'cx-1', cwd: '/secret/path/codexproj', base_instructions: { text: SECRET } } },
    { timestamp: at(11), type: 'turn_context', payload: { model: 'gpt-5.6-sol', cwd: '/secret/path/codexproj' } },
    { timestamp: at(11), type: 'response_item', payload: { type: 'message', content: [{ type: 'input_text', text: SECRET }] } },
    { timestamp: at(11, 1), type: 'event_msg', payload: { type: 'token_count', info: null } },
    tc(at(11, 2), 1100, { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 100, total_tokens: 1100 }),
    tc(at(11, 3), 1100, { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 100, total_tokens: 1100 }),
    'garbage',
    tc(at(11, 4), 3100, { input_tokens: 1900, cached_input_tokens: 1500, cache_write_input_tokens: 0, output_tokens: 100, total_tokens: 2000 }),
  ]))

  const rep = r.usageReport(day.getTime(), day.getTime() + 86_400_000)
  const d = rep.days[0]
  // hand sum: m1 (final line) + m2 once + m3 (subagent) + m4; m5 is the day before; m0 is empty
  assert.deepEqual(d.claude, { input: 10 + 5 + 1 + 2, cacheWrite: 1000 + 200 + 100 + 300, cacheRead: 5000 + 6000 + 400 + 1000, output: 50 + 30 + 7 + 40 })
  // Codex: fresh input = input − cached; the repeat total is skipped
  assert.deepEqual(d.codex, { input: 400 + 400, cacheWrite: 0, cacheRead: 600 + 1500, output: 200 })
  assert.equal(rep.skipped, 2, 'one malformed line per host')

  const a = rep.sessions.find((x) => x.id === 'sess-a')
  assert.equal(a.project, 'myproj', 'folder name only')
  assert.deepEqual(Object.keys(a.byModel), ['claude-opus-5-5'])
  assert.equal(a.byModel['claude-opus-5-5'].output, 50 + 30 + 7, 'subagent counts to its parent')
  const b = rep.sessions.find((x) => x.id === 'sess-b')
  assert.equal(b.byModel['claude-opus-5-5'].output, 40, 'the copied response stays with the original session')
  const c = rep.sessions.find((x) => x.host === 'codex')
  assert.equal(c.id, 'cx-1')
  assert.equal(c.project, 'codexproj')
  assert.deepEqual(Object.keys(c.byModel), ['gpt-5.6-sol'])

  const body = JSON.stringify(rep)
  assert.ok(!body.includes(SECRET), 'no message text')
  assert.ok(!body.includes('/secret') && !body.includes(tmp), 'no paths')

  // a week: seven local days; the earlier entry lands on the 11th
  const week = r.usageReport(new Date(2026, 10, 9).getTime(), new Date(2026, 10, 16).getTime())
  assert.equal(week.days.length, 7)
  assert.equal(week.days.find((x) => x.date === '2026-11-11').claude.output, 9)

  // cached files: a second call returns the same numbers
  assert.deepEqual(r.usageReport(day.getTime(), day.getTime() + 86_400_000).days, rep.days)
  console.log('usage report check: ok')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
