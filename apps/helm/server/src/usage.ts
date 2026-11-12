// Agent usage limits (task 048): the 5-hour and weekly windows of the user's Claude Code and
// Codex plans, as percentages used. Helm asks each host's own sources and never runs a model:
// - Codex: a short-lived `codex app-server`, JSON-RPC `account/rateLimits/read`.
// - Claude: the usage endpoint Claude Code's `/usage` calls, with Claude Code's own login
//   (read only: Helm never refreshes or rewrites it), plus the numbers Claude Code hands to the
//   status line of sessions Helm starts (statusline.mjs below writes them to LIVE_FILE).
// Only percentages and reset times leave this module; tokens never reach the browser.
import { spawn, execFile } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { HELM_HOME, type HelmConfig, type HostId } from './config.js'
import { CONTEXT_DIR } from './context.js'

export interface UsageWindow {
  /** percent of the window's limit used, 0–100 */
  pct: number
  /** epoch ms, when known */
  resetsAt: number | null
}
export interface HostUsage {
  host: HostId
  /** ok: current; stale: last known values, a refresh failed; unavailable: nothing to show */
  state: 'ok' | 'stale' | 'unavailable'
  reason?: string
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  updatedAt: number | null
}

const MIN = 60_000
const USAGE_DIR = join(HELM_HOME, 'usage')
const LIVE_FILE = join(USAGE_DIR, 'claude-limits.json')
const STATUSLINE = join(USAGE_DIR, 'statusline.mjs')
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')

/* ── parsing (defensive: both sources are unpublished and may change) ── */
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
/** Seconds, milliseconds or an ISO string → epoch ms. */
export function toMs(v: unknown): number | null {
  if (typeof v === 'string') return Number.isFinite(Date.parse(v)) ? Date.parse(v) : null
  const n = num(v)
  return n === undefined ? null : n < 1e12 ? n * 1000 : n
}
export function windowOf(pct: unknown, resetsAt: unknown): UsageWindow | null {
  const p = num(pct)
  return p === undefined ? null : { pct: Math.min(100, Math.max(0, p)), resetsAt: toMs(resetsAt) }
}
type W = { five: UsageWindow | null; week: UsageWindow | null }
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** `GET /api/oauth/usage` body. */
export function parseClaudeUsage(body: unknown): W {
  const b = obj(body)
  return { five: windowOf(obj(b.five_hour).utilization, obj(b.five_hour).resets_at), week: windowOf(obj(b.seven_day).utilization, obj(b.seven_day).resets_at) }
}
/** `account/rateLimits/read` result: primary is the 5-hour window, secondary the weekly one; matched by length when given. */
export function parseCodexLimits(result: unknown): W {
  const r = obj(obj(result).rateLimits)
  const wins = [obj(r.primary), obj(r.secondary)].filter((w) => num(w.usedPercent) !== undefined)
  const pick = (mins: number, fallback: number) => wins.find((w) => w.windowDurationMins === mins) ?? (wins.every((w) => w.windowDurationMins === undefined) ? wins[fallback] : undefined)
  const as = (w?: Record<string, unknown>) => (w ? windowOf(w.usedPercent, w.resetsAt) : null)
  return { five: as(pick(300, 0)), week: as(pick(10080, 1)) }
}

/* ── per-host state ── */
interface Slot {
  value: W | null
  at: number | null
  attempt: number
  notBefore: number
  error: string | null
  busy: Promise<void> | null
}
const slot = (): Slot => ({ value: null, at: null, attempt: 0, notBefore: 0, error: null, busy: null })
const slots: Record<HostId, Slot> = { claude: slot(), codex: slot() }

/** How often each host is asked, idle and on window focus. Claude's endpoint answers 429 when polled often. */
const EVERY: Record<HostId, { idle: number; focus: number }> = { claude: { idle: 15 * MIN, focus: 5 * MIN }, codex: { idle: 5 * MIN, focus: MIN } }

function due(host: HostId, focus: boolean, now: number) {
  const s = slots[host]
  if (s.busy || now < s.notBefore) return false
  return now - s.attempt >= (focus ? EVERY[host].focus : EVERY[host].idle)
}

