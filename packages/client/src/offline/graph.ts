// Sample brain graph for offline mode; online, the graph comes from tdt_brain_graph.
import { concepts, notes, people, type Note, type Project } from './mock'

/** index and candidate appear only in the live graph. */
export type NodeType = 'index' | 'project' | 'note' | 'doc' | 'candidate' | 'person' | 'concept'

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  refId: string
  detail?: string
  /** live nodes: TDT kind (fact, decision, …) and workspace-relative path */
  kind?: string
  path?: string | null
}

export interface GraphLink {
  source: string
  target: string
}

export function buildGraph(wsId: string, wsProjects: Project[], extraNotes: Note[]) {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const seen = new Set<string>()
  const link = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (a === b || seen.has(key)) return
    seen.add(key)
    links.push({ source: a, target: b })
  }

  for (const p of wsProjects) {
    nodes.push({ id: p.id, type: 'project', label: p.name, refId: p.id, detail: p.description })
    for (const t of p.teamIds) link(p.id, t)
  }
  for (const c of concepts.filter((c) => c.wsId === wsId)) {
    nodes.push({ id: c.id, type: 'concept', label: c.name, refId: c.id })
  }
  for (const person of people.filter((x) => x.wsId === wsId)) {
    nodes.push({ id: person.id, type: 'person', label: person.name, refId: person.id, detail: person.role })
  }
  for (const n of [...notes.filter((n) => n.wsId === wsId), ...extraNotes.filter((n) => n.wsId === wsId)]) {
    nodes.push({ id: n.id, type: n.kind, label: n.title, refId: n.id, detail: n.excerpt })
    for (const id of [...n.projectIds, ...n.conceptIds, ...n.personIds]) link(n.id, id)
  }

  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)) }
}
