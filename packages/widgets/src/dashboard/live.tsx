// Live versions of the built-in widgets: TDT data through the Helm server.
// The registry shows these when a server answers and the sample versions otherwise.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, Icon, Meter, RadialGauge, StatusDot, color, cx, relTime, type IconName, type Tone } from '@helm/ui'
import {
  server,
  TdtError,
  useServer,
  useTdt,
  type AgentSession,
  type Loaded,
  type Page,
  type Project,
  type TdtAudit,
  type TdtCaptureRequest,
  type TdtProject,
  type TdtProjectReferences,
  type TdtRelay,
  type TdtReminder,
  type TdtSkillProposal,
  type TdtStack,
  type TdtStoredSummary,
  type TdtUiSession,
  type TdtWorkspaceStatus,
} from '@helm/client'
import { useWidgetHost } from '../host'
import s from './widgets.module.css'

/* ── shared data and states ──────────────────────────── */
const useStatus = (ws: string) => useTdt<TdtWorkspaceStatus>(ws, 'tdt_workspace_status')
const useAudit = (ws: string | undefined, section: 'findings' | 'notes' = 'findings', limit = 1) =>
  useTdt<TdtAudit>(ws, 'tdt_brain_audit', { section, limit })
const useWsSessions = (ws: string) => useServer().sessions.filter((x) => x.workspaceId === ws)
const isLive = (x: AgentSession) => x.status === 'running' || x.status === 'starting' || x.status === 'waiting'

/** Loading, or an error with Retry; renders nothing once data is in. */
function LoadState({ loads }: { loads: Loaded<unknown>[] }) {
  const failed = loads.find((l) => l.error)
  if (failed)
    return (
      <div className={s.loadError} role="alert">
        <span>{failed.error!.message}</span>
        {failed.error!.retry !== 'inspect_outcome' && (
          <button className={s.retry} onClick={() => loads.forEach((l) => l.error && l.reload())}>Retry</button>
        )}
      </div>
    )
  if (loads.some((l) => l.loading && l.data === undefined)) return <p className={s.muted}>Loading…</p>
  return null
}

const ready = (...loads: Loaded<unknown>[]) => loads.every((l) => l.data !== undefined)
const ts = (iso?: string | null) => (iso ? Date.parse(iso) : NaN)