async function refresh(host: HostId, config: HelmConfig) {
  const s = slots[host]
  s.attempt = Date.now()
  try {
    const value = host === 'claude' ? await fetchClaude() : await fetchCodex(config.hosts.codex)
    if (!value.five && !value.week) throw new Error(host === 'claude' ? 'Claude Code did not report usage' : 'Codex did not report usage')
    Object.assign(s, { value, at: Date.now(), error: null })
  } catch (e) {
    const err = e as Error & { retryAfter?: number }
    s.error = err.message
    if (err.retryAfter) s.notBefore = Date.now() + err.retryAfter
  }
}

/* ── Claude ── */
class UsageError extends Error {
  constructor(message: string, public retryAfter?: number) {
    super(message)
  }
}

/** Claude Code's access token: the macOS keychain, else `.credentials.json`. Read only. */
async function claudeToken(): Promise<string | null> {
  const fromJson = (text: string) => {
    const t = obj(obj(JSON.parse(text)).claudeAiOauth).accessToken
    return typeof t === 'string' && t ? t : null
  }
  if (platform() === 'darwin') {
    const text = await new Promise<string | null>((done) =>
      execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, out) => done(err ? null : out)),
    )
    if (text) return fromJson(text)
  }
  try {
    return fromJson(readFileSync(join(claudeDir(), '.credentials.json'), 'utf8'))
  } catch {
    return null
  }
}

async function fetchClaude(): Promise<W> {
  const token = await claudeToken()
  if (!token) throw new UsageError('Not signed in to Claude Code with a Claude account')
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json', 'user-agent': 'Helm' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) throw new UsageError('Claude login has expired; updates when Claude Code next runs')
  if (res.status === 429) throw new UsageError('Claude usage is rate-limited; trying again later', (Number(res.headers.get('retry-after')) || 15 * 60) * 1000)
  if (!res.ok) throw new UsageError(`Claude usage answered HTTP ${res.status}`)
  return parseClaudeUsage(await res.json())
}

/** Numbers the status line of a Helm-started Claude session wrote last, with the file's time. */
function claudeLive(): { value: W; at: number } | null {
  try {
    const at = statSync(LIVE_FILE).mtimeMs
    const d = obj(JSON.parse(readFileSync(LIVE_FILE, 'utf8')))
    const value = { five: windowOf(obj(d.fiveHour).pct, obj(d.fiveHour).resetsAt), week: windowOf(obj(d.weekly).pct, obj(d.weekly).resetsAt) }
    return value.five || value.week ? { value, at } : null
  } catch {
    return null
  }
}

/* ── Codex ── */
function fetchCodex(command: string): Promise<W> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
    let buf = ''
    const done = (fn: () => void) => (clearTimeout(timer), child.kill(), fn())
    const timer = setTimeout(() => done(() => reject(new UsageError('Codex did not answer in time'))), 15_000)
    child.on('error', (e: NodeJS.ErrnoException) => done(() => reject(new UsageError(e.code === 'ENOENT' ? 'Codex is not installed' : `Could not start Codex: ${e.message}`))))
    child.on('exit', () => done(() => reject(new UsageError('Codex stopped before reporting usage'))))
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      if (buf.length > 1024 * 1024) return done(() => reject(new UsageError('Codex sent too much data')))
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let msg: Record<string, unknown>
        try {
          msg = obj(JSON.parse(line))
        } catch {
          continue
        }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' }) + '\n')
        } else if (msg.id === 2) {
          return done(() => (msg.error ? reject(new UsageError('Codex could not read usage; is it signed in?')) : resolve(parseCodexLimits(msg.result))))
        }
      }
    })
    child.stdin.on('error', () => {}) // exit/error above report it
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'helm', version: '1' } } }) + '\n')
  })
}

/* ── the endpoint ── */
function view(host: HostId): HostUsage {
  const s = slots[host]
  let value = s.value
  let at = s.at
  if (host === 'claude') {
    const live = claudeLive()
    if (live && (at === null || live.at > at)) ({ value, at } = live)
  }
  if (!value) return { host, state: 'unavailable', reason: s.error ?? 'Checking…', fiveHour: null, weekly: null, updatedAt: null }
  const stale = !!s.error && s.attempt > (at ?? 0)
  return { host, state: stale ? 'stale' : 'ok', ...(stale ? { reason: s.error! } : {}), fiveHour: value.five, weekly: value.week, updatedAt: at }
}

