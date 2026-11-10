import { Badge, Button, Icon, Meter, Panel, RadialGauge, StatusDot } from '@helm/ui'
import { cx, initials, relTime } from '../../lib/util'
import { useHelm } from '../../state/store'
import { offline, server, useLoad, type Loaded, type Project, type TdtProjectInspection, type TdtProjectRead, type TdtProjectReferences } from '@helm/client'
import { MarkdownView } from '../../components/markdown/MarkdownView'
import { splitFrontmatter } from '../../services/records'
import s from './ProjectView.module.css'

const { concepts, notes, people, priorityTone, statusTone, tasks } = offline

export function ProjectView({ projectId }: { projectId: string }) {
  const { state, projects, actions } = useHelm()
  const p = projects.find((x) => x.id === projectId)

  if (!p) {
    return (
      <div className={s.missing}>
        <p>This project isn't registered in the current workspace.</p>
        <Button onClick={() => actions.closeTab(`project:${projectId}`)}>Close tab</Button>
      </div>
    )
  }
  if (p.path) return <LiveProjectView p={p} />

  // Offline: the prototype's sample project.
  const pTasks = tasks.filter((t) => t.projectId === p.id)
  const open = pTasks.filter((t) => !state.doneTasks[t.id])
  const pNotes = notes.filter((n) => n.projectIds.includes(p.id)).sort((a, b) => b.updated - a.updated)
  const team = people.filter((x) => p.teamIds.includes(x.id))
  const pConcepts = concepts.filter((c) => pNotes.some((n) => n.conceptIds.includes(c.id)))
  const pChats = Object.values(state.chats).filter((c) => c.projectId === p.id).sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className={s.scroll}>
      <header className={s.hero}>
        <div className={s.heroCode}>{p.code}</div>
        <div className={s.heroMain}>
          <span className="hud-label">Project · {p.id.toUpperCase()}</span>
          <h1 className={s.name}>{p.name}</h1>
          <p className={s.desc}>{p.description}</p>
          <div className={s.tags}>
            <Badge tone={statusTone[p.status]}>
              <StatusDot tone={statusTone[p.status]} pulse={p.status === 'at-risk'} /> {p.status}
            </Badge>
            {p.stack.map((t) => (
              <Badge key={t} tone="neutral">{t}</Badge>
            ))}
          </div>
        </div>
        <div className={s.heroActions}>
          <Button variant="primary" icon="chat" onClick={() => actions.startChat(`Give me a status update on ${p.name}`, p.id)}>
            Ask about {p.name}
          </Button>
          <Button icon="brain" onClick={() => actions.openGraph(p.name)}>
            Show in brain
          </Button>
        </div>
      </header>

      <div className={s.grid}>
        <Panel title="Vitals" code="P-01" className={s.vitals}>
          <div className={s.vitalsBody}>
            <RadialGauge value={p.health} size={110} label="HEALTH" tone={p.health > 80 ? 'cyan' : 'amber'} />
            <div className={s.vitalStats}>
              <div>
                <div className={s.statRow}>
                  <span>Progress</span>
                  <span className="mono">{p.progress}%</span>
                </div>
                <Meter value={p.progress} tone="cyan" />
              </div>
              <div className={s.statNums}>
                <span><b>{open.length}</b> open tasks</span>
                <span><b>{pNotes.length}</b> notes</span>
                <span><b>{team.length}</b> people</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Team" code="P-02">
          {team.length === 0 && <p className={s.muted}>No one assigned yet.</p>}
          <ul className={s.team}>
            {team.map((m) => (
              <li key={m.id}>
                <span className={cx(s.avatar, m.id === p.ownerId && s.owner)}>{initials(m.name)}</span>
                <span className={s.personText}>
                  <span className={s.personName}>{m.name}</span>
                  <span className={s.personRole}>{m.role}</span>
                </span>
                {m.id === p.ownerId && <Badge tone="amber">Lead</Badge>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Tasks" code="P-03" className={s.span2}>
          {pTasks.length === 0 && <p className={s.muted}>No tasks yet.</p>}
          <ul className={s.tasks}>
            {pTasks.map((t) => {
              const done = !!state.doneTasks[t.id]
              return (
                <li key={t.id} className={cx(done && s.done)}>
                  <button className={s.check} onClick={() => actions.toggleTask(t.id)} aria-label={done ? 'Mark not done' : 'Mark done'}>
                    {done && <Icon name="check" size={12} stroke={2.4} />}
                  </button>
                  <span className={s.taskTitle}>{t.title}</span>
                  <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
                  <span className="mono">{t.estimate}</span>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel title="Knowledge" code="P-04" className={s.span2}>
          <div className={s.concepts}>
            {pConcepts.map((c) => (
              <button key={c.id} onClick={() => actions.openGraph(c.name)}>
                <Badge tone="violet">{c.name}</Badge>
              </button>
            ))}
          </div>
          <ul className={s.notes}>
            {pNotes.map((n) => (
              <li key={n.id}>
                <button onClick={() => actions.openGraph(n.title)}>
                  <Icon name={n.kind === 'doc' ? 'doc' : 'note'} size={14} />
                  <span className={s.noteTitle}>{n.title}</span>
                  <span className={s.noteExcerpt}>{n.excerpt}</span>
                  <span className={s.noteTime}>{relTime(n.updated)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Sessions" code="P-05" className={s.span2}>
          {pChats.length === 0 && <p className={s.muted}>No sessions about this project yet.</p>}
          <ul className={s.notes}>
            {pChats.map((c) => (
              <li key={c.id}>
                <button onClick={() => actions.openChat(c)}>
                  <Icon name="chat" size={14} />
                  <span className={s.noteTitle}>{c.title}</span>
                  <span className={s.noteExcerpt}>{c.messages.length} messages</span>
                  <span className={s.noteTime}>{relTime(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

const availabilityTone = { available: 'green', 'missing or moved': 'amber', archived: 'neutral' } as const

/** A registered TDT project: registration, source inspection and brain references (all read-only). */
function LiveProjectView({ p }: { p: Project }) {
  const { ws, actions } = useHelm()
  const key = `${ws.id}:${p.id}`
  const read = useLoad(`read:${key}`, () => server.tdt<TdtProjectRead>(ws.id, 'tdt_project_read', { reference: p.id }))
  // TDT refuses inspection of missing/archived locations.
  const inspect = useLoad(p.availability === 'available' ? `inspect:${key}` : undefined, () =>
    server.tdt<TdtProjectInspection>(ws.id, 'tdt_project_inspect', { id: p.id }))
  const refs = useLoad(`refs:${key}`, () => server.tdt<TdtProjectReferences>(ws.id, 'tdt_project_references', { id: p.id, limit: 50 }))
  const tone = availabilityTone[p.availability!]
  const registration = read.data?.registration
  const reg = registration ? splitFrontmatter(registration.markdown) : undefined

  return (
    <div className={s.scroll}>
      <header className={s.hero}>
        <div className={s.heroCode}>{p.code}</div>
        <div className={s.heroMain}>
          <span className="hud-label">Project · {p.id.slice(0, 12).toUpperCase()}</span>
          <h1 className={s.name}>{p.name}</h1>
          <p className={cx(s.desc, 'mono')}>{p.path}</p>
          <div className={s.tags}>
            <Badge tone={tone}>
              <StatusDot tone={tone} pulse={p.availability === 'missing or moved'} /> {p.availability}
            </Badge>
            {read.data && <Badge tone="neutral">registered {new Date(read.data.project.created).toLocaleDateString('en-GB')}</Badge>}
            {read.data?.project.status === 'archived' && <Badge tone="neutral">archived</Badge>}
          </div>
        </div>
        <div className={s.heroActions}>
          <Button variant="primary" icon="chat" onClick={() => actions.startChat(`Give me a status update on ${p.name}`, p.id)}>
            Ask about {p.name}
          </Button>
          <Button icon="brain" onClick={() => actions.openGraph(p.name)}>
            Show in brain
          </Button>
        </div>
      </header>

      <div className={s.grid}>
        <Panel title="Registration" code="P-01" className={s.span2}>
          <LoadNote load={read} />
          {read.data && !registration && <p className={s.muted}>The registration note is missing from the brain.</p>}
          {reg && (
            <>
              <p className={s.muted}>
                <span className="mono">{registration!.path}</span> · {String(reg.frontmatter.status ?? '')}
              </p>
              <MarkdownView markdown={reg.body} />
            </>
          )}
        </Panel>

        <Panel title="Source" code="P-02">
          {p.availability !== 'available' && <p className={s.muted}>Source is {p.availability}; TDT does not inspect it.</p>}
          <LoadNote load={inspect} />
          {inspect.data && (
            <>
              <div className={s.tags}>
                {inspect.data.top_level.map((name) => (
                  <Badge key={name} tone="neutral">{name}</Badge>
                ))}
              </div>
              {inspect.data.inventory_truncated && <p className={s.muted}>Listing truncated by TDT.</p>}
            </>
          )}
        </Panel>

        <Panel title="Brain references" code="P-03">
          <LoadNote load={refs} />
          {refs.data && (
            <>
              <p className={s.muted}>
                {refs.data.references_total} references{refs.data.skipped_total ? ` · ${refs.data.skipped_total} skipped` : ''}
                {refs.data.scan_truncated ? ' · scan truncated' : ''}
              </p>
              <ul className={s.refs}>
                {refs.data.items.map((r) => (
                  <li key={r.path}>
                    <Icon name="note" size={14} />
                    <span className={cx(s.noteTitle, 'mono')} title={r.path}>{r.path.split('/').pop()}</span>
                    {'matched' in r && <span className={s.noteExcerpt}>{r.matched.length} matches</span>}
                  </li>
                ))}
              </ul>
              {refs.data.next_cursor && <p className={s.muted}>Showing the first {refs.data.items.length}.</p>}
            </>
          )}
        </Panel>

        <Panel title="Documents" code="P-04" className={s.span2}>
          {p.availability !== 'available' && <p className={s.muted}>No documents: the source location is {p.availability}.</p>}
          {inspect.data && (
            <>
              <p className={s.muted}>{inspect.data.notice}</p>
              {inspect.data.documents.filter((d) => d.text).length === 0 && <p className={s.muted}>No readable documents.</p>}
              {inspect.data.documents
                .filter((d) => d.text)
                .map((d) => (
                  <details key={d.source} className={s.doc}>
                    <summary>
                      <Icon name="doc" size={14} /> <span className="mono">{d.source.split(/[\\/]/).pop()}</span>
                      {d.truncated && <Badge tone="neutral">truncated</Badge>}
                    </summary>
                    {/* untrusted source text: shown as plain text, never interpreted */}
                    <pre className={s.docText}>{d.text}</pre>
                  </details>
                ))}
            </>
          )}
          {!inspect.data && <LoadNote load={inspect} />}
        </Panel>
      </div>
    </div>
  )
}

/** Loading, or a TDT error with a retry when TDT says retrying is safe. */
function LoadNote<T>({ load }: { load: Loaded<T> }) {
  if (load.loading && !load.data) return <p className={s.muted}>Loading…</p>
  if (!load.error) return null
  return (
    <div className={s.error} role="alert">
      <span>{load.error.message}</span>
      {(load.error.retry === 'safe' || load.error.retry === 'reread') && (
        <Button size="sm" variant="ghost" icon="reset" onClick={load.reload}>Retry</Button>
      )}
    </div>
  )
}
