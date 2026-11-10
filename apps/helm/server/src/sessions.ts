// Sessions shown in Helm's right panel: host agent processes Helm started.
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELM_HOME, type HostId } from './config.js'
import type { TerminalManager } from './terminal/pty.js'

export type SessionKind = 'chat' | 'build'
/** starting → running ⇄ waiting → exited | failed. */
export type SessionStatus = 'starting' | 'running' | 'waiting' | 'exited' | 'failed'

export interface Session {
  id: string
  workspaceId: string
  kind: SessionKind
  host: HostId
  title: string
  prompt: string
  status: SessionStatus
  terminalId: string | null
  /** for build sessions: what is being built */
  task?: { projectId: string; taskId: string }
  startedAt: number
  endedAt: number | null
  exitCode: number | null
}

const SESSIONS_DIR = join(HELM_HOME, 'sessions')
const KEEP = 200
// ponytail: "waiting" = no terminal output for IDLE_MS while running. Host CLIs redraw while
// working and go quiet at their prompt, so this flags questions and finished turns alike.
// A host hook or headless events would be exact; add when the heuristic misleads.
const IDLE_MS = 6000
const ENDED = new Set<SessionStatus>(['exited', 'failed'])

/** Emits `change` with the full list whenever any session changes. Ended sessions persist to ~/.helm/sessions/. */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>()
  private idle = new Map<string, NodeJS.Timeout>()

  constructor(terminals: TerminalManager) {
    super()
    this.load()
    terminals.on('data', (terminalId: string) => {
      const s = this.byTerminal(terminalId)
      if (!s || ENDED.has(s.status)) return
      if (s.status === 'waiting') this.update(s.id, { status: 'running' })
      clearTimeout(this.idle.get(s.id))
      this.idle.set(s.id, setTimeout(() => this.get(s.id)?.status === 'running' && this.update(s.id, { status: 'waiting' }), IDLE_MS))
    })
    terminals.on('exit', (terminalId: string, code: number) => {
      const s = this.byTerminal(terminalId)
      if (s && !ENDED.has(s.status)) this.update(s.id, { status: code === 0 ? 'exited' : 'failed', exitCode: code, endedAt: Date.now() })
    })
  }

  private byTerminal(terminalId: string) {
    return [...this.sessions.values()].find((x) => x.terminalId === terminalId)
  }

  create(init: Omit<Session, 'id' | 'status' | 'startedAt' | 'endedAt' | 'exitCode' | 'terminalId'>): Session {
    const s: Session = { ...init, id: randomUUID(), status: 'starting', terminalId: null, startedAt: Date.now(), endedAt: null, exitCode: null }
    this.sessions.set(s.id, s)
    this.emitChange()
    return s
  }

  update(id: string, patch: Partial<Session>) {
    const s = this.sessions.get(id)
    if (!s) return
    Object.assign(s, patch)
    if (ENDED.has(s.status)) {
      clearTimeout(this.idle.get(id))
      this.idle.delete(id)
      this.persist(s)
    }
    this.emitChange()
  }

  get(id: string) {
    return this.sessions.get(id)
  }

  list(workspaceId?: string) {
    return [...this.sessions.values()].filter((s) => !workspaceId || s.workspaceId === workspaceId).sort((a, b) => b.startedAt - a.startedAt)
  }

  /** Server shutdown: live sessions end with it; record them as exited. */
  closeAll() {
    for (const s of this.sessions.values()) if (!ENDED.has(s.status)) this.update(s.id, { status: 'exited', endedAt: Date.now() })
  }

  private persist(s: Session) {
    try {
      mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 })
      writeFileSync(join(SESSIONS_DIR, `${s.id}.json`), JSON.stringify({ ...s, terminalId: null }) + '\n', { mode: 0o600 })
    } catch (error) {
      console.warn(`[helm] could not persist session ${s.id}: ${(error as Error).message}`)
    }
  }

  /** Newest KEEP ended sessions from earlier runs; their terminals are gone. */
  private load() {
    let files: string[]
    try {
      files = readdirSync(SESSIONS_DIR).filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))
    } catch {
      return
    }
    const loaded: Session[] = []
    for (const f of files) {
      try {
        const s = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf8')) as Session
        if (typeof s.id === 'string' && ENDED.has(s.status) && typeof s.startedAt === 'number') loaded.push({ ...s, terminalId: null })
      } catch {
        /* skip unreadable files */
      }
    }
    for (const s of loaded.sort((a, b) => b.startedAt - a.startedAt).slice(0, KEEP)) this.sessions.set(s.id, s)
  }

  private emitChange() {
    this.emit('change', this.list())
  }
}
