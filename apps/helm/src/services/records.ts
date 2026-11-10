// TDT brain records: read, and edit through the operations TDT sanctions.
//
// What TDT allows today:
//   knowledge  → body + links via tdt_brain_repair_preview/apply (identity, title, kind,
//                sources, provenance and review history are protected)
//   candidate  → whole summary via tdt_candidate_review { action: 'edit' } (stays pending)
//   index      → body via brain repair
//   scratchpad → read only (no TDT edit tool)
//   project    → read only (registration; use project lifecycle tools)
// TODO(tdt_note_edit): when TDT adds a hash-bound note edit tool, widen EDIT_CAPABILITIES.
//
// Helm v1 performs no TDT writes: online, edits and reviews become hand-off prompts
// (editHandoffPrompt, reviewHandoffPrompt) for Claude Code / Codex, which run TDT's own
// preview/confirm flow with the user. previewEdit/applyEdit edit offline sample data only;
// the server's everyday-gated records endpoint stays for a future opt-in.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { mockRecordStore } from '../data/mockRecords'
import type { TdtResult } from '@usetdt/helm-sdk'
import { server } from '@helm/client'

export type RecordKind = 'knowledge' | 'candidate' | 'scratchpad' | 'project' | 'index'
export type NoteKind = 'fact' | 'decision' | 'question' | 'inference'
export const NOTE_KINDS: NoteKind[] = ['fact', 'decision', 'question', 'inference']

/** Identifies a record. `path` is workspace-relative (e.g. brain/knowledge/x-1a2b3c4d.md). */
export interface RecordRef {
  kind: RecordKind
  path: string
  /** 64-hex TDT id; needed to read knowledge with frontmatter and to review candidates */
  id?: string
  title: string
}

export interface BrainRecord {
  ref: RecordRef
  frontmatter: Record<string, unknown>
  body: string
  /** complete file text as TDT returned it */
  markdown: string
  /** hash TDT expects in edits (expected_sha256) */
  revision: string
  status: string
  source: 'tdt' | 'mock'
}

export type EditableField = 'title' | 'kind' | 'sources' | 'links' | 'project'

export interface EditCapability {
  body: boolean
  fields: EditableField[]
  /** TDT operation used to apply edits, shown in the UI */
  via: string | null
  /** why this record (or a field) can't be edited */
  reason: string
}

export const EDIT_CAPABILITIES: Record<RecordKind, EditCapability> = {
  knowledge: { body: true, fields: ['links'], via: 'tdt_brain_repair', reason: 'TDT protects identity, title, kind, sources, provenance and review history on approved knowledge.' },
  index: { body: true, fields: [], via: 'tdt_brain_repair', reason: 'The brain index has no frontmatter; edit its body.' },
  candidate: { body: true, fields: ['title', 'kind', 'sources', 'links', 'project'], via: 'tdt_candidate_review (edit)', reason: 'Edits keep the candidate pending; approve it in review afterwards.' },
  scratchpad: { body: false, fields: [], via: null, reason: 'TDT has no tool to edit scratchpad notes yet. Save a new note instead.' },
  project: { body: false, fields: [], via: null, reason: 'Project registrations change through the project lifecycle (relink, archive, remove).' },
}

/* ── parsing ─────────────────────────────────────────── */

export function splitFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const text = markdown.replace(/\r\n?/g, '\n')
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text.trim() }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return { frontmatter: {}, body: text.trim() }
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(text.slice(4, end))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed as Record<string, unknown>
  } catch {
    // Malformed metadata: show the body and leave properties empty; TDT will refuse edits.
  }
  return { frontmatter, body: text.slice(end + 5).trim() }
}

