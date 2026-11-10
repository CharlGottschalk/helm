// TDT brain record reader/editor: Read (rendered Markdown + properties) and Edit
// (frontmatter form + CodeMirror body) with preview → confirm → apply through TDT.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MarkdownEditor } from '../../components/editor/MarkdownEditor'
import { Badge, Button, Icon, StatusDot, useModal } from '@helm/ui'
import { MarkdownView } from '../../components/markdown/MarkdownView'
import type { Tone } from '@helm/ui'
import { lineDiff } from '../../lib/diff'
import { cx } from '../../lib/util'
import {
  applyEdit, bodyLinks, editHandoffPrompt, EDIT_CAPABILITIES, NOTE_KINDS, previewEdit, readRecord, refFromLink, reviewHandoffPrompt, validateDraft,
  type BrainRecord, type EditableField, type EditPreview, type NoteKind, type RecordDraft, type RecordRef,
} from '../../services/records'
import { useServer } from '@helm/client'
import { useHelm } from '../../state/store'
import s from './RecordView.module.css'

const kindTone: Record<string, Tone> = { fact: 'cyan', decision: 'violet', question: 'amber', inference: 'blue' }
const statusTone: Record<string, Tone> = { approved: 'green', pending: 'amber', rejected: 'red', scratchpad: 'blue' }
const recordLabel: Record<RecordRef['kind'], string> = {
  knowledge: 'Approved knowledge', candidate: 'Pending candidate', scratchpad: 'Scratchpad note', project: 'Project registration', index: 'Brain index',
}

const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

function draftFrom(r: BrainRecord): RecordDraft {
  return {
    body: r.body,
    title: String(r.frontmatter.title ?? r.ref.title),
    kind: (r.frontmatter.kind as NoteKind) ?? 'fact',
    sources: asList(r.frontmatter.sources),
    links: asList(r.frontmatter.links),
    project: (r.frontmatter.project as string | null) ?? null,
  }
}

export function RecordView({ refJson }: { refJson: string }) {
  const { ws, actions } = useHelm()
  const { status: serverStatus } = useServer()
  const ref = useMemo(() => JSON.parse(refJson) as RecordRef, [refJson])
  const [record, setRecord] = useState<BrainRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'read' | 'edit'>('read')
  const [draft, setDraft] = useState<RecordDraft | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await readRecord(ws.id, ref)
      setRecord(r)
      setDraft(draftFrom(r))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [ws.id, ref])

  useEffect(() => {
    void load()
  }, [load, serverStatus])

  const openRecord = (r: RecordRef) => actions.openRecord(r)

  if (error) {
    return (
      <div className={s.center}>
        <Icon name="doc" size={28} />
        <h2>Couldn't open this record</h2>
        <p>{error}</p>
        <div className={s.row}>
          <Button icon="reset" onClick={load}>Retry</Button>
          <Button variant="subtle" onClick={() => actions.closeTab(`record:${ref.path}`)}>Close tab</Button>
        </div>
      </div>
    )
  }
  if (!record || !draft) return <div className={s.center}><p>Loading record…</p></div>

  const cap = EDIT_CAPABILITIES[record.ref.kind]
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(record))
  const fm = record.frontmatter

  return (
    <div className={s.view}>
      <header className={s.header}>
        <div className={s.titles}>
          <span className="hud-label">{recordLabel[record.ref.kind]} · {record.source === 'mock' ? 'sample data' : 'TDT'}</span>
          <h1 className={s.title}>{record.ref.title}</h1>
          <code className={s.path}>{record.ref.path}</code>
        </div>
        <div className={s.headActions}>
          {typeof fm.kind === 'string' && <Badge tone={kindTone[fm.kind] ?? 'neutral'}>{fm.kind}</Badge>}
          {record.status && (
            <Badge tone={statusTone[record.status] ?? 'neutral'}>
              <StatusDot tone={statusTone[record.status] ?? 'neutral'} /> {record.status}
            </Badge>
          )}
          <div className={s.segmented} role="tablist" aria-label="Record view">
            <button role="tab" aria-selected={tab === 'read'} className={cx(tab === 'read' && s.on)} onClick={() => setTab('read')}>
              <Icon name="doc" size={13} /> Read
            </button>
            <button role="tab" aria-selected={tab === 'edit'} className={cx(tab === 'edit' && s.on)} onClick={() => setTab('edit')}>
              <Icon name="sliders" size={13} /> Edit{dirty ? ' •' : ''}
            </button>
          </div>
          {record.source === 'tdt' && record.ref.kind === 'candidate' && (
            <Button size="sm" variant="ghost" icon="check" onClick={() => actions.handoff(reviewHandoffPrompt(record))} title="Approve, reject or edit through /tdt-review-brain">
              Review
            </Button>
          )}
          <Button size="sm" variant="subtle" icon="brain" onClick={() => actions.openGraph(record.ref.title)} title="Show in brain">Brain</Button>
        </div>
      </header>

      {notice && (
        <div className={s.notice} role="status">
          <Icon name="check" size={14} /> {notice}
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={12} /></button>
        </div>
      )}

      {tab === 'read' ? (
        <ReadPane record={record} onOpenRecord={openRecord} />
      ) : (
        <EditPane
          record={record}
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          onDiscard={() => setDraft(draftFrom(record))}
          onReload={load}
          onSaved={async (message) => {
            await load()
            setTab('read')
            setNotice(message)
          }}
          capReason={cap.reason}
        />
      )}
    </div>
  )
}

