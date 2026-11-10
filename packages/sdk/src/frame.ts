// Code that runs inside a sandboxed Helm frame: the typed `helm` bridge (widget.md#bridge)
// and a safe DOM helper. Import from '@usetdt/helm-sdk/frame'.
import type { FilesResult, HttpResult, TdtResult } from './connection.js'
import type { SettingValues } from './settings.js'

export interface HelmBridge {
  /** Call once after the first render. */
  ready(): void
  on(event: 'settings', fn: (settings: SettingValues) => void): void
  /** Token values; the CSS variables are already applied to :root. */
  on(event: 'theme', fn: (tokens: Record<string, string>) => void): void
  on(event: 'refresh', fn: () => void): void
  /** Refused unless the connection and operation are declared in the manifest. */
  call<T = unknown>(connection: string, operation: string, args?: Record<string, unknown>): Promise<TdtResult<T>>
  openSettings(): void
  /** Open Helm's Settings → Connections, e.g. from a "not set up" state. */
  openConnections(): void
  /** `session` (one of `helm.sessions`) needs a tool, or a widget with "orchestrate". */
  openTab(tab: { kind: 'project' | 'session'; id: string }): void
  /** Hand-off to Claude Code / Codex; the user confirms the prompt. */
  startChat(prompt: string): void
  /** A request; Helm may refuse (resolves false). */
  resize(size: { w?: number; h?: number }): Promise<boolean>
  /**
   * Tools and widgets with the "orchestrate" capability; the user confirms each build. `host` defaults to the app setting.
   * With `orWrite` (a declared `files` write, tool.md#moving-a-task-into-doing) Helm shows one dialog instead:
   * Cancel, "Move only" (runs the write) or "Move and start build" (starts the build, writes nothing).
   */
  orchestrate: { build(input: BuildInput, opts?: { orWrite?: OrWrite }): Promise<BuildResult> }
  /** Tools, and widgets with "orchestrate": the workspace's agent sessions. */
  sessions: { on(event: 'change', fn: (sessions: unknown[]) => void): void }
  openTerminal(opts?: { cwd?: string }): Promise<{ ok: boolean; error?: string }>
}

export interface BuildInput {
  projectId: string
  taskId: string
  host?: 'claude' | 'codex'
}
/** The write offered as "Move only": a `files` `write` call, as for `helm.call`. */
export interface OrWrite {
  connection: string
  operation: string
  args?: Record<string, unknown>
}
/**
 * `choice` is set when `orWrite` was passed: `cancel` (nothing happened), `write` (`write` holds the
 * write's result; `ok` and `error` follow it) or `build` (a build session started).
 */
export interface BuildResult {
  ok: boolean
  error?: string
  choice?: 'cancel' | 'write' | 'build'
  /** The orWrite's result: `FilesResult` for files and mcp, `HttpResult` for http. */
  write?: FilesResult | HttpResult
}

declare global {
  interface Window {
    helm: HelmBridge
  }
}

/** The bridge Helm injected into this frame. */
export function getHelm(): HelmBridge {
  const helm = (globalThis as { helm?: HelmBridge }).helm
  if (!helm) throw new Error('window.helm is missing: this code must run inside a Helm frame')
  return helm
}

type Child = Node | string | number | null | undefined | false

/** Create an element; strings become text nodes, so connection data is never parsed as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(typeof c === 'number' ? String(c) : c)
  return node
}
