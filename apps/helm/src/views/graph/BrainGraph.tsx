import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Badge, Button, Icon, Input } from '@helm/ui'
import { offline, server, useLoad, type TdtGraph } from '@helm/client'
import { nodeStyle } from '@helm/widgets'
import { recordPathFor } from '../../data/mockRecords'
import { refFromLink, type RecordRef } from '../../services/records'
import { clamp, cx } from '../../lib/util'
import { useHelm } from '../../state/store'
import type { Project } from '@helm/client'
import s from './BrainGraph.module.css'

const { buildGraph } = offline
type GraphNode = offline.GraphNode
type NodeType = offline.NodeType

interface SimNode extends SimulationNodeDatum, GraphNode {
  r: number
}
/** projects and the brain index anchor the layout */
const isHub = (n: { type: NodeType }) => n.type === 'project' || n.type === 'index'
type SimLink = SimulationLinkDatum<SimNode>

const OFFLINE_TYPES: NodeType[] = ['project', 'concept', 'person', 'note', 'doc']
const LIVE_TYPES: NodeType[] = ['index', 'project', 'doc', 'candidate', 'note', 'concept']
/** Live graph names; offline keeps the sample labels. */
const LIVE_LABELS: Partial<Record<NodeType, string>> = { doc: 'Knowledge', note: 'Scratchpad', concept: 'Tags' }
const typeTone = { index: 'amber', project: 'cyan', concept: 'violet', person: 'amber', note: 'green', doc: 'blue', candidate: 'blue' } as const

// survives tab switches so the layout doesn't re-explode every time
const positionCache = new Map<string, { x: number; y: number }>()

const LIVE_TYPE: Record<TdtGraph['nodes'][number]['record'], NodeType> = {
  index: 'index', project: 'project', knowledge: 'doc', session: 'doc', candidate: 'candidate', note: 'note', tag: 'concept',
}

/** tdt_brain_graph → the view's node shape. Registered projects are matched by the id prefix in their note filename. */
function fromTdt(graph: TdtGraph, projects: Project[]) {
  const nodes: GraphNode[] = graph.nodes.map((n) => {
    const suffix = n.record === 'project' ? n.id.match(/-([a-f0-9]{8,64})$/)?.[1] : undefined
    const project = suffix ? projects.find((p) => p.id.startsWith(suffix)) : undefined
    const detail = [n.record === 'knowledge' || n.record === 'candidate' ? n.kind : null, n.status, n.updated_at?.slice(0, 10), project?.path]
      .filter(Boolean)
      .join(' · ')
    return { id: n.id, type: LIVE_TYPE[n.record], label: n.title, refId: project?.id ?? n.id, detail, kind: n.kind, path: n.path }
  })
  return { nodes, links: graph.links.map((l) => ({ source: l.source, target: l.target })) }
}

/**
 * The brain record behind a graph node, or null for nodes that aren't records.
 * Live: the node id is a wikilink target. Offline sample: docs → knowledge,
 * notes → candidates, projects → registrations.
 */
