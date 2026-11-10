import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Icon, Panel } from '@helm/ui'
import { GRID_COLS, placeItem, sameLayout, type GridItem } from '../../lib/gridLayout'
import { clamp, cx } from '../../lib/util'
import s from './Dashboard.module.css'

export interface WidgetDef {
  title: string
  code: string
  minW: number
  minH: number
  render: () => ReactNode
  actions?: ReactNode
}

const ROW_H = 76
const GAP = 14

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface Drag {
  id: string
  mode: 'move' | 'resize'
  startX: number
  startY: number
  origin: Rect
  ghost: Rect
  preview: GridItem[]
}

interface GridProps {
  layout: GridItem[]
  /** widget definition for a layout item; undefined hides it (unknown type) */
  resolve: (item: GridItem) => WidgetDef | undefined
  onChange: (l: GridItem[]) => void
  onRemove?: (id: string) => void
  /** id of a just-added widget to flash */
  highlightId?: string | null
}

export function DashboardGrid({ layout, resolve, onChange, onRemove, highlightId }: GridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const colW = (width - GAP * (GRID_COLS - 1)) / GRID_COLS
  const toPx = (i: GridItem): Rect => ({
    left: i.x * (colW + GAP),
    top: i.y * (ROW_H + GAP),
    width: i.w * colW + (i.w - 1) * GAP,
    height: i.h * ROW_H + (i.h - 1) * GAP,
  })

  // window-level listeners while a drag is in progress
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const item = layout.find((i) => i.id === d.id)!
      const def = resolve(item)!
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      let ghost: Rect
      let rect: Omit<GridItem, 'id'>
      if (d.mode === 'move') {
        ghost = { ...d.origin, left: clamp(d.origin.left + dx, 0, width - d.origin.width), top: Math.max(0, d.origin.top + dy) }
        rect = { w: item.w, h: item.h, x: Math.round(ghost.left / (colW + GAP)), y: Math.round(ghost.top / (ROW_H + GAP)) }
      } else {
        const minWpx = def.minW * colW + (def.minW - 1) * GAP
        const minHpx = def.minH * ROW_H + (def.minH - 1) * GAP
        ghost = {
          ...d.origin,
          width: clamp(d.origin.width + dx, minWpx, width - d.origin.left),
          height: Math.max(minHpx, d.origin.height + dy),
        }
        rect = {
          x: item.x,
          y: item.y,
          w: clamp(Math.round((ghost.width + GAP) / (colW + GAP)), def.minW, GRID_COLS - item.x),
          h: Math.max(def.minH, Math.round((ghost.height + GAP) / (ROW_H + GAP))),
        }
      }
      const next = placeItem(layout, d.id, rect)
      setDrag({ ...d, ghost, preview: sameLayout(next, d.preview) ? d.preview : next })
    }
    const up = () => {
      const d = dragRef.current
      if (d) onChange(d.preview)
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // re-bind only when a drag starts or ends
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.mode])

  const begin = (id: string, mode: Drag['mode']) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    if (mode === 'move' && (e.target as HTMLElement).closest('button, input, a')) return
    e.preventDefault()
    const item = layout.find((i) => i.id === id)!
    const origin = toPx(item)
    setDrag({ id, mode, startX: e.clientX, startY: e.clientY, origin, ghost: origin, preview: layout })
  }

  const current = drag?.preview ?? layout
  const rows = Math.max(1, ...current.map((i) => i.y + i.h))
  const height = rows * ROW_H + (rows - 1) * GAP

  return (
    <div ref={ref} className={cx(s.grid, drag && s.gridActive)} style={{ height, '--col-w': `${colW}px`, '--row-h': `${ROW_H}px`, '--gap': `${GAP}px` } as CSSProperties}>
      {width > 0 &&
        current.map((item) => {
          const def = resolve(item)
          if (!def) return null
          const dragging = drag?.id === item.id
          const r = dragging ? drag.ghost : toPx(item)
          return (
            <div key={item.id} data-widget-id={item.id} className={cx(s.cell, dragging && s.dragging, item.id === highlightId && s.added)} style={rectStyle(r)}>
              <Panel
                title={def.title}
                code={`${def.code} · ${item.w}×${item.h}`}
                className={s.widget}
                headerProps={{ onPointerDown: begin(item.id, 'move'), className: s.handle }}
                actions={
                  <>
                    {def.actions}
                    {onRemove && (
                      <button className={s.removeBtn} onClick={() => onRemove(item.id)} title="Remove widget" aria-label={`Remove ${def.title}`}>
                        <Icon name="x" size={13} />
                      </button>
                    )}
                    <span className={s.grip} title="Drag to move"><Icon name="drag" size={14} /></span>
                  </>
                }
              >
                {def.render()}
              </Panel>
              <div className={s.resize} onPointerDown={begin(item.id, 'resize')} title="Drag to resize" />
            </div>
          )
        })}
      {drag && (() => {
        const target = drag.preview.find((i) => i.id === drag.id)!
        return <div className={s.placeholder} style={rectStyle(toPx(target))} />
      })()}
      {drag && <GridGuides cols={GRID_COLS} rows={rows} colW={colW} />}
    </div>
  )
}

function rectStyle(r: Rect): CSSProperties {
  return { transform: `translate(${r.left}px, ${r.top}px)`, width: r.width, height: r.height }
}

function GridGuides({ cols, rows, colW }: { cols: number; rows: number; colW: number }) {
  return (
    <div className={s.guides} aria-hidden="true">
      {Array.from({ length: cols * (rows + 1) }, (_, i) => (
        <span
          key={i}
          style={rectStyle({ left: (i % cols) * (colW + GAP), top: Math.floor(i / cols) * (ROW_H + GAP), width: colW, height: ROW_H })}
        />
      ))}
    </div>
  )
}
