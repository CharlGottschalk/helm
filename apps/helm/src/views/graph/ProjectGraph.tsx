import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@helm/ui'
import { offline, server, useLoad, type HostId, type TdtError, type TdtProjectGraph } from '@helm/client'
import { color } from '@helm/ui'
import { useHelm } from '../../state/store'
import { GraphCanvas, inspectorClass, type CanvasNode, type NodeStyle } from './GraphCanvas'

type Kind = TdtProjectGraph['nodes'][number]['kind']
interface FileNode extends CanvasNode {
  symbols: string[]
  symbolsTotal: number
}

const TYPES: Kind[] = ['instruction', 'doc', 'code']
const STYLES: Record<Kind, NodeStyle> = {
  code: { color: color.blue, r: 5.5, label: 'Code', tone: 'blue' },
  instruction: { color: color.amber, r: 8, label: 'Instructions', shape: 'diamond', tone: 'amber' },
  doc: { color: color.green, r: 6, label: 'Docs', tone: 'green' },
}
/** graphify relations, grouped so the legend stays short */
const RELATION_GROUP: Record<string, string> = {
  imports: 'imports', imports_from: 'imports', re_exports: 'imports', dynamic_import: 'imports',
  calls: 'calls', references: 'references', declares: 'structure', extends: 'structure',
}
const LINK_STYLES = {
  imports: { color: color.cyan, label: 'Imports' },
  calls: { color: color.green, label: 'Calls' },
  references: { color: color.violet, label: 'References' },
  structure: { color: color.amber, label: 'Declares / extends' },
  other: { color: color.text2, label: 'Other' },
}

const basename = (p: string) => p.split('/').pop() || p
const positionCaches = new Map<string, Map<string, { x: number; y: number }>>()

/** The hand-off prompt that builds or refreshes a project graph (TDT skill /tdt-project-graph). */
export function graphHandoffPrompt(host: HostId, projectId: string) {
  return `${host === 'codex' ? '$' : '/'}tdt-project-graph ${projectId}`
}

function fromTdt(g: TdtProjectGraph) {
  const nodes: FileNode[] = g.nodes.map((n) => ({
    id: n.id, type: n.kind, label: basename(n.id), detail: n.id, tag: n.kind, symbols: n.symbols, symbolsTotal: n.symbols_total,
  }))
  const ids = new Set(nodes.map((n) => n.id))
  const links = g.links
    .filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target, type: RELATION_GROUP[l.relation] ?? 'other' }))
  return { nodes, links }
}

function errorText(e: TdtError) {
  // TDT reports a tool it doesn't have as profile_disabled
  if (e.code === 'profile_disabled') return 'The project graph needs TDT 0.1.15 or newer (tdt_project_graph).'
  if (e.code === 'unsupported_schema') return 'TDT returned a project graph schema this Helm does not support. Update Helm or TDT.'
  return `Couldn't load the project graph: ${e.message}`
}

/** One line on the graph's age, scope and freshness, from tdt_project_graph. */
export function GraphAge({ g, className }: { g: TdtProjectGraph; className?: string }) {
  const built = g.built_at ? new Date(g.built_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown'
  return (
    <span className={className}>
      Built {built} with graphify {g.graphify_version ?? '?'} · {g.code_only ? 'code only' : 'code + docs'}
      {g.hook_installed ? ' · git hook keeps it fresh' : <span className={inspectorClass.warn}> · no git hook: may be stale after commits</span>}
    </span>
  )
}

export const GRAPHIFY_NOTE = 'Graph by graphify. Community-built integration, not affiliated with or endorsed by Graphify Labs.'

export function ProjectGraph({ projectId }: { projectId: string }) {
  const { state, projects, actions, online, ws } = useHelm()
  const p = projects.find((x) => x.id === projectId)
  const load = useLoad(online ? `pgraph:${ws.id}:${projectId}` : undefined, () => server.projectGraph(ws.id, projectId))
  const data = online ? load.data : offline.sampleProjectGraph
  const graph = useMemo(() => (data?.status === 'graph' ? fromTdt(data) : { nodes: [] as FileNode[], links: [] }), [data])
  const [query, setQuery] = useState('')
  const positions = useMemo(() => {
    const key = `${ws.id}:${projectId}`
    if (!positionCaches.has(key)) positionCaches.set(key, new Map())
    return positionCaches.get(key)!
  }, [ws.id, projectId])
  const generate = () => actions.handoff(graphHandoffPrompt(state.settings.host, projectId), projectId)
  const extraMatch = useMemo(() => (n: FileNode, q: string) => n.id.toLowerCase().includes(q) || n.symbols.some((x) => x.toLowerCase().includes(q)), [])

  let notice: ReactNode = null
  if (online && load.error)
    notice = (
      <>
        {errorText(load.error)}
        <Button size="sm" variant="ghost" onClick={load.reload}>Retry</Button>
      </>
    )
  else if (data?.status === 'no_graph')
    notice = (
      <>
        {p?.name ?? 'This project'} has no project graph yet.
        <Button size="sm" variant="primary" icon="chat" onClick={generate}>Generate graph</Button>
      </>
    )

  return (
    <GraphCanvas<FileNode>
      graph={graph}
      types={TYPES}
      styles={STYLES}
      linkStyles={LINK_STYLES}
      hideEmptyTypes
      positions={positions}
      query={query}
      onQuery={setQuery}
      extraMatch={extraMatch}
      placeholder="Search files and symbols…"
      status={{
        title: online ? 'tdt_project_graph' : 'Offline: sample data, not your project',
        label: online ? (load.loading && !load.data ? 'LOADING…' : load.error ? 'UNAVAILABLE' : 'LIVE') : 'SAMPLE DATA',
      }}
      notice={notice}
      footnote={
        data?.status === 'graph' && (
          <>
            <GraphAge g={data} />
            <br />
            {GRAPHIFY_NOTE}
          </>
        )
      }
      inspector={(n) => (
        <>
          {n.symbols.length > 0 && (
            <div className={inspectorClass.symbols} aria-label="Symbols">
              {n.symbols.map((x) => (
                <span key={x}>{x}</span>
              ))}
              {n.symbolsTotal > n.symbols.length && <em>+{n.symbolsTotal - n.symbols.length} more</em>}
            </div>
          )}
          <div className={inspectorClass.actions}>
            <Button size="sm" icon="chat" onClick={() => actions.startChat(`In ${p?.name ?? 'this project'}, what does ${n.id} do?`, projectId)}>
              Ask Helm
            </Button>
          </div>
        </>
      )}
    />
  )
}
