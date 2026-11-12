// TDT data through the Helm server's MCP bridge: envelope unwrapping, pagination
// and a small React hook with loading/error/retry. Shapes mirror TDT's
// src/thisdamnthing/mcp_tools/models.py (tdt 0.1.11).
import { useCallback, useEffect, useState } from 'react'
import type { TdtResult } from '@usetdt/helm-sdk'

export type Availability = 'available' | 'missing or moved' | 'archived'

export interface TdtProject {
  id: string
  uri: string
  path: string
  created: string
  status: 'active' | 'archived'
  availability: Availability
  revision: string
}

export interface TdtProjectRead {
  project: TdtProject
  registration: { path: string; uri: string; revision: string; markdown: string } | null
  registration_status: 'available' | 'missing'
}

export interface TdtProjectInspection {
  project: { id: string; path: string; created: string; status: 'active' | 'archived' }
  brain_link: string | null
  top_level: string[]
  inventory_truncated: boolean
  documents: { source: string; text?: string | null; truncated?: boolean; omitted?: string | null }[]
  notice: string
}

export interface TdtProjectReferences {
  items: ({ path: string; sha256: string; matched: string[] } | { path: string; reason: string })[]
  next_cursor: string | null
  references_total: number
  skipped_total: number
  scan_truncated: boolean
  limitations: string[]
}

export interface TdtWorkspaceStatus {
  workspace_key: string
  observed_at: string
  pending_candidates: number
  incomplete_captures: number
  projects_total: number
  projects_available: number
  projects_missing: number
  projects_archived: number
  due_reminders: number
  recovery_markers: unknown[]
}

/** A failed TDT call. `retry` follows TDT: safe → call again; reread → read state first; inspect_outcome → check before repeating. */
export class TdtError extends Error {
  constructor(message: string, public code = 'unavailable', public retry: 'safe' | 'reread' | 'inspect_outcome' | null = 'safe') {
    super(message)
  }
}

export function unwrap<T>(result: TdtResult<T>): T {
  if (result.ok && result.data != null) return result.data
  const e = result.error
  throw new TdtError(e?.message ?? 'TDT returned no data', e?.code, e?.retry ?? null)
}

export const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

type Call = <T>(workspaceId: string, name: string, args?: Record<string, unknown>) => Promise<TdtResult<T>>