/* ── Read ─────────────────────────────────────────────── */

function ReadPane({ record, onOpenRecord }: { record: BrainRecord; onOpenRecord: (r: RecordRef) => void }) {
  const fm = record.frontmatter
  const provenance = (fm.provenance && typeof fm.provenance === 'object' ? fm.provenance : {}) as Record<string, unknown>
  const review = Array.isArray(fm.review) ? (fm.review as Record<string, unknown>[]) : []
  return (
    <div className={s.readGrid}>
      <article className={s.body}>
        <MarkdownView markdown={record.body} onOpenRecord={onOpenRecord} />
      </article>
      <aside className={s.props} aria-label="Properties">
        <Prop label="Kind" value={String(fm.kind ?? '—')} />
        <Prop label="Status" value={record.status || '—'} />
        {fm.project !== undefined && <Prop label="Project" value={fm.project ? <code>{String(fm.project).slice(0, 12)}…</code> : '—'} />}
        <Prop label="Created" value={fmtDate(fm.created)} />
        <Prop label="Updated" value={fmtDate(fm.updated)} />
        <PropList label="Sources" items={asList(fm.sources)} mono />
        <div className={s.prop}>
          <span className="hud-label">Links</span>
          {asList(fm.links).length === 0 && <span className={s.muted}>None</span>}
          <ul className={s.linkList}>
            {asList(fm.links).map((l) => (
              <li key={l}>
                {/* metadata links are brain-relative targets, same as wikilinks */}
                <button onClick={() => onOpenRecord(refFromLink(l))}><Icon name="link" size={11} /> {l}</button>
              </li>
            ))}
          </ul>
        </div>
        {Object.keys(provenance).length > 0 && (
          <div className={s.prop}>
            <span className="hud-label">Provenance</span>
            <dl className={s.kv}>
              {Object.entries(provenance).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
              ))}
            </dl>
          </div>
        )}
        <div className={s.prop}>
          <span className="hud-label">Review history · {review.length}</span>
          {review.length === 0 && <span className={s.muted}>No review decisions yet</span>}
          <ol className={s.timeline}>
            {review.map((r, i) => (
              <li key={i}>
                <strong>{String(r.action ?? r.decision ?? 'event')}</strong>
                <span>{fmtDate(r.at ?? r.created)}</span>
                {r.instruction != null && <em>{String(r.instruction)}</em>}
              </li>
            ))}
          </ol>
        </div>
        {record.frontmatter.id != null && <Prop label="ID" value={<code>{String(record.frontmatter.id)}</code>} />}
      </aside>
    </div>
  )
}

function Prop({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={s.prop}>
      <span className="hud-label">{label}</span>
      <div>{value}</div>
    </div>
  )
}