/** Rebuild a note file the way TDT writes it ("---\n<yaml>\n---\n\n<body>\n"). Used for previews only. */
export function joinFrontmatter(frontmatter: Record<string, unknown>, body: string) {
  if (!Object.keys(frontmatter).length) return body.trimEnd() + '\n'
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body.trimEnd()}\n`
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g

/** Brain-relative link targets used in a body, in order, without duplicates. */
export function bodyLinks(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(WIKILINK)) {
    const target = m[1].trim()
    if (!out.includes(target)) out.push(target)
  }
  return out
}

/** Turn [[target|alias]] into markdown links Helm's renderer can open. */
export function wikilinksToMarkdown(body: string) {
  return body.replace(WIKILINK, (_, target: string, alias?: string) => `[${(alias || target).trim()}](helm-record:${encodeURIComponent(target.trim())})`)
}

/** Resolve a wikilink target (e.g. "knowledge/x-1a2b", "projects/p", "work/notes/n", "index"). */
export function refFromLink(target: string): RecordRef {
  const t = target.replace(/\.md$/, '')
  if (t === 'index') return { kind: 'index', path: 'brain/index.md', title: 'Brain index' }
  if (t.startsWith('work/notes/')) return { kind: 'scratchpad', path: `${t}.md`, title: t.split('/').pop()! }
  if (t.startsWith('projects/')) return { kind: 'project', path: `brain/${t}.md`, title: t.split('/').pop()! }
  if (t.startsWith('candidates/')) return { kind: 'candidate', path: `brain/${t}.md`, title: t.split('/').pop()! }
  return { kind: 'knowledge', path: `brain/${t}.md`, title: t.split('/').pop()! }
}

/* ── reading ─────────────────────────────────────────── */

function unwrap<T>(result: TdtResult<T>): T {
  if (!result.ok || !result.data) throw new Error(result.error?.message ?? 'TDT refused the read')
  return result.data
}

function fromMarkdown(ref: RecordRef, markdown: string, revision: string, source: BrainRecord['source']): BrainRecord {
  const { frontmatter, body } = splitFrontmatter(markdown)
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : ref.title
  return { ref: { ...ref, title, id: (frontmatter.id as string) ?? ref.id }, frontmatter, body, markdown, revision, status: String(frontmatter.status ?? ''), source }
}

export async function readRecord(localWorkspaceId: string, ref: RecordRef): Promise<BrainRecord> {
  if (!server.online) {
    const mock = mockRecordStore.get(ref.path)
    if (!mock) throw new Error('No record at this path in the offline sample data')
    return fromMarkdown(ref, mock.markdown, mock.revision, 'mock')
  }
  const ws = localWorkspaceId
  switch (ref.kind) {
    case 'knowledge': {
      // tdt_brain_read returns the body only; review status has the full file and the edit hash,
      // but needs the id, which search/graph/wikilink refs lack: the server looks it up.
      const id = ref.id ?? await server.request<{ id: string }>('POST', `/api/workspaces/${ws}/records/knowledge-id`, { path: ref.path }).then((r) => r.id, () => undefined)
      if (!id) {
        const data = unwrap(await server.callTool<{ content: string; revision: string; path: string; title: string; status: string }>(ws, 'tdt_brain_read', { reference: ref.path }))
        // tdt_brain_read appends `Sources: [...]` (JSON) to the body; keep it out of the body.
        const m = /\n+Sources: (\[.*\])\s*$/.exec(data.content)
        let sources: unknown = []
        try { sources = m ? JSON.parse(m[1]) : [] } catch { /* leave empty */ }
        const body = m ? data.content.slice(0, m.index) : data.content
        return { ref: { ...ref, title: data.title, path: data.path }, frontmatter: { title: data.title, status: data.status, sources }, body, markdown: body, revision: data.revision, status: data.status, source: 'tdt' }
      }
      const data = unwrap(await server.callTool<{ markdown: string; revision: string; path: string }>(ws, 'tdt_candidate_review_status', { id, budget_bytes: 131072 }))
      return fromMarkdown({ ...ref, id, path: data.path }, data.markdown, data.revision, 'tdt')
    }
    case 'candidate': {
      const data = unwrap(await server.callTool<{ markdown: string; revision: string }>(ws, 'tdt_candidate_read', { reference: ref.path, budget_bytes: 131072 }))
      return fromMarkdown(ref, data.markdown, data.revision, 'tdt')
    }
    case 'scratchpad': {
      const data = unwrap(await server.callTool<{ markdown: string; revision: string }>(ws, 'tdt_note_read', { reference: ref.path, budget_bytes: 131072 }))
      return fromMarkdown(ref, data.markdown, data.revision, 'tdt')
    }
    case 'project': {
      const data = unwrap(await server.callTool<{ registration: { markdown: string; revision: string } | null }>(ws, 'tdt_project_read', { reference: ref.id ?? ref.path, budget_bytes: 131072 }))
      if (!data.registration) throw new Error('This project has no registration note')
      return fromMarkdown(ref, data.registration.markdown, data.registration.revision, 'tdt')
    }
    case 'index':
      // TODO: TDT has no direct index read tool; the whole-brain graph tool (D6) may expose it.
      throw new Error('Reading brain/index.md needs a TDT read tool')
  }
}

/* ── editing ─────────────────────────────────────────── */

export interface RecordDraft {
  body: string
  title?: string
  kind?: NoteKind
  sources?: string[]
  links?: string[]
  project?: string | null
}

export interface EditPreview {
  /** full file text before and after, for the diff */
  before: string
  after: string
}

/** Client-side checks mirroring TDT's, so problems show before a round trip. */
export function validateDraft(record: BrainRecord, draft: RecordDraft): string[] {
  const problems: string[] = []
  const cap = EDIT_CAPABILITIES[record.ref.kind]
  if (!draft.body.trim()) problems.push('Body cannot be empty')
  if (draft.body.length > 16000) problems.push('Body is longer than 16,000 characters')
  const links = draft.links ?? []
  if (links.length > 100) problems.push('At most 100 links')
  if (record.ref.kind === 'knowledge') {
    const inBody = new Set(bodyLinks(draft.body))
    const missing = links.filter((l) => !inBody.has(l))
    if (missing.length) problems.push(`Links must also appear in the body: ${missing.join(', ')}`)
  }
  if (cap.fields.includes('title') && !(draft.title ?? '').trim()) problems.push('Title is required')
  if (cap.fields.includes('sources') && !(draft.sources ?? []).length) problems.push('At least one source is required')
  if ((draft.sources ?? []).length > 8) problems.push('At most 8 sources')
  return problems
}

/** The record as it would look after the edit (offline previews and candidate previews). */
export function projected(record: BrainRecord, draft: RecordDraft): string {
  const cap = EDIT_CAPABILITIES[record.ref.kind]
  const fm: Record<string, unknown> = { ...record.frontmatter }
  if (cap.fields.includes('links')) fm.links = draft.links ?? []
  if (cap.fields.includes('title')) fm.title = draft.title
  if (cap.fields.includes('kind')) fm.kind = draft.kind
  if (cap.fields.includes('sources')) fm.sources = draft.sources
  if (cap.fields.includes('project')) fm.project = draft.project || null
  return joinFrontmatter(fm, draft.body)
}

/** Offline sample records only: TDT records hand edits off (editHandoffPrompt). */
export function previewEdit(record: BrainRecord, draft: RecordDraft): EditPreview {
  return { before: record.markdown, after: projected(record, draft) }
}

export function applyEdit(record: BrainRecord, preview: EditPreview) {
  mockRecordStore.put(record.ref.path, preview.after)
}

const HANDOFF_LIMIT = 7000 // the server accepts 8000-character prompts

/** Prompt asking the host agent to apply an edit through TDT, with the user confirming its preview. */
export function editHandoffPrompt(record: BrainRecord, draft: RecordDraft) {
  const cap = EDIT_CAPABILITIES[record.ref.kind]
  const was = draftFromRecord(record)
  const changes: string[] = []
  const field = (name: string, a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b) && changes.push(`- ${name}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
  if (cap.fields.includes('title')) field('title', was.title, draft.title)
  if (cap.fields.includes('kind')) field('kind', was.kind, draft.kind)
  if (cap.fields.includes('sources')) field('sources', was.sources, draft.sources)
  if (cap.fields.includes('links')) field('links', was.links, draft.links)
  if (cap.fields.includes('project')) field('project', was.project, draft.project || null)
  const bodyChanged = draft.body.trim() !== record.body.trim()
  const head = [
    `Edit this TDT brain record using ${cap.via ?? 'TDT’s sanctioned edit operation'}. Show me TDT's preview and wait for my confirmation before applying.`,
    '',
    `Record: ${record.ref.kind} ${record.ref.path}${record.ref.id ? ` (id ${record.ref.id})` : ''}, revision ${record.revision.slice(0, 12)}.`,
    changes.length ? `Field changes:\n${changes.join('\n')}` : 'No field changes.',
  ].join('\n')
  if (!bodyChanged) return `${head}\nBody unchanged.`
  const room = HANDOFF_LIMIT - head.length - 80
  const body = draft.body.length > room ? `${draft.body.slice(0, room)}\n… (truncated: ask me for the rest)` : draft.body
  return `${head}\nProposed body:\n<<<\n${body}\n>>>`
}

/** Prompt that starts TDT's review flow for a candidate (approve/reject/edit stay with the user). */
export function reviewHandoffPrompt(record: BrainRecord) {
  return `/tdt-review-brain ${record.ref.path}`
}

function draftFromRecord(r: BrainRecord): RecordDraft {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  return { body: r.body, title: r.ref.title, kind: (r.frontmatter.kind as NoteKind) ?? 'fact', sources: list(r.frontmatter.sources), links: list(r.frontmatter.links), project: (r.frontmatter.project as string | null) ?? null }
}