/** Every registered project, following next_cursor. */
export async function listProjects(call: Call, workspaceId: string) {
  const items: TdtProject[] = []
  let cursor: string | null | undefined
  do {
    const page = unwrap(await call<{ items: TdtProject[]; next_cursor: string | null }>(workspaceId, 'tdt_project_list', { limit: 50, ...(cursor ? { cursor } : {}) }))
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return items
}

/** One node of tdt_brain_graph; `id` is the wikilink target form (e.g. "work/notes/x", "tag/y"). */
export interface TdtGraphNode {
  id: string
  kind: string
  record: 'index' | 'project' | 'knowledge' | 'candidate' | 'session' | 'note' | 'tag'
  path: string | null
  title: string
  status: string | null
  project: string | null
  tags: string[]
  updated_at: string | null
  sha256: string | null
}
export interface TdtGraphLink { source: string; target: string; type: 'wikilink' | 'project' | 'tag' | 'index' }
export interface TdtGraph { revision: string; nodes: TdtGraphNode[]; links: TdtGraphLink[] }

const graphCache = new Map<string, TdtGraph>()

/**
 * The whole brain (tdt_brain_graph), all pages. The same object comes back while the
 * revision is unchanged, so views can memoise on it. If the brain changes mid-paging
 * (stale cursor, retry "reread"), it starts over once.
 */
export async function brainGraph(call: Call, workspaceId: string, limit = 2000, restarted = false): Promise<TdtGraph> {
  const nodes: TdtGraphNode[] = []
  const links: TdtGraphLink[] = []
  let cursor: string | null | undefined
  let revision = ''
  do {
    let page: TdtGraph & { next_cursor: string | null }
    try {
      page = unwrap(await call<TdtGraph & { next_cursor: string | null }>(workspaceId, 'tdt_brain_graph', { limit, ...(cursor ? { cursor } : {}) }))
    } catch (e) {
      if (cursor && !restarted && e instanceof TdtError && e.retry === 'reread') return brainGraph(call, workspaceId, limit, true)
      throw e
    }
    const known = graphCache.get(workspaceId)
    if (!cursor && known?.revision === page.revision) return known
    revision = page.revision
    nodes.push(...page.nodes)
    links.push(...page.links)
    cursor = page.next_cursor
  } while (cursor)
  const graph = { revision, nodes, links }
  graphCache.set(workspaceId, graph)
  return graph
}

/** One file of tdt_project_graph (TDT 0.1.15); `id` is the repo-relative path. */
export interface TdtProjectGraphNode { id: string; kind: 'code' | 'instruction' | 'doc'; symbols: string[]; symbols_total: number }
export interface TdtProjectGraphLink { source: string; target: string; relation: string; confidence: 'EXTRACTED' | 'INFERRED' }
export interface TdtProjectGraph {
  status: 'graph' | 'no_graph'
  revision: string
  schema_version: number | null
  graphify_version: string | null
  built_at: string | null
  built_at_commit: string | null
  code_only: boolean | null
  hook_installed: boolean | null
  nodes: TdtProjectGraphNode[]
  links: TdtProjectGraphLink[]
  nodes_total: number
  links_total: number
}

const projectGraphCache = new Map<string, TdtProjectGraph>()

/**
 * A linked project's file graph (tdt_project_graph, built by graphify through TDT), all
 * pages. Like brainGraph: the same object while the revision is unchanged, and one
 * restart when a cursor goes stale (retry "reread"). `no_graph` comes back as-is.
 */
export async function projectGraph(call: Call, workspaceId: string, projectId: string, limit = 2000, restarted = false): Promise<TdtProjectGraph> {
  const key = `${workspaceId}:${projectId}`
  const nodes: TdtProjectGraphNode[] = []
  const links: TdtProjectGraphLink[] = []
  let cursor: string | null | undefined
  let first: TdtProjectGraph | undefined
  do {
    let page: TdtProjectGraph & { next_cursor: string | null }
    try {
      page = unwrap(await call<TdtProjectGraph & { next_cursor: string | null }>(workspaceId, 'tdt_project_graph', { id: projectId, limit, ...(cursor ? { cursor } : {}) }))
    } catch (e) {
      if (cursor && !restarted && e instanceof TdtError && e.retry === 'reread') return projectGraph(call, workspaceId, projectId, limit, true)
      throw e
    }
    if (!cursor) {
      const known = projectGraphCache.get(key)
      if (page.status === 'graph' && known?.revision === page.revision) return known
      first = page
    }
    nodes.push(...(page.nodes ?? []))
    links.push(...(page.links ?? []))
    cursor = page.next_cursor
  } while (cursor)
  const { next_cursor: _, ...meta } = first as TdtProjectGraph & { next_cursor: string | null }
  const graph = { ...meta, nodes, links }
  if (graph.status === 'graph') projectGraphCache.set(key, graph)
  return graph
}

export interface Loaded<T> {
  data?: T
  error?: TdtError
  loading: boolean
  reload: () => void
}

/** Load `fetcher()` when `key` changes; `key` undefined means "nothing to load" (e.g. offline). */
export function useLoad<T>(key: string | undefined, fetcher: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: TdtError; loading: boolean }>({ loading: !!key })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!key) return setState({ loading: false })
    let live = true
    setState((s) => ({ data: s.data, loading: true }))
    fetcher().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState({ error: e instanceof TdtError ? e : new TdtError(e.message), loading: false }),
    )
    return () => {
      live = false
    }
  }, [key, nonce])
  return { ...state, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

export interface TdtReminder { id: string; path: string; status: 'pending' | 'done' | 'cancelled'; title: string; due_at: string; timezone: string }
export interface TdtRelay {
  id: string; path: string; title: string; status: 'open' | 'done' | 'cancelled'
  from_project: string; to_project: string; from_label: string; to_label: string
  origin: string | null; resolution: string | null; created: string; updated: string
}
/** A retained TDT UI session (tdt_ui_sessions): never a URL or token. */
export interface TdtUiSession { session_id: string; title: string | null; status: string; waiting: boolean; connected: boolean; created: string | null; updated: string | null }
export interface TdtStoredSummary { id: string; path: string; status: 'pending' | 'rejected' | 'scratchpad'; title: string; tags: string[] }
export interface TdtCaptureRequest { id: string; status: 'requested' | 'captured' | 'skipped'; created: string; completed?: string | null }
export interface TdtAudit { notes_total: number; findings_total: number; items: { path: string; title?: string; status?: string | null; kind?: string }[]; next_cursor: string | null }
export interface Page<T> { items: T[]; next_cursor: string | null }

/** An installed stack (tdt_stack_list); origin.kind 'marketplace' carries registry_url. */
export interface TdtStack {
  id: string
  version: string
  origin: { kind?: string; registry_url?: string; [k: string]: unknown }
}

export interface TdtSkillProposal {
  id: string
  name: string
  description: string
  status: 'pending' | 'approved' | 'declined'
  revision: string
}

// Widgets often ask for the same data; share results for a short while and dedupe in-flight calls.
const cache = new Map<string, { at: number; value: Promise<unknown> }>()
const TTL = 30_000

export function cached<T>(key: string, fetcher: () => Promise<T>, fresh = false): Promise<T> {
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>
  const value = fetcher()
  cache.set(key, { at: Date.now(), value })
  value.catch(() => cache.delete(key))
  return value
}