/* ── Telemetry ───────────────────────────────────────── */
export function LiveKpiWidget() {
  const { wsId } = useWidgetHost()
  const status = useStatus(wsId)
  const audit = useAudit(wsId)
  const sessions = useWsSessions(wsId)
  if (!ready(status, audit)) return <LoadState loads={[status, audit]} />
  const st = status.data!
  const kpis = [
    { label: 'Active projects', value: st.projects_available, delta: `${st.projects_total} registered`, tone: 'cyan' as const },
    { label: 'Pending reviews', value: st.pending_candidates, delta: `${st.incomplete_captures} incomplete captures`, tone: 'amber' as const },
    { label: 'Sessions', value: sessions.length, delta: `${sessions.filter(isLive).length} live`, tone: 'violet' as const },
    { label: 'Brain notes', value: audit.data!.notes_total, delta: `${st.due_reminders} due reminders`, tone: 'green' as const },
  ]
  return (
    <div className={s.kpis}>
      {kpis.map((k) => (
        <div key={k.label} className={s.kpi} data-tone={k.tone}>
          <span className="hud-label">{k.label}</span>
          <span className={s.kpiValue}>{k.value.toString().padStart(2, '0')}</span>
          <span className={s.kpiDelta}>{k.delta}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Workspace health ────────────────────────────────── */
export function LiveHealthWidget() {
  const { wsId } = useWidgetHost()
  const status = useStatus(wsId)
  if (!ready(status)) return <LoadState loads={[status]} />
  const st = status.data!
  const pct = st.projects_total ? Math.round((st.projects_available / st.projects_total) * 100) : 100
  const recovery = st.recovery_markers.length
  const rows: { label: string; value: number; tone: Tone }[] = [
    { label: 'Pending candidates', value: st.pending_candidates, tone: st.pending_candidates ? 'amber' : 'green' },
    { label: 'Incomplete captures', value: st.incomplete_captures, tone: st.incomplete_captures ? 'amber' : 'green' },
    { label: 'Due reminders', value: st.due_reminders, tone: st.due_reminders ? 'amber' : 'green' },
    { label: 'Missing projects', value: st.projects_missing, tone: st.projects_missing ? 'amber' : 'green' },
  ]
  return (
    <div className={s.health}>
      <div className={s.healthTop}>
        <RadialGauge value={pct} size={116} label="PROJECTS" tone={pct === 100 ? 'cyan' : 'amber'} />
        <div className={s.healthTrend}>
          <span className="hud-label">Projects available</span>
          <span className="mono">{st.projects_available} / {st.projects_total}</span>
          <span className={s.healthNote}>
            {recovery ? (
              <><StatusDot tone="red" pulse /> {recovery} recovery marker{recovery > 1 ? 's' : ''}: run tdt doctor</>
            ) : (
              <><StatusDot tone="green" /> No interrupted operations</>
            )}
          </span>
        </div>
      </div>
      <ul className={s.metrics}>
        <li>
          <div className={s.metricRow}>
            <span>Projects available</span>
            <span className="mono">{pct}%</span>
          </div>
          <Meter value={pct} tone={pct === 100 ? 'cyan' : 'amber'} />
        </li>
        {rows.map((r) => (
          <li key={r.label}>
            <div className={s.metricRow}>
              <span><StatusDot tone={r.tone} /> {r.label}</span>
              <span className="mono">{r.value}</span>
            </div>
          </li>
        ))}
      </ul>
      <span className={s.observed}>Observed {relTime(ts(st.observed_at))} ago</span>
    </div>
  )
}

/* ── Activity ────────────────────────────────────────── */
export function LiveActivityWidget() {
  const { wsId, projects } = useWidgetHost()
  const captures = useTdt<Page<TdtCaptureRequest>>(wsId, 'tdt_capture_requests', { status: 'all', limit: 50 })
  const reminders = useTdt<Page<TdtReminder>>(wsId, 'tdt_reminder_list', { status: 'all', limit: 50 })
  const list = useMemo(() => {
    const now = Date.now()
    const items: { id: string; at: number; text: string; tone: Tone }[] = []
    for (const c of captures.data?.items ?? []) {
      items.push({ id: `c-${c.id}`, at: ts(c.created), text: 'Capture requested', tone: 'violet' })
      if (c.completed) items.push({ id: `cc-${c.id}`, at: ts(c.completed), text: `Capture ${c.status}`, tone: c.status === 'captured' ? 'green' : 'neutral' })
    }
    for (const r of reminders.data?.items ?? [])
      if (ts(r.due_at) <= now) items.push({ id: `r-${r.id}`, at: ts(r.due_at), text: `Reminder due: ${r.title}`, tone: r.status === 'pending' ? 'amber' : 'neutral' })
    for (const p of projects) if (p.created) items.push({ id: `p-${p.id}`, at: ts(p.created), text: `Project registered: ${p.name}`, tone: 'cyan' })
    return items.filter((i) => !Number.isNaN(i.at)).sort((a, b) => b.at - a.at).slice(0, 14)
  }, [captures.data, reminders.data, projects])
  if (!ready(captures, reminders)) return <LoadState loads={[captures, reminders]} />
  if (!list.length) return <p className={s.muted}>No recorded activity yet.</p>
  return (
    <ul className={s.timeline}>
      {list.map((a) => (
        <li key={a.id} className={s.tlItem}>
          <StatusDot tone={a.tone} />
          <span className={s.tlText}>{a.text}</span>
          <span className={s.tlTime}>{relTime(a.at)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Calendar (reminders by due date) ────────────────── */
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function LiveCalendarWidget() {
  const { wsId } = useWidgetHost()
  const reminders = useTdt<Page<TdtReminder>>(wsId, 'tdt_reminder_list', { limit: 50 })
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(today)
  const byDay = useMemo(() => {
    const m = new Map<string, TdtReminder[]>()
    for (const r of reminders.data?.items ?? []) {
      const k = dayKey(new Date(r.due_at))
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }, [reminders.data])

  const lead = (month.getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - lead + 1
    return day >= 1 && day <= daysInMonth ? new Date(month.getFullYear(), month.getMonth(), day) : null
  })
  const agenda = (byDay.get(dayKey(selected)) ?? []).sort((a, b) => ts(a.due_at) - ts(b.due_at))

  return (
    <div className={s.calendar}>
      <div className={s.calHead}>
        <button className={s.calNav} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <Icon name="chevL" size={14} />
        </button>
        <span className={s.calMonth}>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <button className={s.calNav} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <Icon name="chevR" size={14} />
        </button>
      </div>
      <div className={s.calGrid}>
        {DOW.map((d, i) => (
          <span key={i} className={s.calDow}>{d}</span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={i}
              className={cx(s.calDay, d.getTime() === today.getTime() && s.today, d.getTime() === selected.getTime() && s.selected)}
              onClick={() => setSelected(d)}
            >
              {d.getDate()}
              {byDay.has(dayKey(d)) && <span className={s.calDot} />}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
      <div className={s.agenda}>
        <span className="hud-label">
          {selected.getTime() === today.getTime() ? 'Today' : selected.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {agenda.length} reminders
        </span>
        <LoadState loads={[reminders]} />
        {reminders.data && agenda.length === 0 && <p className={s.muted}>No reminders due this day.</p>}
        {agenda.map((r) => (
          <div key={r.id} className={s.event} data-tone={ts(r.due_at) < Date.now() ? 'red' : 'cyan'}>
            <span className={s.eventTime}>{new Date(r.due_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className={s.eventTitle}>{r.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Project spotlight ───────────────────────────────── */
const availabilityTone = { available: 'green', 'missing or moved': 'amber', archived: 'neutral' } as const

export function LiveProjectSpotlightWidget({ projectId }: { projectId?: string }) {
  const { wsId, projects, openProject, startChat } = useWidgetHost()
  const p: Project | undefined = projects.find((x) => x.id === projectId) ?? projects[0]
  const refs = useTdt<TdtProjectReferences>(p ? wsId : undefined, 'tdt_project_references', { id: p?.id, limit: 1 })
  if (!p) return <p className={s.muted}>No projects to show. The left rail says why (none registered, or TDT unavailable).</p>
  const availability = (p.availability ?? 'available') as TdtProject['availability']
  return (
    <div className={s.spotlight}>
      <div className={s.spotHead}>
        <span className={s.spotCode}>{p.code}</span>
        <div className={s.spotTitle}>
          <span className={s.spotName}>{p.name}</span>
          <Badge tone={availabilityTone[availability]}>{availability}</Badge>
        </div>
      </div>
      <p className={cx(s.spotDesc, 'mono')}>{p.path}</p>
      <div className={s.spotBody}>
        <div className={s.spotStats}>
          <div className={s.spotNums}>
            <span><b>{refs.data ? refs.data.references_total : '–'}</b> references</span>
          </div>
        </div>
      </div>
      <div className={s.spotActions}>
        <Button size="sm" variant="primary" icon="folder" onClick={() => openProject(p)}>Open</Button>
        <Button size="sm" icon="chat" onClick={() => startChat(`Give me a status update on ${p.name}`, p.id)}>Ask</Button>
      </div>
    </div>
  )
}

/* ── Notes (scratchpad) and documents (approved knowledge) ── */
export function LiveNotesWidget({ show = 'all', tag, limit = 12 }: { show?: 'all' | 'note' | 'doc'; tag?: string; limit?: number }) {
  const { wsId, handoff, openRecord, openGraph } = useWidgetHost()
  const notes = useTdt<Page<TdtStoredSummary>>(show === 'doc' ? undefined : wsId, 'tdt_note_list', { limit: 50 })
  const docs = useAudit(show === 'note' ? undefined : wsId, 'notes', 50)
  const [draft, setDraft] = useState('')
  const needle = tag?.trim().toLowerCase().replace(/^#/, '')
  const items = [
    ...(notes.data?.items ?? [])
      .filter((n) => !needle || n.tags.some((t) => t.toLowerCase() === needle))
      .map((n) => ({ key: n.path, kind: 'note' as const, title: n.title, detail: n.tags.map((t) => `#${t}`).join(' '), open: () => openRecord({ kind: 'scratchpad', path: n.path, id: n.id, title: n.title }) })),
    ...(needle ? [] : (docs.data?.items ?? []).map((d) => ({ key: d.path, kind: 'doc' as const, title: d.title ?? d.path, detail: d.path, open: () => openGraph(d.title) }))),
  ].slice(0, limit)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    handoff(`/tdt-note ${draft.trim()}`)
    setDraft('')
  }

  return (
    <div className={s.notes}>
      <form onSubmit={submit} className={s.capture}>
        <Icon name="plus" size={14} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Capture a thought… hands off to /tdt-note" aria-label="Capture a note" />
        <span className={s.kbd}>↵</span>
      </form>
      <LoadState loads={[notes, docs].filter((_, i) => (i === 0 ? show !== 'doc' : show !== 'note'))} />
      {(notes.data || docs.data) && items.length === 0 && <p className={s.muted}>{needle ? `No notes tagged #${needle}.` : 'No notes yet.'}</p>}
      <div className={s.noteGrid}>
        {items.map((n) => (
          <button key={n.key} className={s.note} data-kind={n.kind} onClick={n.open}>
            <span className={s.noteHead}>
              <Icon name={n.kind === 'doc' ? 'doc' : 'note'} size={13} />
              <span className={s.noteKind}>{n.kind === 'doc' ? 'knowledge' : 'scratchpad'}</span>
            </span>
            <span className={s.noteTitle}>{n.title}</span>
            <span className={s.noteExcerpt}>{n.detail}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Brain radar (counts until the whole-brain graph tool, task 011) ── */
const radarKinds: { key: 'knowledge' | 'candidates' | 'scratchpad' | 'findings'; label: string; color: string; ring: number }[] = [
  { key: 'knowledge', label: 'Knowledge', color: color.cyan, ring: 0.32 },
  { key: 'candidates', label: 'Candidates', color: color.amber, ring: 0.55 },
  { key: 'scratchpad', label: 'Scratchpad', color: color.green, ring: 0.72 },
  { key: 'findings', label: 'Audit findings', color: color.red, ring: 0.88 },
]

function hash(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

export function LiveBrainRadarWidget() {
  const { wsId, openGraph } = useWidgetHost()
  const status = useStatus(wsId)
  const audit = useAudit(wsId)
  const notes = useTdt<Page<TdtStoredSummary>>(wsId, 'tdt_note_list', { limit: 50 })
  if (!ready(status, audit, notes)) return <LoadState loads={[status, audit, notes]} />
  const scratch = notes.data!.items.length
  const counts = {
    knowledge: audit.data!.notes_total,
    candidates: status.data!.pending_candidates,
    scratchpad: scratch,
    findings: audit.data!.findings_total,
  }
  const label = (k: keyof typeof counts) => (k === 'scratchpad' && notes.data!.next_cursor ? `${scratch}+` : String(counts[k]))
  return (
    <div className={s.radar}>
      <div className={s.radarScope}>
        <svg viewBox="-100 -100 200 200" width="100%" height="100%" role="img" aria-label="Brain counts by kind">
          {radarKinds.map((k) => (
            <circle key={k.key} r={k.ring * 96} fill="none" style={{ stroke: 'var(--c-line-strong)', strokeDasharray: k.ring === 0.88 ? 'none' : '2 4' }} />
          ))}
          <line x1="-96" y1="0" x2="96" y2="0" style={{ stroke: 'var(--c-line)' }} />
          <line x1="0" y1="-96" x2="0" y2="96" style={{ stroke: 'var(--c-line)' }} />
          <g className={s.radarSweep}>
            <path d="M0 0 L96 0 A96 96 0 0 0 83.1 -48 Z" style={{ fill: 'var(--c-cyan)', fillOpacity: 0.14 }} />
            <line x1="0" y1="0" x2="96" y2="0" style={{ stroke: 'var(--c-cyan)', strokeWidth: 1.2 }} />
          </g>
          {/* one blip per item, capped; positions are decorative, counts are real */}
          {radarKinds.flatMap((k) =>
            Array.from({ length: Math.min(counts[k.key], 40) }, (_, i) => {
              const a = hash(`${k.key}${i}`) * Math.PI * 2
              const rr = k.ring * 96 + (hash(`${k.key}${i}r`) - 0.5) * 10
              return (
                <circle key={`${k.key}${i}`} cx={Math.cos(a) * rr} cy={Math.sin(a) * rr} r={2} className={s.radarBlip}
                  style={{ fill: k.color, animationDelay: `${(a / (Math.PI * 2)) * -4}s` }} />
              )
            }),
          )}
          <circle r="3" style={{ fill: 'var(--c-cyan)' }} />
        </svg>
      </div>
      <div className={s.radarSide}>
        <ul className={s.radarLegend}>
          {radarKinds.map((k) => (
            <li key={k.key}>
              <span className={s.radarSwatch} style={{ background: k.color }} />
              {k.label}
              <b>{label(k.key)}</b>
            </li>
          ))}
        </ul>
        <span className={s.radarLinks}>Counts · graph view pending</span>
        <Button size="sm" icon="brain" onClick={() => openGraph()}>Open brain</Button>
      </div>
    </div>
  )
}

/* ── Agent runs (live Helm sessions + pending captures) ── */
export function LiveAgentRunsWidget() {
  const { wsId, openSession } = useWidgetHost()
  const live = useWsSessions(wsId).filter(isLive)
  const captures = useTdt<Page<TdtCaptureRequest>>(wsId, 'tdt_capture_requests', { limit: 10 })
  const pending = captures.data?.items ?? []
  return (
    <div>
      {!live.length && captures.data && !pending.length && <p className={s.muted}>No agents running in this workspace.</p>}
      <ul className={s.runList}>
        {live.map((r) => (
          <li key={r.id}>
            <button className={s.runItem} onClick={() => openSession(r.id, r.title)}>
              <div className={s.runTop}>
                <StatusDot tone={r.status === 'waiting' ? 'amber' : 'cyan'} pulse />
                <span className={s.runTitle}>{r.title}</span>
                <span className={s.runPct}>{r.status.toUpperCase()}</span>
              </div>
              <span className={s.runMeta}>{r.host === 'codex' ? 'Codex' : 'Claude Code'} · started {relTime(r.startedAt)} ago</span>
            </button>
          </li>
        ))}
        {pending.map((c) => (
          <li key={c.id} className={s.runItem}>
            <div className={s.runTop}>
              <StatusDot tone="violet" />
              <span className={s.runTitle}>Knowledge capture</span>
              <span className={s.runPct}>REQUESTED</span>
            </div>
            <span className={s.runMeta}>Waiting for the host since {relTime(ts(c.created))} ago</span>
          </li>
        ))}
      </ul>
      <LoadState loads={[captures]} />
    </div>
  )
}

/* ── Recent sessions (Helm's persisted sessions) ─────── */
export function LiveSessionsWidget() {
  const { wsId, openSession, startChat } = useWidgetHost()
  const list = [...useWsSessions(wsId)].sort((a, b) => b.startedAt - a.startedAt).slice(0, 6)
  return (
    <div className={s.sessions}>
      {list.length === 0 && <p className={s.muted}>No sessions yet. Hand off a chat or build a task.</p>}
      <ul>
        {list.map((x) => (
          <li key={x.id}>
            <button className={s.sessionRow} onClick={() => openSession(x.id, x.title)}>
              <Icon name={x.kind === 'build' ? 'bolt' : 'chat'} size={14} />
              <span className={s.sessionText}>
                <span className={s.sessionTitle}>{x.title}</span>
                <span className={s.sessionPreview}>{x.prompt}</span>
              </span>
              <Badge tone={isLive(x) ? 'amber' : x.status === 'failed' ? 'red' : 'cyan'}>{x.status}</Badge>
              <span className={s.sessionTime}>{relTime(x.startedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button size="sm" icon="plus" onClick={() => startChat()}>
        New session
      </Button>
    </div>
  )
}

/* ── Quick actions (core skill hand-offs) ────────────── */
export function LiveQuickActionsWidget() {
  const { startChat, openGraph, openDesign, openSettings, handoff } = useWidgetHost()
  const items: { icon: IconName; label: string; hint: ReactNode; run: () => void }[] = [
    { icon: 'chat', label: 'New session', hint: 'Start a chat', run: () => startChat() },
    { icon: 'brain', label: 'Open brain', hint: 'Graph & search', run: () => openGraph() },
    { icon: 'check', label: 'Review brain', hint: '/tdt-review-brain', run: () => handoff('/tdt-review-brain') },
    { icon: 'calendar', label: 'Reminders', hint: '/tdt-check-reminders', run: () => handoff('/tdt-check-reminders') },
    { icon: 'layers', label: 'Design system', hint: 'Tokens & parts', run: openDesign },
    { icon: 'cog', label: 'Settings', hint: 'Theme & effects', run: openSettings },
  ]
  return (
    <div className={s.quick}>
      {items.map((it) => (
        <button key={it.label} className={s.quickTile} onClick={it.run}>
          <Icon name={it.icon} size={18} />
          <span className={s.quickLabel}>{it.label}</span>
          <span className={s.quickHint}>{it.hint}</span>
        </button>
      ))}
    </div>
  )
}

/* ── Review queue (pending candidates) ───────────────── */
export function LiveReviewQueueWidget({ limit = 8 }: { limit?: number }) {
  const { wsId, openRecord, handoff } = useWidgetHost()
  const cands = useTdt<Page<TdtStoredSummary>>(wsId, 'tdt_candidate_list', { limit: 50 })
  if (!ready(cands)) return <LoadState loads={[cands]} />
  const all = cands.data!.items
  const total = `${all.length}${cands.data!.next_cursor ? '+' : ''}`
  return (
    <div className={s.sessions}>
      <span className="hud-label">{all.length ? `${total} pending candidate${all.length > 1 ? 's' : ''}` : 'Review queue'}</span>
      {!all.length && <p className={s.muted}>No pending candidates. Captures land here for review.</p>}
      <ul>
        {all.slice(0, limit).map((c) => (
          <li key={c.path}>
            <button className={s.sessionRow} onClick={() => openRecord({ kind: 'candidate', path: c.path, id: c.id, title: c.title })}>
              <Icon name="doc" size={14} />
              <span className={s.sessionText}>
                <span className={s.sessionTitle}>{c.title}</span>
                <span className={s.sessionPreview}>{c.tags.map((t) => `#${t}`).join(' ') || c.path}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {all.length > 0 && (
        <Button size="sm" icon="check" onClick={() => handoff('/tdt-review-brain')}>
          Review all
        </Button>
      )}
    </div>
  )
}

/* ── Relays (cross-project requests; closing stays in chat) ── */
export function LiveRelaysWidget({ projectId, status = 'open', limit = 8 }: { projectId?: string; status?: 'open' | 'all'; limit?: number }) {
  const { wsId } = useWidgetHost()
  const relays = useTdt<Page<TdtRelay>>(wsId, 'tdt_relay_list', { status, limit: 50, ...(projectId ? { project: projectId } : {}) })
  const [open, setOpen] = useState<string>()
  const body = useTdt<TdtRelay & { body: string }>(open ? wsId : undefined, 'tdt_relay_read', { id: open ?? '' })
  if (!ready(relays)) return <LoadState loads={[relays]} />
  const all = relays.data!.items
  const total = `${all.length}${relays.data!.next_cursor ? '+' : ''}`
  return (
    <div className={s.sessions}>
      <span className="hud-label">{all.length ? `${total} ${status === 'open' ? 'open ' : ''}relay${all.length > 1 ? 's' : ''}` : 'Relays'}</span>
      {!all.length && <p className={s.muted}>{status === 'open' ? 'No open relays. Projects ask each other for work here, via /tdt-relay.' : 'No relays yet.'}</p>}
      <ul>
        {all.slice(0, limit).map((r) => (
          <li key={r.id}>
            <button className={s.sessionRow} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? undefined : r.id)}>
              <Icon name="link" size={14} />
              <span className={s.sessionText}>
                <span className={s.sessionTitle}>{r.title}</span>
                <span className={s.sessionPreview}>{r.from_label} → {r.to_label}{status === 'all' ? ` · ${r.status}` : ''}</span>
              </span>
              <span className={s.sessionTime}>{relTime(ts(r.created))}</span>
            </button>
            {open === r.id && (
              <div className={s.relayBody}>
                {body.data ? <p>{body.data.body}</p> : <LoadState loads={[body]} />}
                {r.origin && <span className={s.sessionPreview}>Origin: {r.origin}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Waiting interviews (TDT UI sessions awaiting the user) ── */
export function LiveInterviewsWidget({ limit = 6 }: { limit?: number }) {
  const { wsId } = useWidgetHost()
  const everyday = useServer().workspaces.find((w) => w.id === wsId)?.profile === 'everyday'
  const list = useTdt<Page<TdtUiSession>>(wsId, 'tdt_ui_sessions', { status: 'open', limit: 50 })
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  if (!ready(list)) return <LoadState loads={[list]} />
  const all = list.data!.items
  const waiting = all.filter((x) => x.waiting).length
  async function open(id: string) {
    // A blank tab now, while the click still counts as a user gesture; the URL fills it in.
    // The URL is the session's bearer capability: it goes to that tab only, never into state.
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    setBusy(id)
    setError(undefined)
    try {
      const { url } = await server.openInterview(wsId, id)
      if (tab) tab.location.href = url
      else setError('The browser blocked the new tab. Allow pop-ups for Helm and try again.')
      list.reload()
    } catch (e) {
      tab?.close()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <div className={s.sessions}>
      <span className="hud-label">{all.length ? `${waiting} waiting · ${all.length} open` : 'Interviews'}</span>
      {!all.length && <p className={s.muted}>No open interviews. When an agent asks you questions through TDT’s local UI, they wait here.</p>}
      {!!all.length && !everyday && <p className={s.muted}>Opening an interview needs the everyday TDT profile for this workspace.</p>}
      {error && <p className={s.loadError} role="alert">{error}</p>}
      <ul>
        {all.slice(0, limit).map((x) => (
          <li key={x.session_id} className={s.sessionRow}>
            <StatusDot tone={x.waiting ? 'amber' : x.connected ? 'green' : 'neutral'} pulse={x.waiting} />
            <span className={s.sessionText}>
              <span className={s.sessionTitle}>{x.title ?? 'Untitled interview'}</span>
              <span className={s.sessionPreview}>{x.waiting ? 'Waiting for you' : x.status === 'received' ? 'Answer received' : x.status}{x.connected ? '' : ' · disconnected'}</span>
            </span>
            <span className={s.sessionTime}>{relTime(ts(x.updated))}</span>
            <Button size="sm" variant={x.waiting ? 'primary' : 'ghost'} disabled={!everyday || busy !== undefined} onClick={() => void open(x.session_id)}>
              {busy === x.session_id ? 'Opening…' : 'Open'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Stacks & skills ─────────────────────────────────── */
/** a is newer than b (dotted numeric versions; a pre-release suffix sorts below its release). */
export function newerVersion(a: string, b: string) {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0
  }
  return !x.pre && !!y.pre
}

type UpdateCheck = { latest: string | null } | { error: string } | 'local'

export function LiveStacksWidget() {
  const { wsId } = useWidgetHost()
  const stacks = useTdt<Page<TdtStack>>(wsId, 'tdt_stack_list', { limit: 50 })
  const proposals = useTdt<Page<TdtSkillProposal>>(wsId, 'tdt_skill_proposals', { limit: 50 })
  const [checks, setChecks] = useState<Record<string, UpdateCheck>>({})
  const [checking, setChecking] = useState(false)
  if (!ready(stacks, proposals)) return <LoadState loads={[stacks, proposals]} />

  // Network read, only on click (user decision): one exact marketplace read per installed marketplace stack.
  const check = async () => {
    setChecking(true)
    const out: Record<string, UpdateCheck> = {}
    await Promise.all(
      stacks.data!.items.map(async (st) => {
        if (st.origin.kind !== 'marketplace') return void (out[st.id] = 'local')
        try {
          const read = await server.tdt<{ listing: { latest_version?: string | null } }>(wsId, 'tdt_marketplace_read', {
            id: st.id,
            budget_bytes: 262144,
            ...(typeof st.origin.registry_url === 'string' ? { registry_url: st.origin.registry_url } : {}),
          })
          out[st.id] = { latest: read.listing.latest_version ?? null }
        } catch (e) {
          out[st.id] = e instanceof TdtError && e.code === 'not_found' ? { latest: null } : { error: (e as Error).message }
        }
      }),
    )
    setChecks(out)
    setChecking(false)
  }

  const badge = (st: TdtStack) => {
    const c = checks[st.id]
    if (!c) return null
    if (c === 'local') return <Badge tone="neutral">local source</Badge>
    if ('error' in c) return <span title={c.error}><Badge tone="red">check failed</Badge></span>
    if (!c.latest) return <Badge tone="neutral">not listed</Badge>
    return newerVersion(c.latest, st.version) ? <Badge tone="amber">{c.latest} available</Badge> : <Badge tone="green">up to date</Badge>
  }
  const pending = proposals.data!.items
  return (
    <div className={s.sessions}>
      <span className="hud-label">Installed stacks · {stacks.data!.items.length}</span>
      {!stacks.data!.items.length && <p className={s.muted}>No stacks installed. Core works without any.</p>}
      <ul className={s.runList}>
        {stacks.data!.items.map((st) => (
          <li key={st.id} className={s.runItem}>
            <div className={s.runTop}>
              <span className={s.runTitle}>{st.id}</span>
              {badge(st)}
            </div>
            <span className={s.runMeta}>v{st.version} · {st.origin.kind ?? 'unknown origin'}</span>
          </li>
        ))}
      </ul>
      {stacks.data!.items.length > 0 && (
        <Button size="sm" icon="reset" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
      )}
      <span className="hud-label">Pending skill proposals · {pending.length}{proposals.data!.next_cursor ? '+' : ''}</span>
      {!pending.length && <p className={s.muted}>No pending skill proposals.</p>}
      <ul className={s.runList}>
        {pending.map((pr) => (
          <li key={pr.id} className={s.runItem}>
            <span className={s.runTitle}>{pr.name}</span>
            <span className={s.runMeta}>{pr.description}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
