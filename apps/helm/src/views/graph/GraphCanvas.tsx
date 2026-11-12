// The force-directed graph canvas shared by the brain graph and project graphs:
// layout, pan/zoom/drag, search, legend, stats and the inspector shell. Callers map
// their data to CanvasNode/CanvasLink and fill in the inspector's actions.
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Badge, Icon, Input, type Tone } from '@helm/ui'
import { clamp, cx } from '../../lib/util'
import s from './GraphCanvas.module.css'

export interface CanvasNode {
  id: string
  /** key into `styles` */
  type: string
  label: string
  detail?: string
  /** shown next to search results, connections and as the inspector badge */
  tag?: string
}
export interface CanvasLink {
  source: string
  target: string
  /** key into `linkStyles`; links without styles draw in the default line colour */
  type?: string
}
export interface NodeStyle {
  color: string
  r: number
  label: string
  shape?: 'circle' | 'diamond' | 'dashed'
  tone?: Tone
}

interface SimNode extends SimulationNodeDatum, CanvasNode {
  r: number
}
type SimLink = SimulationLinkDatum<SimNode> & { type?: string }

const toggle = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export interface GraphCanvasProps<N extends CanvasNode> {
  graph: { nodes: N[]; links: CanvasLink[] }
  /** legend order; types with no nodes are left out when `hideEmptyTypes` */
  types: string[]
  styles: Record<string, NodeStyle>
  linkStyles?: Record<string, { color: string; label: string }>
  hideEmptyTypes?: boolean
  /** hubs anchor the layout: stronger repulsion, a ring and an uppercase label */
  isHub?: (n: CanvasNode) => boolean
  /** survives tab switches so the layout doesn't re-explode every time */
  positions: Map<string, { x: number; y: number }>
  query: string
  onQuery: (q: string) => void
  /** extra search hits besides a label match (e.g. text search, symbols) */
  extraMatch?: (n: N, q: string) => boolean
  /** jump to the best match for the query the view opened with */
  arriveWithQuery?: boolean
  placeholder: string
  status: { label: string; title: string }
  /** a centred message (errors, empty states) */
  notice?: ReactNode
  /** under the stats line (e.g. graph age) */
  footnote?: ReactNode
  /** inspector body between the title and the connections */
  inspector?: (n: N) => ReactNode
}

