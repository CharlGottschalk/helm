import { color } from '@helm/ui'
import type { offline } from '@helm/client'

export const nodeStyle: Record<offline.NodeType, { color: string; r: number; label: string }> = {
  // --c-graph-index: a theme may move the index off amber (Satin Slate, where amber and the accent are both gold)
  index: { color: `var(--c-graph-index, ${color.amber})`, r: 16, label: 'Index' },
  project: { color: color.cyan, r: 13, label: 'Projects' },
  concept: { color: color.violet, r: 7, label: 'Concepts' },
  person: { color: color.amber, r: 8, label: 'People' },
  note: { color: color.green, r: 5.5, label: 'Notes' },
  doc: { color: color.blue, r: 6, label: 'Documents' },
  candidate: { color: color.blue, r: 6, label: 'Candidates' },
}
