import { useEffect, useMemo, useState } from 'react'
import { Button } from '@helm/ui'
import { offline, server, useLoad, type TdtGraph } from '@helm/client'
import { nodeStyle } from '@helm/widgets'
import { recordPathFor } from '../../data/mockRecords'
import { refFromLink, type RecordRef } from '../../services/records'
import { useHelm } from '../../state/store'
import type { Project } from '@helm/client'
import { GraphCanvas, inspectorClass, type CanvasNode, type NodeStyle } from './GraphCanvas'

const { buildGraph } = offline
type NodeType = offline.NodeType
type BrainNode = offline.GraphNode & CanvasNode

/** projects and the brain index anchor the layout */
const isHub = (n: { type: string }) => n.type === 'project' || n.type === 'index'

const OFFLINE_TYPES: NodeType[] = ['project', 'concept', 'person', 'note', 'doc']
const LIVE_TYPES: NodeType[] = ['index', 'project', 'doc', 'candidate', 'note', 'concept']
/** Live graph names; offline keeps the sample labels. */
const LIVE_LABELS: Partial<Record<NodeType, string>> = { doc: 'Knowledge', note: 'Scratchpad', concept: 'Tags' }
const typeTone = { index: 'amber', project: 'cyan', concept: 'violet', person: 'amber', note: 'green', doc: 'blue', candidate: 'blue' } as const
const shape: Partial<Record<NodeType, NodeStyle['shape']>> = { concept: 'diamond', candidate: 'dashed' }

const styleFor = (online: boolean) =>
  Object.fromEntries(
    (Object.keys(nodeStyle) as NodeType[]).map((t) => [t, { ...nodeStyle[t], label: (online && LIVE_LABELS[t]) || nodeStyle[t].label, shape: shape[t], tone: typeTone[t] }]),
  ) as Record<NodeType, NodeStyle>

// survives tab switches so the layout doesn't re-explode every time
const positionCache = new Map<string, { x: number; y: number }>()

const LIVE_TYPE: Record<TdtGraph['nodes'][number]['record'], NodeType> = {
  index: 'index', project: 'project', knowledge: 'doc', session: 'doc', candidate: 'candidate', note: 'note', tag: 'concept',
}

/** tdt_brain_graph → the view's node shape. Registered projects are matched by the id prefix in their note filename. */
function fromTdt(graph: TdtGraph, projects: Project[]) {
  const nodes: BrainNode[] = graph.nodes.map((n) => {
    const suffix = n.record === 'project' ? n.id.match(/-([a-f0-9]{8,64})$/)?.[1] : undefined
    const project = suffix ? projects.find((p) => p.id.startsWith(suffix)) : undefined
    const detail = [n.record === 'knowledge' || n.record === 'candidate' ? n.kind : null, n.status, n.updated_at?.slice(0, 10), project?.path]
      .filter(Boolean)
      .join(' · ')
    return { id: n.id, type: LIVE_TYPE[n.record], label: n.title, refId: project?.id ?? n.id, detail, kind: n.kind, path: n.path, tag: n.kind }
  })
  return { nodes, links: graph.links.map((l) => ({ source: l.source, target: l.target })) }
}

/**
 * The brain record behind a graph node, or null for nodes that aren't records.
 * Live: the node id is a wikilink target. Offline sample: docs → knowledge,
 * notes → candidates, projects → registrations.
 */
function recordRefFor(node: BrainNode, live: boolean): RecordRef | null {
  if (live) {
    if (node.type === 'concept' || node.type === 'index') return null
    const ref = refFromLink(node.id)
    return { ...ref, title: node.label, id: node.type === 'project' && node.refId !== node.id ? node.refId : undefined }
  }
  const kind = node.type === 'doc' ? 'knowledge' : node.type === 'note' ? 'candidate' : node.type === 'project' ? 'project' : null
  if (!kind) return null
  const { id, path } = recordPathFor(kind, node.label, node.refId)
  return { kind, path, id, title: node.label }
}

export function BrainGraph() {
  const { state, projects, actions, online, ws } = useHelm()
  const liveGraph = useLoad(online ? `graph:${ws.id}` : undefined, () => server.brainGraph(ws.id))
  const sample = useMemo(() => buildGraph(state.wsId, projects, state.userNotes), [state.wsId, projects, state.userNotes])
  const live = useMemo(() => (liveGraph.data ? fromTdt(liveGraph.data, projects) : null), [liveGraph.data, projects])
  const EMPTY = useMemo(() => ({ nodes: [] as BrainNode[], links: [] as offline.GraphLink[] }), [])
  const graph: { nodes: BrainNode[]; links: offline.GraphLink[] } = online ? (live ?? EMPTY) : sample
  const styles = useMemo(() => styleFor(online), [online])
  const query = state.graphQuery

  // Live: titles match at once; tdt_brain_search adds records whose text matches (by path).
  const [textHits, setTextHits] = useState<{ q: string; paths: Set<string> }>({ q: '', paths: new Set() })
  useEffect(() => {
    const q = query.trim()
    if (!online || q.length < 2) return
    let live = true
    const t = window.setTimeout(() => {
      server
        .tdt<{ items: { path: string }[] }>(ws.id, 'tdt_brain_search', { query: q, limit: 50 })
        .then((r) => live && setTextHits({ q, paths: new Set(r.items.map((i) => i.path)) }), () => {})
    }, 250)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [query, online, ws.id])
  const extraMatch = useMemo(() => {
    const text = textHits.q.toLowerCase() === query.trim().toLowerCase() ? textHits.paths : null
    return (n: BrainNode) => !!n.path && !!text?.has(n.path)
  }, [textHits, query])

  return (
    <GraphCanvas<BrainNode>
      graph={graph}
      types={online ? LIVE_TYPES : OFFLINE_TYPES}
      styles={styles}
      hideEmptyTypes={online}
      isHub={isHub}
      positions={positionCache}
      query={query}
      onQuery={actions.setGraphQuery}
      extraMatch={extraMatch}
      arriveWithQuery
      placeholder={online ? 'Search the brain…' : 'Search the brain… (try “memory” or “person”)'}
      status={{
        title: online ? 'tdt_brain_graph' : 'Offline: sample data, not your brain',
        label: online ? (liveGraph.loading && !live ? 'LOADING…' : liveGraph.error ? 'UNAVAILABLE' : 'LIVE') : 'SAMPLE DATA',
      }}
      notice={
        online &&
        liveGraph.error && (
          <>
            {/* TDT reports a tool it doesn't have as profile_disabled */}
            {liveGraph.error.code === 'profile_disabled'
              ? 'The brain graph needs TDT 0.1.12 or newer (tdt_brain_graph).'
              : `Couldn't load the brain graph: ${liveGraph.error.message}`}
            <Button size="sm" variant="ghost" onClick={liveGraph.reload}>Retry</Button>
          </>
        )
      }
      inspector={(selected) => (
        <div className={inspectorClass.actions}>
          {recordRefFor(selected, online) && (
            <Button size="sm" variant="primary" icon="doc" onClick={() => actions.openRecord(recordRefFor(selected, online)!)}>
              Read record
            </Button>
          )}
          {selected.type === 'project' && (
            <Button
              size="sm"
              variant="ghost"
              icon="folder"
              onClick={() => {
                const p = projects.find((x) => x.id === selected.refId)
                if (p) actions.openProject(p)
              }}
            >
              Open
            </Button>
          )}
          <Button size="sm" icon="chat" onClick={() => actions.startChat(`What do we know about ${selected.label}?`)}>
            Ask Helm
          </Button>
        </div>
      )}
    />
  )
}
