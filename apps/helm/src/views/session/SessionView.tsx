// Detail view for an agent session (hand-off chat or orchestrated build).
// "Live chat" is the host's own interactive UI in an embedded workspace terminal.
import { useState } from 'react'
import { Badge, Button, Icon, StatusDot } from '@helm/ui'
import type { Tone } from '@helm/ui'
import { relTime } from '../../lib/util'
import { server, useLoad, useServer, type AgentSession } from '@helm/client'
import { MarkdownView } from '../../components/markdown/MarkdownView'
import { useHelm } from '../../state/store'
import { TerminalPane } from '../terminal/TerminalView'
import s from './SessionView.module.css'

export const sessionTone: Record<AgentSession['status'], Tone> = {
  starting: 'cyan',
  running: 'cyan',
  waiting: 'amber',
  exited: 'green',
  failed: 'red',
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const { status, sessions } = useServer()
  const { actions } = useHelm()
  const session = sessions.find((x) => x.id === sessionId)
  const [live, setLive] = useState(true)

  if (status !== 'online' || !session) {
    return (
      <div className={s.missing}>
        <p>{status !== 'online' ? 'The Helm server is not running, so live sessions are unavailable.' : 'This session is no longer known to the Helm server.'}</p>
        <Button onClick={() => actions.closeTab(`session:${sessionId}`)}>Close tab</Button>
      </div>
    )
  }

  const active = session.status === 'running' || session.status === 'starting' || session.status === 'waiting'
  const host = session.host === 'codex' ? 'Codex' : 'Claude Code'

  return (
    <div className={s.view}>
      <header className={s.header}>
        <div className={s.titles}>
          <span className="hud-label">
            {session.kind === 'build' ? 'Build session' : 'Chat hand-off'} · {host} · {session.id.slice(0, 8)}
          </span>
          <h1 className={s.title}>{session.title}</h1>
        </div>
        <div className={s.meta}>
          <Badge tone={sessionTone[session.status]}>
            <StatusDot tone={sessionTone[session.status]} pulse={active} /> {session.status}
          </Badge>
          <span className={s.stat}>started {relTime(session.startedAt)} ago</span>
          {session.terminalId && (
            <Button size="sm" variant={live ? 'subtle' : 'ghost'} icon="keyboard" onClick={() => setLive((v) => !v)}>
              {live ? 'Hide live chat' : 'Open live chat'}
            </Button>
          )}
        </div>
      </header>

      <div className={s.body}>
        <aside className={s.facts}>
          <Fact label="Prompt" value={<code className={s.code}>{session.prompt}</code>} />
          {session.task && (
            <>
              <Fact label="Task" value={session.task.taskId} />
              <Fact label="Project" value={session.task.projectId} />
            </>
          )}
          <Fact label="Host" value={host} />
          {session.exitCode !== null && <Fact label="Exit code" value={String(session.exitCode)} />}
          <p className={s.note}>
            <Icon name="target" size={12} /> Questions from the agent appear in the live chat. Helm never answers on your behalf.
          </p>
          {session.task && <Handoff session={session} />}
        </aside>
        <section className={s.live}>
          {live && session.terminalId ? (
            <TerminalPane terminalId={session.terminalId} />
          ) : (
            <div className={s.hidden}>{session.terminalId ? 'Live chat hidden.' : 'This session has ended; its terminal is gone.'}</div>
          )}
        </section>
      </div>
    </div>
  )
}

/** The build skill's workspace handoff for this task (read-only); reloads when the session's status changes. */
function Handoff({ session }: { session: AgentSession }) {
  const { projectId, taskId } = session.task!
  const [nonce, setNonce] = useState(0)
  const handoff = useLoad(`${session.id}:${session.status}:${nonce}`, () => server.taskHandoff(session.workspaceId, projectId, taskId))
  return (
    <section className={s.handoff} aria-label="Task handoff">
      <div className={s.handoffHead}>
        <span className="hud-label">Handoff · {taskId}</span>
        <button className={s.reload} onClick={() => setNonce((n) => n + 1)} aria-label="Reload handoff" title="Reload handoff">
          <Icon name="reset" size={12} />
        </button>
      </div>
      {handoff.error && <p className={s.muted}>{handoff.error.message}</p>}
      {handoff.data === null && <p className={s.muted}>No handoff yet. The build skill writes one when it pauses or finishes.</p>}
      {handoff.data && <MarkdownView markdown={handoff.data} />}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={s.fact}>
      <span className="hud-label">{label}</span>
      <div>{value}</div>
    </div>
  )
}
