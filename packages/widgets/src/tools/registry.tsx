// Tool types (contracts/tool.md). Tools open as tabs beside the Command Deck; today they all come from plugins.
import type { ReactNode } from 'react'
import type { IconName } from '@helm/ui'
import { DbExplorer } from './DbExplorer'
import type { ConnectionDecl, SettingField, SettingValues, ToolCapability } from '@usetdt/helm-sdk'

export interface ToolType {
  type: string
  name: string
  icon: IconName
  description: string
  multi?: boolean
  settings?: SettingField[]
  connections?: ConnectionDecl[]
  capabilities?: ToolCapability[]
  /** where a sandboxed extension came from; absent for built-ins */
  sandboxed?: string
  render: (instance: { id: string }, settings: SettingValues, ctx?: { openSettings: () => void }) => ReactNode
}

/** Built-in tools (the Kanban ships in helm-plugin-software-production since 022). */
export const toolTypes: ToolType[] = [
  {
    type: 'db-explorer',
    name: 'DB explorer',
    icon: 'hex',
    description: 'Browse tables and run read-only SQL on a database profile from Settings → Connections.',
    render: () => <DbExplorer />,
  },
]

export const toolType = (type: string) => toolTypes.find((t) => t.type === type)
