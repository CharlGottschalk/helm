// Tiny grid layout engine for the dashboard: fixed column count, rows grow
// downward. Moving or resizing an item pushes colliding items down, then the
// whole layout is compacted upward so there are no gaps.

export interface GridItem {
  /** instance id, unique within a layout */
  id: string
  /** widget type from the registry; older saved layouts used the id as the type */
  type?: string
  /** per-instance settings values (contracts/settings.md), e.g. { projectId } for a project spotlight */
  config?: Record<string, string | number | boolean | string[]>
  x: number
  y: number
  w: number
  h: number
}

export const GRID_COLS = 6

type Rect = Pick<GridItem, 'x' | 'y' | 'w' | 'h'>

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const collides = (a: GridItem, b: GridItem) => a.id !== b.id && overlaps(a, b)

const byPosition = (a: GridItem, b: GridItem) => a.y - b.y || a.x - b.x

function compact(items: GridItem[], pinnedId?: string): GridItem[] {
  const out: GridItem[] = []
  const pinned = items.find((i) => i.id === pinnedId)
  if (pinned) out.push(pinned)
  for (const item of [...items].sort(byPosition)) {
    if (item.id === pinnedId) continue
    const next = { ...item }
    // first drop below anything it overlaps, then float up as far as possible
    let hit = out.find((o) => collides(next, o))
    while (hit) {
      next.y = hit.y + hit.h
      hit = out.find((o) => collides(next, o))
    }
    while (next.y > 0 && !out.some((o) => collides({ ...next, y: next.y - 1 }, o))) next.y--
    out.push(next)
  }
  return out
}

/** Place `id` at the given rect, resolving collisions. The moved item keeps its spot. */
export function placeItem(layout: GridItem[], id: string, rect: Rect): GridItem[] {
  const original = layout.find((i) => i.id === id)
  const w = Math.max(1, Math.min(GRID_COLS, rect.w))
  const x = Math.max(0, Math.min(GRID_COLS - w, rect.x))
  const moved = { ...original, id, x, w, y: Math.max(0, rect.y), h: Math.max(1, rect.h) }
  const rest = layout.filter((i) => i.id !== id)
  const result = compact([moved, ...rest], id)
  // let the moved item float up too if nothing sits above it
  return compact(result)
}

/** First free top-left position (row by row) where a w×h block fits without moving anything. */
export function findSlot(layout: GridItem[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(GRID_COLS, w)
  const bottom = Math.max(0, ...layout.map((i) => i.y + i.h))
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + width <= GRID_COLS; x++) {
      if (!layout.some((i) => overlaps({ x, y, w: width, h }, i))) return { x, y }
    }
  }
  return { x: 0, y: bottom }
}

/** Close vertical gaps, e.g. after removing an item. */
export const compactLayout = (layout: GridItem[]) => compact(layout)

export const typeOf = (item: GridItem) => item.type ?? item.id

export function sameLayout(a: GridItem[], b: GridItem[]) {
  if (a.length !== b.length) return false
  return a.every((i) => {
    const o = b.find((x) => x.id === i.id)
    return o && o.x === i.x && o.y === i.y && o.w === i.w && o.h === i.h
  })
}
