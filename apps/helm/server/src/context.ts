// Context window of one Helm-started agent session (task 051): tokens in context and the window
// size, as numbers only. Message text and file paths never leave this module.
// - Claude: the status line Helm injects (usage.ts) writes CONTEXT_DIR/<session id>.json.
// - Codex: the latest `token_count` event in the session's rollout file under ~/.codex/sessions.
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HELM_HOME } from './config.js'
import type { Session } from './sessions.js'

export const CONTEXT_DIR = join(HELM_HOME, 'usage', 'context')

export interface SessionContext {
  /** ok: numbers below; none: nothing to show yet (see reason) */
  state: 'ok' | 'none'
  reason?: string
  /** tokens in the context window */
  used: number
  /** the window's size in tokens */
  size: number
  /** 0–100 */
  pct: number
  updatedAt: number | null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const none = (reason: string): SessionContext => ({ state: 'none', reason, used: 0, size: 0, pct: 0, updatedAt: null })
const ok = (used: number, size: number, pct: number | undefined, updatedAt: number | null): SessionContext => ({
  state: 'ok', used, size, pct: Math.min(100, Math.max(0, pct ?? (used / size) * 100)), updatedAt,
})

/** Claude Code's status-line `context_window` object → numbers, or null when it has no usage yet. */
export function parseClaudeContext(cw: unknown): { used: number; size: number; pct?: number } | null {
  const c = obj(cw)
  const size = num(c.context_window_size)
  const u = obj(c.current_usage)
  const parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(num)
  if (!size || parts.every((p) => p === undefined)) return null
  const used = parts.reduce<number>((a, p) => a + (p ?? 0), 0)
  return { used, size, pct: num(c.used_percentage) }
}

/** One rollout line → numbers when it is a `token_count` event with a known window. */
export function parseCodexTokenCount(line: string): { used: number; size: number } | null {
  let d: Record<string, unknown>
  try {
    d = obj(JSON.parse(line))
  } catch {
    return null
  }
  const p = obj(d.payload)
  if (d.type !== 'event_msg' || p.type !== 'token_count') return null
  const info = obj(p.info)
  const size = num(info.model_context_window)
  const last = obj(info.last_token_usage)
  const used = num(last.total_tokens) ?? ((num(last.input_tokens) ?? 0) + (num(last.output_tokens) ?? 0) || undefined)
  return size && used !== undefined ? { used, size } : null
}

function claudeContext(s: Session): SessionContext {
  const file = join(CONTEXT_DIR, `${s.id}.json`)
  try {
    const d = obj(JSON.parse(readFileSync(file, 'utf8')))
    const used = num(d.used)
    const size = num(d.size)
    if (used !== undefined && size) return ok(used, size, num(d.pct), statSync(file).mtimeMs)
  } catch {
    /* not written yet */
  }
  return none(s.endedAt ? 'Not recorded for this session' : 'Shows after the first response')
}

/* ── Codex rollout files ── */
const codexDir = () => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
/** session id → rollout file, once matched */
const bound = new Map<string, string>()

const readHead = (file: string, max = 256 * 1024) => {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(max)
    return buf.subarray(0, readSync(fd, buf, 0, max, 0)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}
const readTail = (file: string, max = 512 * 1024) => {
  const fd = openSync(file, 'r')
  try {
    const size = statSync(file).size
    const len = Math.min(size, max)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * The rollout Codex started for this session: in the day folders around its start, the earliest
 * file whose `session_meta` has the workspace as cwd and starts at or after the session, and isn't
 * already matched to another session.
 * ponytail: two Codex sessions started in the same workspace within a second can swap; use the
 * session id once Codex reports it to Helm.
 */
function findRollout(s: Session, cwd: string): string | null {
  const hit = bound.get(s.id)
  if (hit) return hit
  const taken = new Set(bound.values())
  const want = real(cwd)
  const days = new Set([s.startedAt, s.startedAt + 86_400_000].map((t) => {
    const d = new Date(t)
    return join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  }))
  let best: { file: string; at: number } | null = null
  for (const day of days) {
    const dir = join(codexDir(), day)
    let names: string[]
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(dir, name)
      if (taken.has(file)) continue
      try {
        if (statSync(file).mtimeMs < s.startedAt) continue
        const meta = obj(JSON.parse(readHead(file).split('\n')[0]))
        const p = obj(meta.payload)
        const at = Date.parse(String(p.timestamp ?? meta.timestamp))
        if (meta.type !== 'session_meta' || typeof p.cwd !== 'string' || real(p.cwd) !== want) continue
        if (!(at >= s.startedAt - 2000) || (s.endedAt && at > s.endedAt)) continue
        if (!best || at < best.at) best = { file, at }
      } catch {
        /* unreadable or still being written */
      }
    }
  }
  if (best) bound.set(s.id, best.file)
  return best?.file ?? null
}

function codexContext(s: Session, cwd: string): SessionContext {
  const file = findRollout(s, cwd)
  if (!file) return none(s.endedAt ? 'Codex left no record for this session' : 'Shows after the first response')
  try {
    const lines = readTail(file).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const c = parseCodexTokenCount(lines[i])
      if (c) return ok(c.used, c.size, undefined, statSync(file).mtimeMs)
    }
  } catch {
    return none('Could not read the Codex session')
  }
  return none('Shows after the first response')
}

/** Context window for a session; `cwd` is the workspace folder the session runs in. */
export function sessionContext(s: Session, cwd: string): SessionContext {
  return s.host === 'claude' ? claudeContext(s) : codexContext(s, cwd)
}