function PropList({ label, items, mono }: { label: string; items: string[]; mono?: boolean }) {
  return (
    <div className={s.prop}>
      <span className="hud-label">{label}</span>
      {items.length === 0 ? <span className={s.muted}>None</span> : (
        <ul className={s.plain}>{items.map((x) => <li key={x} className={cx(mono && 'mono')}>{x}</li>)}</ul>
      )}
    </div>
  )
}

function fmtDate(v: unknown) {
  if (!v) return '—'
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/* ── Edit ─────────────────────────────────────────────── */

interface EditProps {
  record: BrainRecord
  draft: RecordDraft
  setDraft: (d: RecordDraft) => void
  dirty: boolean
  onDiscard: () => void
  onReload: () => void
  onSaved: (message: string) => void
  capReason: string
}

function EditPane({ record, draft, setDraft, dirty, onDiscard, onReload, onSaved, capReason }: EditProps) {
  const { actions } = useHelm()
  // Live TDT records: Helm doesn't write; the edit is handed to the host agent, which runs TDT's preview/confirm.
  const handsOff = record.source === 'tdt'
  const cap = EDIT_CAPABILITIES[record.ref.kind]
  const [split, setSplit] = useState(true)
  const [preview, setPreview] = useState<EditPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const problems = validateDraft(record, draft)
  const can = (f: EditableField) => cap.fields.includes(f)
  const set = (patch: Partial<RecordDraft>) => setDraft({ ...draft, ...patch })

  if (!cap.body && cap.fields.length === 0) {
    return (
      <div className={s.editLocked}>
        <div className={s.lockNote}><Icon name="target" size={14} /> {capReason}</div>
        <div className={s.rawEditor}>
          <MarkdownEditor value={record.markdown} readOnly ariaLabel="Record source (read only)" />
        </div>
      </div>
    )
  }

  const review = () => {
    setError(null)
    setPreview(previewEdit(record, draft))
  }

  const apply = () => {
    if (!preview) return
    setError(null)
    try {
      applyEdit(record, preview)
      setPreview(null)
      onSaved('Saved to the offline sample data (local only).')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const stale = !!error && /changed|stale|rescan|review again|hash/i.test(error)

  return (
    <div className={s.editGrid}>
      <aside className={s.form} aria-label="Frontmatter">
        <div className={s.formHead}>
          <span className="hud-label">Frontmatter</span>
          {cap.via && <span className={s.via}>via {cap.via}</span>}
        </div>

        <Field label="Title" locked={!can('title')}>
          <input className={s.input} value={draft.title ?? ''} disabled={!can('title')} onChange={(e) => set({ title: e.target.value })} maxLength={160} />
        </Field>

        <Field label="Kind" locked={!can('kind')}>
          <div className={s.chips} role="radiogroup" aria-label="Kind">
            {NOTE_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={draft.kind === k} disabled={!can('kind')}
                className={cx(s.chip, draft.kind === k && s.chipOn)} onClick={() => set({ kind: k })}>
                {k}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Sources" hint="One per line, 1–8" locked={!can('sources')}>
          <textarea className={cx(s.input, s.area)} disabled={!can('sources')} value={(draft.sources ?? []).join('\n')}
            onChange={(e) => set({ sources: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} rows={3} />
        </Field>

        <Field label="Links" hint={record.ref.kind === 'knowledge' ? 'Brain-relative; each must also appear in the body' : 'Brain-relative, one per line'} locked={!can('links')}>
          <textarea className={cx(s.input, s.area)} disabled={!can('links')} value={(draft.links ?? []).join('\n')}
            onChange={(e) => set({ links: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} rows={3} />
          {can('links') && (
            <button type="button" className={s.linkBtn} onClick={() => set({ links: bodyLinks(draft.body) })}>
              <Icon name="link" size={11} /> Use links found in the body ({bodyLinks(draft.body).length})
            </button>
          )}
        </Field>

        {record.frontmatter.project !== undefined && (
          <Field label="Project id" locked={!can('project')}>
            <input className={cx(s.input, 'mono')} value={draft.project ?? ''} disabled={!can('project')} onChange={(e) => set({ project: e.target.value || null })} />
          </Field>
        )}

        <div className={s.protected}>
          <span className="hud-label"><Icon name="target" size={11} /> Managed by TDT</span>
          <p>{capReason}</p>
          <dl className={s.kv}>
            {['id', 'status', 'created', 'updated'].filter((k) => record.frontmatter[k] != null).map((k) => (
              <div key={k}><dt>{k}</dt><dd className="mono">{String(record.frontmatter[k]).slice(0, 24)}</dd></div>
            ))}
          </dl>
        </div>
      </aside>

      <section className={s.bodyEdit} aria-label="Body">
        <div className={s.bodyBar}>
          <span className="hud-label">Body · Markdown</span>
          <label className={s.toggle}>
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Live preview
          </label>
        </div>
        <div className={cx(s.bodyPanes, split && s.split)}>
          <div className={s.editorWrap}>
            <MarkdownEditor value={draft.body} onChange={(body) => set({ body })} readOnly={!cap.body} ariaLabel="Record body" />
          </div>
          {split && (
            <div className={s.livePreview}>
              <MarkdownView markdown={draft.body} />
            </div>
          )}
        </div>
        <footer className={s.footer}>
          <div className={s.problems}>
            {problems.map((p) => <span key={p}><Icon name="bolt" size={11} /> {p}</span>)}
            {error && <span className={s.error}><Icon name="x" size={11} /> {error}{stale && <button onClick={onReload}>Reload record</button>}</span>}
          </div>
          <Button variant="subtle" disabled={!dirty} onClick={onDiscard}>Discard</Button>
          {handsOff ? (
            <Button variant="primary" icon="arrow" disabled={!dirty || problems.length > 0} onClick={() => actions.handoff(editHandoffPrompt(record, draft))}
              title="Helm doesn't write to TDT: the host agent applies this through TDT after you confirm its preview">
              Hand off edit
            </Button>
          ) : (
            <Button variant="primary" icon="check" disabled={!dirty || problems.length > 0} onClick={review}>
              Review changes
            </Button>
          )}
        </footer>
      </section>

      {preview && (
        <ConfirmEdit
          preview={preview}
          error={error}
          onCancel={() => setPreview(null)}
          onApply={apply}
        />
      )}
    </div>
  )
}

function Field({ label, hint, locked, children }: { label: string; hint?: string; locked?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx(s.field, locked && s.fieldLocked)}>
      <span className={s.fieldLabel}>
        {label}
        {locked && <Icon name="target" size={11} />}
      </span>
      {children}
      {hint && !locked && <span className={s.hint}>{hint}</span>}
    </div>
  )
}

/* ── Confirm ──────────────────────────────────────────── */

function ConfirmEdit({ preview, error, onCancel, onApply }: {
  preview: EditPreview
  error: string | null
  onCancel: () => void
  onApply: () => void
}) {
  const diff = useMemo(() => lineDiff(preview.before, preview.after), [preview])
  const added = diff.filter((d) => d.type === 'add').length
  const removed = diff.filter((d) => d.type === 'del').length
  const modal = useModal(onCancel)

  return (
    <dialog className={cx('hud-modal', s.overlay)} aria-labelledby="confirm-edit-title" {...modal}>
      <div className={s.dialog}>
        <header className={s.dialogHead}>
          <h2 id="confirm-edit-title">Review edit</h2>
          <span className={s.counts}><span className={s.plus}>+{added}</span> <span className={s.minus}>−{removed}</span></span>
        </header>
        <p className={s.dialogText}>Offline sample data: this updates the local copy only.</p>
        <pre className={s.diff} aria-label="Changes">
          {diff.map((d, i) => (
            <div key={i} className={cx(s.dl, d.type === 'add' && s.dlAdd, d.type === 'del' && s.dlDel)}>
              <span className={s.sign}>{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>
              {d.text || ' '}
            </div>
          ))}
        </pre>
        {error && <p className={s.error}>{error}</p>}
        <footer className={s.dialogFoot}>
          <Button variant="subtle" onClick={onCancel}>Back to editing</Button>
          <Button variant="primary" icon="check" onClick={onApply}>Apply edit</Button>
        </footer>
      </div>
    </dialog>
  )
}
