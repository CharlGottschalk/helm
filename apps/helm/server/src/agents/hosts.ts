// Host adapters: how Helm hands work to Claude Code or Codex.
// Helm never runs a model. A hand-off starts the host CLI interactively in a
// workspace terminal, so TDT's hooks (capture, constitution) apply as usual.
import type { HelmConfig, HostId } from '../config.js'
import { claudeStatusLine } from '../usage.js'

export interface HostLaunch {
  command: string
  args: string[]
  title: string
  env?: Record<string, string>
}

export interface HostAdapter {
  id: HostId
  label: string
  /** how skills are invoked in this host: "/skill" for Claude, "$skill" for Codex */
  skillSigil: '/' | '$'
  /** interactive session, optionally seeded with a first prompt */
  interactive(prompt?: string): HostLaunch
  /** text that invokes a skill with arguments */
  skill(name: string, args?: string): string
  // TODO(headless): non-interactive mode for richer status/streaming in Helm's own
  // chat view: Claude `-p --output-format stream-json`, Codex `exec --json`.
}

export function hostAdapters(config: HelmConfig): Record<HostId, HostAdapter> {
  const make = (id: HostId, label: string, sigil: '/' | '$'): HostAdapter => ({
    id,
    label,
    skillSigil: sigil,
    interactive: (prompt) => {
      // Claude sessions get Helm's status line, which reports usage limits (usage.ts) and still prints the user's own.
      const extra = id === 'claude' ? claudeStatusLine() : { args: [], env: {} }
      // Both CLIs accept an initial prompt as a positional argument and stay interactive.
      return { command: config.hosts[id], args: [...extra.args, ...(prompt ? [prompt] : [])], title: label, env: extra.env }
    },
    skill: (name, args) => `${sigil}${name}${args ? ` ${args}` : ''}`,
  })
  return {
    claude: make('claude', 'Claude Code', '/'),
    codex: make('codex', 'Codex', '$'),
  }
}
