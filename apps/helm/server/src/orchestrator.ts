// Starts host sessions: chat hand-offs and tdt-software-production builds.
import type { HelmConfig, HostId, WorkspaceEntry } from './config.js'
import { hostAdapters } from './agents/hosts.js'
import { ApiError } from './errors.js'
import type { SessionManager } from './sessions.js'
import type { TerminalManager } from './terminal/pty.js'

export const BUILD_SKILL = 'tdt-software-production-build'

/** Task ids and project ids are passed to the host as text; keep them boring. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export class Orchestrator {
  private hosts

  constructor(
    private config: HelmConfig,
    private terminals: TerminalManager,
    private sessions: SessionManager,
  ) {
    this.hosts = hostAdapters(config)
  }

  /** Floating chat → hand the prompt to Claude/Codex in a new workspace terminal. */
  async handoff(ws: WorkspaceEntry, prompt: string, host: HostId = this.config.defaultHost) {
    const text = prompt.trim()
    if (!text || text.length > 8000) throw new ApiError(400, 'Prompt must be 1–8000 characters')
    const adapter = this.hosts[host]
    const session = this.sessions.create({ workspaceId: ws.id, kind: 'chat', host, title: titleFrom(text), prompt: text })
    return this.launch(ws, session.id, adapter.interactive(text, session.id))
  }

  /**
   * A plugin's "Build" (orchestrate capability) → run the software-production build skill for one task.
   * Helm doesn't read task files: the user confirmed this build in the host page, and the skill
   * rereads the task authority and refuses work that isn't ready.
   */
  async build(ws: WorkspaceEntry, input: { projectId: string; taskId: string; host?: HostId }) {
    if (!SAFE_ID.test(input.taskId) || !SAFE_ID.test(input.projectId)) throw new ApiError(400, 'Invalid project or task id')
    const host = input.host ?? this.config.defaultHost
    const adapter = this.hosts[host]
    // Registered project id + task id, so the skill never has to guess the project.
    const prompt = adapter.skill(BUILD_SKILL, `${input.projectId} ${input.taskId}`)
    const session = this.sessions.create({
      workspaceId: ws.id,
      kind: 'build',
      host,
      title: `Build ${input.taskId}`,
      prompt,
      task: { projectId: input.projectId, taskId: input.taskId },
    })
    return this.launch(ws, session.id, adapter.interactive(prompt, session.id))
  }

  private async launch(ws: WorkspaceEntry, sessionId: string, launch: { command: string; args: string[]; title: string; env?: Record<string, string> }) {
    try {
      const terminal = await this.terminals.spawn({
        workspaceId: ws.id,
        workspaceRoot: ws.path,
        command: launch.command,
        args: launch.args,
        title: launch.title,
        env: launch.env,
      })
      this.sessions.update(sessionId, { terminalId: terminal.id, status: 'running' })
    } catch (error) {
      this.sessions.update(sessionId, { status: 'failed', endedAt: Date.now() })
      throw error
    }
    return this.sessions.get(sessionId)!
  }
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ')
  return t.length > 48 ? `${t.slice(0, 46)}…` : t
}
