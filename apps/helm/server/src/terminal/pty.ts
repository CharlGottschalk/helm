// Workspace terminals backed by node-pty.
//
// Confinement: every PTY starts in a directory resolved inside the workspace
// (confineDirectory follows symlinks/junctions). This controls where a terminal
// starts; it does NOT stop a shell from `cd ..`. Real confinement needs an OS
// sandbox (Linux bwrap, macOS sandbox-exec, Windows job object/AppContainer) or a
// restricted command runner. TODO: implement SandboxPolicy per platform.
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { platform } from 'node:os'
import { confineDirectory } from '../workspaces.js'

type IPty = import('node-pty').IPty

export interface TerminalInfo {
  id: string
  workspaceId: string
  cwd: string
  title: string
  command: string
  args: string[]
  pid: number
  startedAt: number
  exitCode: number | null
}

export interface SpawnOptions {
  workspaceId: string
  workspaceRoot: string
  /** directory inside the workspace; defaults to its root */
  cwd?: string
  /** program to run; defaults to the user's shell */
  command?: string
  args?: string[]
  title?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
}

/** Placeholder for OS-level confinement. TODO: wrap command in a platform sandbox. */
export interface SandboxPolicy {
  wrap(command: string, args: string[], root: string): { command: string; args: string[] }
}
export const noSandbox: SandboxPolicy = { wrap: (command, args) => ({ command, args }) }

function defaultShell() {
  if (platform() === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

async function loadPty() {
  try {
    return await import('node-pty')
  } catch {
    throw new Error('node-pty is not installed or failed to build; terminals are unavailable')
  }
}

/** Emits `data` (id, chunk) and `exit` (id, code). Keeps a bounded scrollback per terminal. */
export class TerminalManager extends EventEmitter {
  private terminals = new Map<string, { info: TerminalInfo; pty: IPty; scrollback: string[] }>()
  private static SCROLLBACK_CHUNKS = 2000

  constructor(private sandbox: SandboxPolicy = noSandbox) {
    super()
  }

  async spawn(opts: SpawnOptions): Promise<TerminalInfo> {
    const cwd = confineDirectory(opts.workspaceRoot, opts.cwd)
    const pty = await loadPty()
    const base = opts.command ?? defaultShell()
    const wrapped = this.sandbox.wrap(base, opts.args ?? [], opts.workspaceRoot)
    const proc = pty.spawn(wrapped.command, wrapped.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 32,
      cwd,
      env: { ...process.env, ...opts.env, HELM_WORKSPACE: opts.workspaceRoot } as Record<string, string>,
    })
    const info: TerminalInfo = {
      id: randomUUID(),
      workspaceId: opts.workspaceId,
      cwd,
      title: opts.title ?? base,
      command: base,
      args: opts.args ?? [],
      pid: proc.pid,
      startedAt: Date.now(),
      exitCode: null,
    }
    const entry = { info, pty: proc, scrollback: [] as string[] }
    this.terminals.set(info.id, entry)
    proc.onData((chunk) => {
      entry.scrollback.push(chunk)
      if (entry.scrollback.length > TerminalManager.SCROLLBACK_CHUNKS) entry.scrollback.shift()
      this.emit('data', info.id, chunk)
    })
    proc.onExit(({ exitCode }) => {
      info.exitCode = exitCode
      this.emit('exit', info.id, exitCode)
    })
    return info
  }

  write(id: string, data: string) {
    this.require(id).pty.write(data)
  }

  resize(id: string, cols: number, rows: number) {
    this.require(id).pty.resize(Math.max(20, cols), Math.max(5, rows))
  }

  scrollback(id: string) {
    return this.require(id).scrollback.join('')
  }

  info(id: string) {
    return this.require(id).info
  }

  list(workspaceId?: string) {
    return [...this.terminals.values()].map((t) => t.info).filter((t) => !workspaceId || t.workspaceId === workspaceId)
  }

  kill(id: string) {
    const t = this.terminals.get(id)
    if (!t) return
    if (t.info.exitCode === null) t.pty.kill()
    this.terminals.delete(id)
  }

  killAll() {
    for (const id of [...this.terminals.keys()]) this.kill(id)
  }

  private require(id: string) {
    const t = this.terminals.get(id)
    if (!t) throw new Error(`Unknown terminal ${id}`)
    return t
  }
}
