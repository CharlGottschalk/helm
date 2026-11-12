// Token usage report (task 050): token totals from the transcripts Claude Code and Codex write on
// this machine, read only. Only numbers, timestamps, model names, session ids and the project
// folder's name leave this module: never message text, never a path.
// - Claude: ~/.claude/projects/<slug>/<session>.jsonl (+ <session>/subagents/*.jsonl), assistant
//   entries' message.usage. One response is written on several lines, and resumed sessions copy
//   earlier entries, so entries are counted once per message.id + requestId.
// - Codex: ~/.codex/{sessions,archived_sessions}/**/*.jsonl, event_msg token_count's
//   info.last_token_usage (per turn); a repeat of the same cumulative total is not a new turn.
// Tokens keep the four priced classes apart (fresh input, cache write, cache read, output) and stay
// per model, so costs can be added later from a price table without re-reading transcripts.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { HostId } from './config.js'

export interface Tokens {
  /** fresh (uncached) input */
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}
interface Entry {
  /** dedupe key (Claude only) */
  key?: string
  at: number
  model: string
  t: Tokens
}
interface FileResult {
  host: HostId
  session: string
  project: string
  entries: Entry[]
  skipped: number
}
export interface UsageSession {
  host: HostId
  id: string
  project: string
  startedAt: number
  /** tokens in the period, per model */
  byModel: Record<string, Tokens>
  /** the Helm session that ran it, when Helm knows it */
  helm?: { id: string; wsId: string; title: string }
}
export interface UsageReport {
  from: number
  to: number
  /** local days in the period, each with tokens per host */
  days: { date: string; claude: Tokens; codex: Tokens }[]
  sessions: UsageSession[]
  /** lines that could not be read */
  skipped: number
}

const zero = (): Tokens => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
const add = (a: Tokens, b: Tokens) => {
  a.input += b.input
  a.cacheWrite += b.cacheWrite
  a.cacheRead += b.cacheRead
  a.output += b.output
}
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const folder = (cwd: unknown) => (typeof cwd === 'string' && cwd ? basename(cwd) : '')
const empty = (t: Tokens) => !t.input && !t.cacheWrite && !t.cacheRead && !t.output

/** A local date key, YYYY-MM-DD. */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** One Claude transcript. `session` is the transcript's id (a subagent's file counts to its parent). */
export function parseClaude(text: string, session: string, fallbackProject = ''): FileResult {
  const byKey = new Map<string, Entry>()
  let project = ''
  let skipped = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let d: Record<string, unknown>
    try {
      d = obj(JSON.parse(line))
    } catch {
      skipped++
      continue
    }
    if (!project) project = folder(d.cwd)
    if (d.type !== 'assistant') continue
    const m = obj(d.message)
    const u = obj(m.usage)
    if (!m.usage) continue
    const at = Date.parse(String(d.timestamp))
    if (!Number.isFinite(at)) {
      skipped++
      continue
    }
    const t = { input: n(u.input_tokens), cacheWrite: n(u.cache_creation_input_tokens), cacheRead: n(u.cache_read_input_tokens), output: n(u.output_tokens) }
    if (empty(t)) continue
    const key = `${String(m.id ?? d.uuid)}:${String(d.requestId ?? '')}`
    const prev = byKey.get(key)
    // later lines of the same response carry the same or a larger output count
    if (!prev || t.output >= prev.t.output) byKey.set(key, { key, at: prev?.at ?? at, model: String(m.model ?? 'unknown'), t })
  }
  return { host: 'claude', session, project: project || fallbackProject, entries: [...byKey.values()], skipped }
}

