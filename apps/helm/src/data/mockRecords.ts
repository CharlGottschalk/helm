// Offline stand-in for TDT brain records, shaped like real TDT notes
// (YAML front matter: format_version, id, title, kind, status, sources, provenance, links, review).
// Mapping used by the mock graph: docs → approved knowledge, notes → pending candidates,
// projects → project registrations. With TDT, the whole-brain graph tool supplies real kinds.
import { stringify } from 'yaml'
import { offline } from '@helm/client'

const { concepts, notes, people, projects } = offline

const H = 3_600_000

/** Deterministic 64-hex stand-in for a TDT id/hash (not cryptographic). */
export function fakeHash(input: string) {
  let out = ''
  let h = 2166136261
  for (let round = 0; out.length < 64; round++) {
    for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619)
    h = Math.imul(h ^ round, 2246822507)
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')

export function recordPathFor(kind: 'knowledge' | 'candidate' | 'project', title: string, key: string) {
  const id = fakeHash(key)
  const folder = kind === 'knowledge' ? 'knowledge' : kind === 'candidate' ? 'candidates' : 'projects'
  return { id, path: `brain/${folder}/${slug(title)}-${id.slice(0, 8)}.md`, link: `${folder}/${slug(title)}-${id.slice(0, 8)}` }
}

function file(meta: Record<string, unknown>, body: string) {
  return `---\n${stringify(meta).trimEnd()}\n---\n\n${body.trimEnd()}\n`
}

function build(): Map<string, string> {
  const map = new Map<string, string>()
  const projectLink = new Map<string, string>()

  for (const p of projects) {
    const { id, path, link } = recordPathFor('project', p.name, p.id)
    projectLink.set(p.id, link)
    const owner = people.find((x) => x.id === p.ownerId)?.name ?? 'unassigned'
    map.set(path, file(
      { format_version: 1, id, title: p.name, kind: 'fact', status: 'approved', created: iso(Date.now() - 400 * H), updated: iso(Date.now() - 48 * H),
        sources: [`project:${p.code.toLowerCase()}/README.md`], provenance: { host: 'tdt', operation: 'project add' }, links: ['index'], review: [] },
      `# ${p.name}\n\n${p.description}\n\n## Registration\n\n- **Code:** \`${p.code}\`\n- **Owner:** ${owner}\n- **Stack:** ${p.stack.join(', ') || '—'}\n\nLinked from [[index]].`,
    ))
  }

  notes.forEach((n, i) => {
    const kind = n.kind === 'doc' ? 'knowledge' : 'candidate'
    const { id, path } = recordPathFor(kind, n.title, n.id)
    const plinks = n.projectIds.map((pid) => projectLink.get(pid)).filter(Boolean) as string[]
    const conceptNames = n.conceptIds.map((c) => concepts.find((x) => x.id === c)?.name).filter(Boolean)
    const who = n.personIds.map((pid) => people.find((x) => x.id === pid)?.name).filter(Boolean)
    const noteKind = (['fact', 'decision', 'inference', 'question'] as const)[i % 4]
    const body = [
      n.excerpt,
      '',
      `## Context`,
      '',
      `Raised by ${who.join(' and ') || 'the team'} while working on ${plinks.map((l) => `[[${l}]]`).join(', ') || 'the workspace'}.`,
      conceptNames.length ? `Related topics: ${conceptNames.join(', ')}.` : '',
      '',
      '## Notes',
      '',
      '- Evidence is summarised from the linked sources; see review history for approval.',
      '- Open question: does this still hold after the next release?',
      '',
      '```text',
      `source of truth: ${n.kind === 'doc' ? 'approved knowledge' : 'pending candidate'}`,
      '```',
    ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
    map.set(path, file(
      {
        format_version: 1, id, title: n.title, kind: noteKind,
        status: kind === 'knowledge' ? 'approved' : 'pending',
        created: iso(n.updated - 24 * H), updated: iso(n.updated),
        sources: [`session:claude/${fakeHash(n.id + 's').slice(0, 12)}#turn-${3 + i}`],
        provenance: { host: 'claude', session: fakeHash(n.id + 's').slice(0, 32), turn: 3 + i },
        project: n.projectIds[0] ? fakeHash(n.projectIds[0]) : null,
        links: plinks.length ? plinks : ['index'],
        review: kind === 'knowledge'
          ? [{ action: 'approve', at: iso(n.updated), instruction: 'User approved the displayed proposal' }]
          : [],
      },
      body,
    ))
  })
  return map
}

const STORAGE_KEY = 'helm.mockRecords.v1'

class MockRecordStore {
  private base = build()
  private edits = new Map<string, string>()

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>
      for (const [k, v] of Object.entries(saved)) this.edits.set(k, v)
    } catch {
      /* no storage: edits stay in memory */
    }
  }

  get(path: string) {
    const markdown = this.edits.get(path) ?? this.base.get(path)
    return markdown === undefined ? undefined : { markdown, revision: fakeHash(markdown) }
  }

  put(path: string, markdown: string) {
    this.edits.set(path, markdown)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.edits)))
    } catch {
      /* ignore */
    }
  }
}

export const mockRecordStore = new MockRecordStore()
