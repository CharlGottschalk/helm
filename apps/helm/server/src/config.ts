// Helm's own configuration, kept outside any workspace (TDT reserves .tdt/).
// ~/.helm/config.json (override with HELM_HOME).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type McpProfile = 'read-only' | 'everyday'
export type HostId = 'claude' | 'codex'

export interface WorkspaceEntry {
  /** stable local id (slug), used in URLs */
  id: string
  name: string
  /** absolute path to the TDT workspace root */
  path: string
  /** TDT MCP profile; everyday enables write tools and must be opted into per workspace */
  profile: McpProfile
}

export interface HelmConfig {
  port: number
  /** command used to launch TDT, e.g. "tdt" or an absolute pipx path */
  tdtCommand: string
  /** host CLI commands for hand-off and builds */
  hosts: Record<HostId, string>
  defaultHost: HostId
  workspaces: WorkspaceEntry[]
}

export const HELM_HOME = process.env.HELM_HOME ?? join(homedir(), '.helm')
export const CONFIG_PATH = join(HELM_HOME, 'config.json')

const DEFAULTS: HelmConfig = {
  port: 4317,
  tdtCommand: 'tdt',
  hosts: { claude: 'claude', codex: 'codex' },
  defaultHost: 'claude',
  workspaces: [],
}

export function loadConfig(): HelmConfig {
  if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULTS)
  try {
    // Strip a UTF-8 BOM: Windows editors (and PowerShell) often add one, and JSON.parse rejects it.
    const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, '')) as Partial<HelmConfig>
    return { ...DEFAULTS, ...saved, hosts: { ...DEFAULTS.hosts, ...saved.hosts } }
  } catch (error) {
    // A corrupt config must not take the server down; start with defaults and say so.
    console.warn(`[helm] ignoring unreadable ${CONFIG_PATH}: ${(error as Error).message}`)
    return structuredClone(DEFAULTS)
  }
}

export function saveConfig(config: HelmConfig) {
  mkdirSync(HELM_HOME, { recursive: true })
  // TODO: atomic write (temp file + rename) once config is edited from the UI.
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

/** One section of a small JSON file under HELM_HOME (profiles, servers); never secrets (secrets.ts). */
export function readHelmFile<T>(name: string, key: string): Record<string, T> {
  const file = join(HELM_HOME, name)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))[key] ?? {}
  } catch {
    throw new Error(`${file} is unreadable; fix or remove it`)
  }
}

export function writeHelmFile(name: string, key: string, value: Record<string, unknown>) {
  mkdirSync(HELM_HOME, { recursive: true, mode: 0o700 })
  const file = join(HELM_HOME, name)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ [key]: value }, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}
