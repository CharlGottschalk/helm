// Widget and tool contracts v1 (contracts/widget.md, contracts/tool.md).
import type { IconName } from './icons.js'
import type { ConnectionDecl } from './connection.js'
import type { SettingField, SettingValues } from './settings.js'

export type WidgetCategory = 'Overview' | 'Work' | 'Knowledge' | 'Agents' | 'Utility'

interface ManifestBase {
  id: string
  name: string
  version: string
  description: string
  icon: IconName
  multi?: boolean
  settings?: SettingField[]
  connections?: ConnectionDecl[]
  permissions?: { write?: boolean }
  /** sandboxed bundles only: HTML entry inside the bundle */
  entry?: string
}

export interface WidgetManifest extends ManifestBase {
  contract: 'helm.widget/1'
  category: WidgetCategory
  size: { w: number; h: number; minW?: number; minH?: number; maxW?: number; maxH?: number }
  refresh?: { intervalSeconds: number }
  /** only "orchestrate" (start builds) for widgets */
  capabilities?: WidgetCapability[]
}

export type WidgetCapability = 'orchestrate'

export type ToolCapability = 'orchestrate' | 'terminal' | 'chat'

export interface ToolManifest extends ManifestBase {
  contract: 'helm.tool/1'
  capabilities?: ToolCapability[]
}

/** What Helm gives every extension instance at runtime (built-in or sandboxed via the bridge). */
export interface ExtensionContext {
  instanceId: string
  workspaceId: string
  settings: SettingValues
  openSettings: () => void
  /** call a declared connection operation; refused when undeclared */
  call: <T = unknown>(connectionId: string, operation: string, args?: Record<string, unknown>) => Promise<T>
  startChat: (prompt: string) => void
}

export interface ToolContext extends ExtensionContext {
  /** requires capability "orchestrate" */
  build?: (input: { projectId: string; taskId: string; host?: 'claude' | 'codex' }) => Promise<void>
  /** requires capability "terminal" */
  openTerminal?: (cwd?: string) => Promise<void>
}

/** Where an extension came from (docs/README.md "Where extensions live"). */
export type ExtensionOrigin = 'builtin' | { plugin: string } | 'generated'