export function GraphCanvas<N extends CanvasNode>(props: GraphCanvasProps<N>) {
  const { graph, types, styles, linkStyles, positions, query, onQuery, extraMatch } = props
  const isHub = props.isHub ?? (() => false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [animating, setAnimating] = useState(false)
  const [, setFrame] = useState(0)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hiddenLinks, setHiddenLinks] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])

  /* ── simulation ── */
  useEffect(() => {
    const degree = new Map<string, number>()
    for (const l of graph.links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
    }
    let cached = 0
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const p = positions.get(n.id)
      if (p) cached++
      return { ...n, r: styles[n.type].r + Math.min(6, (degree.get(n.id) ?? 0) * 0.4), x: p?.x, y: p?.y }
    })
    const links: SimLink[] = graph.links.map((l) => ({ source: l.source, target: l.target, type: l.type }))
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
      for (const n of nodes) if (n.x != null && n.y != null) positions.set(n.id, { x: n.x, y: n.y })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (l.type && hiddenLinks.has(l.type)) continue
      if (!m.has(l.source)) m.set(l.source, new Set())
      if (!m.has(l.target)) m.set(l.target, new Set())
      m.get(l.source)!.add(l.target)
      m.get(l.target)!.add(l.source)
    }
    return m
  }, [graph, hiddenLinks])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return graph.nodes.filter((n) => !hidden.has(n.type) && (n.label.toLowerCase().includes(q) || n.type === q || !!extraMatch?.(n, q)))
  }, [query, graph, hidden, extraMatch])

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
  const arrivedWith = useRef(props.arriveWithQuery ? query : '')
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
  const selected = selectedId ? byId.get(selectedId) : undefined
  const counts = types.map((t) => [t, graph.nodes.filter((n) => n.type === t).length] as const).filter(([, c]) => !props.hideEmptyTypes || c > 0)
  const linkCounts = linkStyles
    ? Object.keys(linkStyles).map((t) => [t, graph.links.filter((l) => l.type === t).length] as const).filter(([, c]) => c > 0)
    : []
  const showLabel = (n: SimNode) => isHub(n) || view.k > 1.4 || n.id === hoverId || (focus?.all.has(n.id) ?? false)
  const dot = (n: CanvasNode) => <span className={s.resultDot} style={{ background: styles[n.type].color }} />

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
                if (l.type && hiddenLinks.has(l.type)) return null
                const lit = focus ? focus.all.has(a.id) && focus.all.has(b.id) && (focus.core.has(a.id) || focus.core.has(b.id)) : false
                const dim = focus && !lit
                const ls = l.type ? linkStyles?.[l.type] : undefined
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={cx(s.link, lit && s.linkLit, dim && s.dim)}
                    style={ls ? { stroke: ls.color, strokeOpacity: lit ? 0.9 : 0.3 } : undefined}
                  />
                )
              })}
            </g>

            <g>
              {visible.map((n) => {
                if (n.x == null || n.y == null) return null
                const st = styles[n.type]
                const hub = isHub(n)
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
                    {hub && <circle r={n.r + 7} className={s.ring} style={{ stroke: st.color }} />}
                    {(core || n.id === selectedId) && <circle r={n.r + 12} className={s.pulse} style={{ stroke: st.color }} />}
                    {st.shape === 'diamond' ? (
                      <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} transform="rotate(45)" strokeWidth={1.4} filter={core ? 'url(#glow)' : undefined} style={{ fill: st.color, fillOpacity: 0.18, stroke: st.color }} />
                    ) : (
                      <circle
                        r={n.r}
                        strokeWidth={hub ? 1.6 : st.shape === 'dashed' ? 1.4 : 0}
                        strokeDasharray={st.shape === 'dashed' ? '2.5 2' : undefined}
                        filter={core || hub ? 'url(#glow)' : undefined}
                        style={{ fill: st.color, fillOpacity: hub ? 0.22 : st.shape === 'dashed' ? 0.2 : 0.85, stroke: st.color }}
                      />
                    )}
                    {hub && <circle r={3} style={{ fill: st.color }} />}
                    {showLabel(n) && (
                      <text y={n.r + 14} className={cx(s.label, hub && s.labelProject)}>
                        {hub ? n.label.toUpperCase() : n.label}
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
                onQuery(e.target.value)
                setSelectedId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches[0]) select(matches[0].id, true)
                if (e.key === 'Escape') onQuery('')
              }}
              placeholder={props.placeholder}
              wrapClassName={s.search}
            />
            {query && matches.length > 0 && !selectedId && (
              <ul className={s.results}>
                {matches.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <button onClick={() => select(m.id, true)}>
                      {dot(m)}
                      <span className={s.resultLabel}>{m.label}</span>
                      <span className={s.resultType}>{m.tag ?? m.type}</span>
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
            <span title={props.status.title}>
              <b>{props.status.label}</b>
            </span>
          </div>
          {props.footnote && <div className={s.footnote}>{props.footnote}</div>}
        </div>

        <div className={s.legend} onPointerDown={(e) => e.stopPropagation()}>
          {counts.map(([t, c]) => (
            <button key={t} className={cx(s.legendItem, hidden.has(t) && s.off)} onClick={() => setHidden((h) => toggle(h, t))} title={hidden.has(t) ? `Show ${styles[t].label}` : `Hide ${styles[t].label}`}>
              <span className={cx(s.legendSwatch, styles[t].shape === 'diamond' && s.diamond, styles[t].shape === 'dashed' && s.dashed)} style={{ background: styles[t].color }} />
              {styles[t].label}
              <span className={s.legendCount}>{c}</span>
            </button>
          ))}
          {linkCounts.length > 0 && <span className={s.legendRule} />}
          {linkCounts.map(([t, c]) => (
            <button key={t} className={cx(s.legendItem, hiddenLinks.has(t) && s.off)} onClick={() => setHiddenLinks((h) => toggle(h, t))} title={hiddenLinks.has(t) ? `Show ${linkStyles![t].label}` : `Hide ${linkStyles![t].label}`}>
              <span className={s.legendLine} style={{ background: linkStyles![t].color }} />
              {linkStyles![t].label}
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

        {props.notice && (
          <div className={s.notice} role="status" onPointerDown={(e) => e.stopPropagation()}>
            {props.notice}
          </div>
        )}
        {selected && (
          <aside className={s.inspector} onPointerDown={(e) => e.stopPropagation()}>
            <div className={s.inspHead}>
              <Badge tone={styles[selected.type].tone ?? 'neutral'}>{selected.tag ?? selected.type}</Badge>
              <button className={s.inspClose} onClick={() => select(null)} aria-label="Close">
                <Icon name="x" size={14} />
              </button>
            </div>
            <h2 className={s.inspTitle}>{selected.label}</h2>
            {selected.detail && <p className={s.inspDetail}>{selected.detail}</p>}
            {props.inspector?.(selected)}
            <div className={s.inspSection}>
              <span className="hud-label">Connections · {adjacency.get(selected.id)?.size ?? 0}</span>
              <ul className={s.connections}>
                {[...(adjacency.get(selected.id) ?? [])]
                  .map((id) => byId.get(id)!)
                  .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type))
                  .map((n) => (
                    <li key={n.id}>
                      <button onClick={() => select(n.id, true)}>
                        {dot(n)}
                        <span className={s.resultLabel}>{n.label}</span>
                        <span className={s.resultType}>{n.tag ?? n.type}</span>
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

/** Inspector building blocks for callers. */
export const inspectorClass = { actions: s.inspActions, detail: s.inspDetail, symbols: s.symbols, warn: s.warn }