function recordRefFor(node: GraphNode, live: boolean): RecordRef | null {
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
  const EMPTY = useMemo(() => ({ nodes: [] as GraphNode[], links: [] as offline.GraphLink[] }), [])
  const graph = online ? (live ?? EMPTY) : sample
  const TYPES = online ? LIVE_TYPES : OFFLINE_TYPES
  const typeLabel = (t: NodeType) => (online && LIVE_LABELS[t]) || nodeStyle[t].label

  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [animating, setAnimating] = useState(false)
  const [, setFrame] = useState(0)
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const query = state.graphQuery

  /* ── simulation ── */
  useEffect(() => {
    const degree = new Map<string, number>()
    for (const l of graph.links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
    }
    let cached = 0
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const p = positionCache.get(n.id)
      if (p) cached++
      return { ...n, r: nodeStyle[n.type].r + Math.min(6, (degree.get(n.id) ?? 0) * 0.4), x: p?.x, y: p?.y }
    })
    const links: SimLink[] = graph.links.map((l) => ({ source: l.source, target: l.target }))
    nodesRef.current = nodes
    linksRef.current = links

    let raf = 0
    const sim = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => (isHub(l.source as SimNode) || isHub(l.target as SimNode) ? 90 : 60)).strength(0.5))
      .force('charge', forceManyBody<SimNode>().strength((d) => (isHub(d) ? -520 : -180)))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<SimNode>((d) => d.r + 10))
      .force('x', forceX(0).strength(0.03))
      .force('y', forceY(0).strength(0.03))
      .alpha(cached === nodes.length ? 0.15 : 1)
      .on('tick', () => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => setFrame((f) => f + 1))
      })
    simRef.current = sim
    return () => {
      sim.stop()
      cancelAnimationFrame(raf)
      for (const n of nodes) if (n.x != null && n.y != null) positionCache.set(n.id, { x: n.x, y: n.y })
    }
  }, [graph])

  /* ── sizing ── */
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ── wheel zoom around the cursor ── */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left - rect.width / 2
      const py = e.clientY - rect.top - rect.height / 2
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), 0.25, 3.5)
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ── adjacency, search and focus ── */
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of graph.links) {
      if (!m.has(l.source)) m.set(l.source, new Set())
      if (!m.has(l.target)) m.set(l.target, new Set())
      m.get(l.source)!.add(l.target)
      m.get(l.target)!.add(l.source)
    }
    return m
  }, [graph])

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

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const text = textHits.q.toLowerCase() === q ? textHits.paths : null
    return graph.nodes.filter((n) => !hidden.has(n.type) && (n.label.toLowerCase().includes(q) || n.type === q || (!!n.path && !!text?.has(n.path))))
  }, [query, graph, hidden, textHits])

  const focus = useMemo(() => {
    const seeds = selectedId ? [selectedId] : matches.map((m) => m.id)
    if (!seeds.length) return null
    const set = new Set(seeds)
    for (const id of seeds) adjacency.get(id)?.forEach((n) => set.add(n))
    return { core: new Set(seeds), all: set }
  }, [selectedId, matches, adjacency])

  const centerOn = (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id)
    if (!n || n.x == null || n.y == null) return
    const k = Math.max(view.k, 1.3)
    setAnimating(true)
    setView({ k, x: -n.x * k, y: -n.y * k })
    window.setTimeout(() => setAnimating(false), 500)
  }

  const select = (id: string | null, center = false) => {
    setSelectedId(id)
    if (id && center) centerOn(id)
  }

  // when arriving with a query (e.g. from a note), jump to the best match once it has a position
  const arrivedWith = useRef(query)
  useEffect(() => {
    if (!arrivedWith.current) return
    const t = window.setTimeout(() => {
      const exact = graph.nodes.find((n) => n.label.toLowerCase() === arrivedWith.current.toLowerCase())
      const first = exact ?? matches[0]
      if (first) select(first.id, true)
      arrivedWith.current = ''
    }, 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── pointer: pan background, drag nodes ── */
  const gesture = useRef<{ kind: 'pan' | 'node'; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)

  const toWorld = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - rect.width / 2 - view.x) / view.k,
      y: (clientY - rect.top - rect.height / 2 - view.y) / view.k,
    }
  }

  const onPointerDown = (e: ReactPointerEvent, nodeId?: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    gesture.current = { kind: nodeId ? 'node' : 'pan', id: nodeId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    if (nodeId) {
      const n = nodesRef.current.find((x) => x.id === nodeId)!
      n.fx = n.x
      n.fy = n.y
      simRef.current?.alphaTarget(0.25).restart()
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.sx
    const dy = e.clientY - g.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
    if (g.kind === 'pan') {
      setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }))
    } else {
      const n = nodesRef.current.find((x) => x.id === g.id)!
      const p = toWorld(e.clientX, e.clientY)
      n.fx = p.x
      n.fy = p.y
    }
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.kind === 'node') {
      const n = nodesRef.current.find((x) => x.id === g.id)!
      n.fx = null
      n.fy = null
      simRef.current?.alphaTarget(0)
      if (!g.moved) select(g.id === selectedId ? null : g.id!)
    } else if (!g.moved) {
      select(null)
    }
  }

  /* ── render ── */
  const nodes = nodesRef.current
  const visible = nodes.filter((n) => !hidden.has(n.type))
  const visibleIds = new Set(visible.map((n) => n.id))
  const selected = nodes.find((n) => n.id === selectedId)
  const counts = TYPES.map((t) => [t, graph.nodes.filter((n) => n.type === t).length] as const).filter(([, c]) => !online || c > 0)
  const showLabel = (n: SimNode) =>
    isHub(n) || view.k > 1.4 || n.id === hoverId || (focus?.all.has(n.id) ?? false)

  return (
    <div className={s.view}>
      <div
        ref={wrapRef}
        className={cx(s.canvas, gesture.current?.kind === 'pan' && s.panning)}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width={size.w} height={size.h} className={s.svg}>
          <defs>
            <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="core">
              <stop offset="0%" style={{ stopColor: 'var(--c-cyan)', stopOpacity: 0.14 }} />
              <stop offset="100%" style={{ stopColor: 'var(--c-cyan)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <g
            className={cx(animating && s.animating)}
            style={{ transform: `translate(${size.w / 2 + view.x}px, ${size.h / 2 + view.y}px) scale(${view.k})` }}
          >
            <circle r={420} fill="url(#core)" />
            <circle r={260} className={s.orbit} />
            <circle r={420} className={s.orbit} />

            <g>
              {linksRef.current.map((l, i) => {
                const a = l.source as SimNode
                const b = l.target as SimNode
                if (a.x == null || b.x == null || !visibleIds.has(a.id) || !visibleIds.has(b.id)) return null
                const lit = focus ? focus.all.has(a.id) && focus.all.has(b.id) && (focus.core.has(a.id) || focus.core.has(b.id)) : false
                const dim = focus && !lit
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={cx(s.link, lit && s.linkLit, dim && s.dim)}
                  />
                )
              })}
            </g>

            <g>
              {visible.map((n) => {
                if (n.x == null || n.y == null) return null
                const st = nodeStyle[n.type]
                const core = focus?.core.has(n.id)
                const dim = focus && !focus.all.has(n.id)
                return (
                  <g
                    key={n.id}
                    className={cx(s.node, dim && s.dim, core && s.core, n.id === selectedId && s.selected)}
                    transform={`translate(${n.x},${n.y})`}
                    onPointerDown={(e) => onPointerDown(e, n.id)}
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                  >
                    {isHub(n) && <circle r={n.r + 7} className={s.ring} style={{ stroke: st.color }} />}
                    {(core || n.id === selectedId) && <circle r={n.r + 12} className={s.pulse} style={{ stroke: st.color }} />}
                    {n.type === 'concept' ? (
                      <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} transform="rotate(45)" strokeWidth={1.4} filter={core ? 'url(#glow)' : undefined} style={{ fill: st.color, fillOpacity: 0.18, stroke: st.color }} />
                    ) : (
                      <circle
                        r={n.r}
                        strokeWidth={isHub(n) ? 1.6 : n.type === 'candidate' ? 1.4 : 0}
                        strokeDasharray={n.type === 'candidate' ? '2.5 2' : undefined}
                        filter={core || isHub(n) ? 'url(#glow)' : undefined}
                        style={{ fill: st.color, fillOpacity: isHub(n) ? 0.22 : n.type === 'candidate' ? 0.2 : 0.85, stroke: st.color }}
                      />
                    )}
                    {isHub(n) && <circle r={3} style={{ fill: st.color }} />}
                    {showLabel(n) && (
                      <text y={n.r + 14} className={cx(s.label, isHub(n) && s.labelProject)}>
                        {isHub(n) ? n.label.toUpperCase() : n.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        {/* overlays */}
        <div className={s.topLeft} onPointerDown={(e) => e.stopPropagation()}>
          <div className={s.searchBox}>
            <Input
              icon="search"
              kbd={matches.length ? `${matches.length} hit${matches.length > 1 ? 's' : ''}` : undefined}
              value={query}
              onChange={(e) => {
                actions.setGraphQuery(e.target.value)
                setSelectedId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches[0]) select(matches[0].id, true)
                if (e.key === 'Escape') actions.setGraphQuery('')
              }}
              placeholder={online ? 'Search the brain…' : 'Search the brain… (try “memory” or “person”)'}
              wrapClassName={s.search}
            />
            {query && matches.length > 0 && !selectedId && (
              <ul className={s.results}>
                {matches.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <button onClick={() => select(m.id, true)}>
                      <span className={s.resultDot} style={{ background: nodeStyle[m.type].color }} />
                      <span className={s.resultLabel}>{m.label}</span>
                      <span className={s.resultType}>{online ? m.kind : m.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query && matches.length === 0 && <div className={s.noResults}>No nodes match “{query}”.</div>}
          </div>
          <div className={s.stats}>
            <span>
              NODES <b>{graph.nodes.length}</b>
            </span>
            <span>
              LINKS <b>{graph.links.length}</b>
            </span>
            <span>
              ZOOM <b>{view.k.toFixed(2)}×</b>
            </span>
            <span title={online ? 'tdt_brain_graph' : 'Offline: sample data, not your brain'}>
              <b>{online ? (liveGraph.loading && !live ? 'LOADING…' : liveGraph.error ? 'UNAVAILABLE' : 'LIVE') : 'SAMPLE DATA'}</b>
            </span>
          </div>
        </div>

        <div className={s.legend} onPointerDown={(e) => e.stopPropagation()}>
          {counts.map(([t, c]) => (
            <button
              key={t}
              className={cx(s.legendItem, hidden.has(t) && s.off)}
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h)
                  if (next.has(t)) next.delete(t)
                  else next.add(t)
                  return next
                })
              }
              title={hidden.has(t) ? `Show ${typeLabel(t)}` : `Hide ${typeLabel(t)}`}
            >
              <span className={cx(s.legendSwatch, t === 'concept' && s.diamond, t === 'candidate' && s.dashed)} style={{ background: nodeStyle[t].color }} />
              {typeLabel(t)}
              <span className={s.legendCount}>{c}</span>
            </button>
          ))}
        </div>

        <div className={s.zoom} onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => setView((v) => ({ ...v, k: clamp(v.k * 1.25, 0.25, 3.5), x: v.x * 1.25, y: v.y * 1.25 }))} aria-label="Zoom in">
            <Icon name="plus" size={14} />
          </button>
          <button onClick={() => setView((v) => ({ ...v, k: clamp(v.k / 1.25, 0.25, 3.5), x: v.x / 1.25, y: v.y / 1.25 }))} aria-label="Zoom out">
            <Icon name="minus" size={14} />
          </button>
          <button
            onClick={() => {
              setAnimating(true)
              setView({ x: 0, y: 0, k: 0.85 })
              window.setTimeout(() => setAnimating(false), 500)
            }}
            aria-label="Fit"
          >
            <Icon name="focus" size={14} />
          </button>
        </div>

        {online && liveGraph.error && (
          <div className={s.notice} role="status" onPointerDown={(e) => e.stopPropagation()}>
            {/* TDT reports a tool it doesn't have as profile_disabled */}
            {liveGraph.error.code === 'profile_disabled'
              ? 'The brain graph needs TDT 0.1.12 or newer (tdt_brain_graph).'
              : `Couldn't load the brain graph: ${liveGraph.error.message}`}
            <Button size="sm" variant="ghost" onClick={liveGraph.reload}>Retry</Button>
          </div>
        )}
        {selected && (
          <aside className={s.inspector} onPointerDown={(e) => e.stopPropagation()}>
            <div className={s.inspHead}>
              <Badge tone={typeTone[selected.type]}>{online ? selected.kind : selected.type}</Badge>
              <button className={s.inspClose} onClick={() => select(null)} aria-label="Close">
                <Icon name="x" size={14} />
              </button>
            </div>
            <h2 className={s.inspTitle}>{selected.label}</h2>
            {selected.detail && <p className={s.inspDetail}>{selected.detail}</p>}
            <div className={s.inspActions}>
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
            <div className={s.inspSection}>
              <span className="hud-label">Connections · {adjacency.get(selected.id)?.size ?? 0}</span>
              <ul className={s.connections}>
                {[...(adjacency.get(selected.id) ?? [])]
                  .map((id) => graph.nodes.find((n) => n.id === id)!)
                  .sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type))
                  .map((n) => (
                    <li key={n.id}>
                      <button onClick={() => select(n.id, true)}>
                        <span className={s.resultDot} style={{ background: nodeStyle[n.type].color }} />
                        <span className={s.resultLabel}>{n.label}</span>
                        <span className={s.resultType}>{online ? n.kind : n.type}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
