// Session context-window self-check (task 051) against the built server (run `npm run build:server` first):
//   npm run check:context -w @usetdt/helm
// The Claude status-line payload and a fixture Codex rollout map to the same response type, with
// numbers only; a missing or malformed source maps to "none".
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-context-')))
process.env.HELM_HOME = join(tmp, 'home')
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude')
process.env.CODEX_HOME = join(tmp, 'codex')
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
const u = await import('../dist/usage.js')
const c = await import('../dist/context.js')
const keys = ['state', 'used', 'size', 'pct', 'updatedAt']
const okShape = (r) => assert.deepEqual(Object.keys(r).filter((k) => keys.includes(k)).sort(), [...keys].sort())

try {
  const ws = join(tmp, 'ws')
  mkdirSync(ws)
  const now = Date.now()
  const session = (host, id) => ({ id, host, workspaceId: 'w', kind: 'chat', title: 't', prompt: 'p', status: 'running', terminalId: null, startedAt: now - 1000, endedAt: null, exitCode: null })

  // Claude: before the first turn there is nothing
  const claude = session('claude', '11111111-1111-1111-1111-111111111111')
  assert.equal(c.sessionContext(claude, ws).state, 'none')

  // run the injected status line with a payload shaped like Claude Code's
  const sl = u.claudeStatusLine(claude.id)
  const command = JSON.parse(sl.args[1]).statusLine.command
  const payload = { session_id: 'x', transcript_path: '/secret/path.jsonl', context_window: { context_window_size: 200000, used_percentage: 21, current_usage: { input_tokens: 800, output_tokens: 50, cache_creation_input_tokens: 2000, cache_read_input_tokens: 40000 } } }
  const run = spawnSync(command, { shell: true, input: JSON.stringify(payload), env: { ...process.env, ...sl.env }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const saved = readFileSync(sl.env.HELM_CONTEXT_FILE, 'utf8')
  assert.ok(!saved.includes('/secret'), 'status line saves numbers only')
  const rc = c.sessionContext(claude, ws)
  okShape(rc)
  assert.equal(rc.state, 'ok')
  assert.equal(rc.used, 42800)
  assert.equal(rc.size, 200000)
  assert.equal(rc.pct, 21)
  // malformed / empty usage leaves the last value untouched and never throws
  spawnSync(command, { shell: true, input: '{"context_window":{"current_usage":null}}', env: { ...process.env, ...sl.env } })
  assert.equal(c.sessionContext(claude, ws).used, 42800)
  writeFileSync(sl.env.HELM_CONTEXT_FILE, 'not json')
  assert.equal(c.sessionContext(claude, ws).state, 'none')
  assert.equal(c.parseClaudeContext({ context_window_size: 200000, current_usage: null }), null)

  // Codex: a fixture rollout in today's folder, plus one from another folder that must not match
  const codex = session('codex', '22222222-2222-2222-2222-222222222222')
  assert.equal(c.sessionContext(codex, ws).state, 'none')
  const d = new Date(now)
  const day = join(process.env.CODEX_HOME, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  const meta = (cwd) => JSON.stringify({ timestamp: new Date(now).toISOString(), type: 'session_meta', payload: { id: 'r', timestamp: new Date(now).toISOString(), cwd, base_instructions: { text: 'x'.repeat(20000) } } })
  const tc = (total, win) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: total - 100, output_tokens: 100, total_tokens: total }, model_context_window: win } } })
  const msg = JSON.stringify({ type: 'response_item', payload: { type: 'message', content: [{ text: 'secret message text' }] } })
  writeFileSync(join(day, 'rollout-other.jsonl'), [meta(join(tmp, 'elsewhere')), tc(999, 1000)].join('\n') + '\n')
  writeFileSync(join(day, 'rollout-mine.jsonl'), [meta(ws), msg].join('\n') + '\n')
  assert.equal(c.sessionContext(codex, ws).reason, 'Shows after the first response')
  writeFileSync(join(day, 'rollout-mine.jsonl'), [meta(ws), msg, tc(30000, 258400), msg, tc(54264, 258400), 'garbage{'].join('\n') + '\n')
  const rx = c.sessionContext(codex, ws)
  okShape(rx)
  assert.equal(rx.state, 'ok')
  assert.equal(rx.used, 54264)
  assert.equal(rx.size, 258400)
  assert.equal(Math.round(rx.pct), 21)
  assert.ok(!JSON.stringify(rx).includes('secret') && !JSON.stringify(rx).includes(tmp), 'numbers only')
  assert.equal(c.parseCodexTokenCount('{"type":"event_msg","payload":{"type":"token_count","info":null}}'), null)

  console.log('context check passed')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