/** Current usage for both hosts. Refreshes in the background when due; `focus` allows an earlier check. */
export async function usageLimits(config: HelmConfig, focus: boolean): Promise<{ hosts: HostUsage[] }> {
  const now = Date.now()
  const first: Promise<void>[] = []
  for (const host of ['claude', 'codex'] as const) {
    const s = slots[host]
    // a status line wrote in the last 5 minutes: Claude is live, no need to poll its endpoint
    if (host === 'claude' && (claudeLive()?.at ?? 0) > now - 5 * MIN) continue
    if (due(host, focus, now)) s.busy = refresh(host, config).finally(() => (s.busy = null))
    // the first answer waits for the first check, so the ticker doesn't start on "Checking…"
    if (s.busy && s.at === null && !s.error) first.push(s.busy)
  }
  await Promise.all(first)
  return { hosts: [view('claude'), view('codex')] }
}

/* ── Claude status line for Helm-started sessions ── */
// Claude Code runs this with the session's status JSON on stdin. It saves only the rate-limit
// numbers to HELM_USAGE_FILE and this session's context-window numbers to HELM_CONTEXT_FILE (task 051), then prints the user's own status line (HELM_USER_STATUSLINE, run
// exactly as Claude would) or, without one, a short usage line.
const SCRIPT = `import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const input = readFileSync(0, 'utf8')
let line = ''
const save = (out, data) => {
  const tmp = out + '.' + process.pid
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
  renameSync(tmp, out)
}
try {
  const c = JSON.parse(input).context_window || {}
  const u = c.current_usage || {}
  const n = (v) => (typeof v === 'number' && v >= 0 ? v : undefined)
  const parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(n)
  const size = n(c.context_window_size)
  if (process.env.HELM_CONTEXT_FILE && size && parts.some((p) => p !== undefined)) {
    const sid = JSON.parse(input).session_id
    save(process.env.HELM_CONTEXT_FILE, { used: parts.reduce((a, p) => a + (p || 0), 0), size, pct: n(c.used_percentage) ?? null, session: typeof sid === 'string' ? sid : null })
  }
} catch {}
try {
  const r = JSON.parse(input).rate_limits || {}
  const pick = (w) => { const p = w && (w.used_percentage ?? w.utilization); return typeof p === 'number' ? { pct: p, resetsAt: w.resets_at ?? null } : null }
  const data = { fiveHour: pick(r.five_hour), weekly: pick(r.seven_day) }
  const out = process.env.HELM_USAGE_FILE
  if (out && (data.fiveHour || data.weekly)) {
    save(out, data)
    line = [data.fiveHour && '5h ' + Math.round(data.fiveHour.pct) + '%', data.weekly && 'week ' + Math.round(data.weekly.pct) + '%'].filter(Boolean).join(' · ')
  }
} catch {}
const user = process.env.HELM_USER_STATUSLINE
if (user) process.stdout.write(spawnSync(user, { shell: true, input, encoding: 'utf8', timeout: 10000 }).stdout ?? '')
else process.stdout.write(line)
`

const quote = (p: string) => `"${p.replace(/(["\\$\`])/g, '\\$1')}"`

/** `--settings` args and env for a Claude session, so its status line reports usage (and, given the session id, its context window) to Helm. */
export function claudeStatusLine(sessionId?: string): { args: string[]; env: Record<string, string> } {
  try {
    mkdirSync(CONTEXT_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(STATUSLINE, SCRIPT, { mode: 0o600 })
  } catch (e) {
    console.warn(`[helm] usage status line unavailable: ${(e as Error).message}`)
    return { args: [], env: {} }
  }
  // ponytail: only the user settings file's statusLine is chained; project/managed ones are not read.
  let user = ''
  try {
    const sl = obj(obj(JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8'))).statusLine)
    if (sl.type === 'command' && typeof sl.command === 'string') user = sl.command
  } catch {
    /* no user settings */
  }
  const settings = { statusLine: { type: 'command', command: `${quote(process.execPath)} ${quote(STATUSLINE)}` } }
  return { args: ['--settings', JSON.stringify(settings)], env: { HELM_USAGE_FILE: LIVE_FILE, ...(sessionId ? { HELM_CONTEXT_FILE: join(CONTEXT_DIR, `${sessionId}.json`) } : {}), ...(user ? { HELM_USER_STATUSLINE: user } : {}) } }
}
