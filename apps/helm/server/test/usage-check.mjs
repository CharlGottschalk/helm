// Agent usage limits self-check (task 048) against the built server (run `npm run build:server` first):
//   npm run check:usage -w @usetdt/helm
// Parsers map both hosts' replies (and changed shapes) to percentages or nothing; the Claude status
// line saves only usage numbers and still prints the user's own status line; the endpoint reads a
// stand-in Codex app-server and the live file, never a token.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-usage-')))
process.env.HELM_HOME = join(tmp, 'home')
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude')
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
const u = await import('../dist/usage.js')

try {
  // Claude endpoint shape
  const c = u.parseClaudeUsage({ five_hour: { utilization: 6, resets_at: '2026-11-12T16:00:00+00:00' }, seven_day: { utilization: 23, resets_at: '2026-11-16T06:00:00+00:00' } })
  assert.deepEqual(c, { five: { pct: 6, resetsAt: Date.parse('2026-11-12T16:00:00Z') }, week: { pct: 23, resetsAt: Date.parse('2026-11-16T06:00:00Z') } })
  assert.deepEqual(u.parseClaudeUsage({ five_hour: null, error: { type: 'x' } }), { five: null, week: null })
  assert.deepEqual(u.parseClaudeUsage('nonsense'), { five: null, week: null })
  // Codex app-server shape (seconds), by window length, and swapped order
  const x = u.parseCodexLimits({ rateLimits: { primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1794238531 }, secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 1794825331 } } })
  assert.deepEqual(x, { five: { pct: 3, resetsAt: 1794238531000 }, week: { pct: 1, resetsAt: 1794825331000 } })
  const swapped = u.parseCodexLimits({ rateLimits: { primary: { usedPercent: 9, windowDurationMins: 10080 }, secondary: { usedPercent: 4, windowDurationMins: 300 } } })
  assert.equal(swapped.five.pct, 4)
  assert.equal(swapped.week.pct, 9)
  assert.deepEqual(u.parseCodexLimits({ rateLimits: { primary: { usedPercent: 'lots' } } }), { five: null, week: null })
  assert.equal(u.windowOf(140, null).pct, 100)

  // status line: the user's own command keeps working; only numbers are saved
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'cat >/dev/null; echo user-line' } }))
  const sl = u.claudeStatusLine()
  assert.equal(sl.args[0], '--settings')
  const command = JSON.parse(sl.args[1]).statusLine.command
  const input = JSON.stringify({ session_id: 's', transcript_path: '/secret/path.jsonl', model: { id: 'm' }, rate_limits: { five_hour: { used_percentage: 41, resets_at: 1794238531 }, seven_day: { used_percentage: 12, resets_at: 1794825331 } } })
  const run = spawnSync(command, { shell: true, input, encoding: 'utf8', env: { ...process.env, ...sl.env } })
  assert.equal(run.stdout.trim(), 'user-line')
  const saved = readFileSync(sl.env.HELM_USAGE_FILE, 'utf8')
  assert.deepEqual(JSON.parse(saved), { fiveHour: { pct: 41, resetsAt: 1794238531 }, weekly: { pct: 12, resetsAt: 1794825331 } })
  assert.ok(!saved.includes('secret') && !saved.includes('session_id'))
  // without a user status line it prints the usage itself
  const own = spawnSync(command, { shell: true, input, encoding: 'utf8', env: { ...process.env, HELM_USAGE_FILE: sl.env.HELM_USAGE_FILE } })
  assert.equal(own.stdout, '5h 41% · week 12%')
  // bad input: no crash, nothing written over the last values
  spawnSync(command, { shell: true, input: 'not json', encoding: 'utf8', env: { ...process.env, ...sl.env } })
  assert.equal(readFileSync(sl.env.HELM_USAGE_FILE, 'utf8'), saved)

  // endpoint: Claude from the live file (no credentials here), Codex from a stand-in app-server
  const fake = join(tmp, 'codex')
  writeFileSync(fake, `#!${process.execPath}
const rl = require('readline').createInterface({ input: process.stdin })
if (process.argv[2] !== 'app-server') process.exit(2)
rl.on('line', (l) => { const m = JSON.parse(l)
  if (m.id === 1) console.log(JSON.stringify({ id: 1, result: {} }))
  if (m.id === 2) console.log(JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 1794238531 }, secondary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 1794825331 } } } })) })
`)
  chmodSync(fake, 0o755)
  const r = await u.usageLimits({ hosts: { claude: 'claude', codex: fake } }, false)
  const [claude, codex] = r.hosts
  assert.equal(claude.state, 'ok')
  assert.equal(claude.fiveHour.pct, 41)
  assert.equal(claude.weekly.resetsAt, 1794825331000)
  assert.equal(codex.state, 'ok')
  assert.deepEqual([codex.fiveHour.pct, codex.weekly.pct], [7, 2])
  assert.ok(!JSON.stringify(r).match(/token|secret|path/i))

  // a missing Codex: unavailable with a reason, Claude unaffected (the same process keeps its cache, so use a fresh one)
  const missing = spawnSync(process.execPath, ['--input-type=module', '-e', `const u = await import(${JSON.stringify(new URL('../dist/usage.js', import.meta.url).href)}); console.log(JSON.stringify(await u.usageLimits({ hosts: { claude: 'claude', codex: ${JSON.stringify(join(tmp, 'nope'))} } }, false)))`], { encoding: 'utf8', env: process.env })
  const m = JSON.parse(missing.stdout).hosts
  assert.equal(m[1].state, 'unavailable')
  assert.equal(m[1].reason, 'Codex is not installed')
  assert.equal(m[0].fiveHour.pct, 41)
  assert.ok(existsSync(sl.env.HELM_USAGE_FILE))
  console.log('usage check passed')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