/** One Codex rollout. */
export function parseCodex(text: string, fallbackSession: string): FileResult {
  const entries: Entry[] = []
  let session = ''
  let project = ''
  let model = 'unknown'
  let lastTotal = -1
  let skipped = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let d: Record<string, unknown>
    try {
      d = obj(JSON.parse(line))
    } catch {
      skipped++
      continue
    }
    const p = obj(d.payload)
    if (d.type === 'session_meta') {
      session ||= String(p.id ?? p.session_id ?? '')
      project ||= folder(p.cwd)
    } else if (d.type === 'turn_context') {
      if (typeof p.model === 'string') model = p.model
      project ||= folder(p.cwd)
    } else if (d.type === 'event_msg' && p.type === 'token_count') {
      const info = obj(p.info)
      if (!p.info) continue
      const total = n(obj(info.total_token_usage).total_tokens)
      if (total && total === lastTotal) continue
      lastTotal = total
      const u = obj(info.last_token_usage)
      const at = Date.parse(String(d.timestamp))
      if (!Number.isFinite(at)) {
        skipped++
        continue
      }
      const cached = n(u.cached_input_tokens)
      const t = { input: Math.max(0, n(u.input_tokens) - cached), cacheWrite: n(u.cache_write_input_tokens), cacheRead: cached, output: n(u.output_tokens) }
      if (!empty(t)) entries.push({ at, model, t })
    }
  }
  return { host: 'codex', session: session || fallbackSession, project, entries, skipped }
}

/* ── files ── */
const claudeRoot = () => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
const codexRoots = () => {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  return [join(home, 'sessions'), join(home, 'archived_sessions')]
}

function walk(dir: string, out: string[] = []): string[] {
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of names) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

/** Claude transcript path → session id: the file's name, or the parent session for a subagent. */
function claudeSession(file: string) {
  const dir = dirname(file)
  return basename(dir) === 'subagents' ? basename(dirname(dir)) : basename(file, '.jsonl')
}

// ponytail: a changed file is parsed again in full; read from the last offset if large live
// transcripts make re-opening the report slow.
const cache = new Map<string, { size: number; mtimeMs: number; result: FileResult }>()

function load(file: string, host: HostId, since: number): FileResult | null {
  let st
  try {
    st = statSync(file)
  } catch {
    return null
  }
  if (st.mtimeMs < since) return null // nothing in it can be newer than its last write
  const hit = cache.get(file)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.result
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const result = host === 'claude' ? parseClaude(text, claudeSession(file)) : parseCodex(text, basename(file, '.jsonl'))
  cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, result })
  return result
}

/** Tokens used in [from, to) on this machine. */
export function usageReport(from: number, to: number): UsageReport {
  const results: FileResult[] = []
  for (const f of walk(claudeRoot())) {
    const r = load(f, 'claude', from)
    if (r) results.push(r)
  }
  for (const root of codexRoots())
    for (const f of walk(root)) {
      const r = load(f, 'codex', from)
      if (r) results.push(r)
    }

  // the earliest copy of a Claude response wins, so a resumed session doesn't count it again
  const owner = new Map<string, { at: number; r: FileResult }>()
  for (const r of results)
    for (const e of r.entries) {
      if (!e.key) continue
      const o = owner.get(e.key)
      if (!o || e.at < o.at) owner.set(e.key, { at: e.at, r })
    }

  const days = new Map<string, { date: string; claude: Tokens; codex: Tokens }>()
  for (let d = new Date(from); d.getTime() < to; d.setDate(d.getDate() + 1)) {
    const date = dayKey(d.getTime())
    days.set(date, { date, claude: zero(), codex: zero() })
  }
  const sessions = new Map<string, UsageSession>()
  let skipped = 0
  for (const r of results) {
    skipped += r.skipped
    const id = `${r.host}:${r.session}`
    const start = r.entries.reduce((a, e) => Math.min(a, e.at), Infinity)
    for (const e of r.entries) {
      if (e.key && owner.get(e.key)?.r !== r) continue
      if (e.at < from || e.at >= to) continue
      let s = sessions.get(id)
      if (!s) sessions.set(id, (s = { host: r.host, id: r.session, project: r.project, startedAt: start, byModel: {} }))
      if (!s.project) s.project = r.project
      s.startedAt = Math.min(s.startedAt, start)
      add((s.byModel[e.model] ??= zero()), e.t)
      const day = days.get(dayKey(e.at))
      if (day) add(day[r.host], e.t)
    }
  }
  return { from, to, days: [...days.values()], sessions: [...sessions.values()], skipped }
}
