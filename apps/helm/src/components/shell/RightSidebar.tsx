import { cx, relTime } from '../../lib/util'
import { offline, useServer } from '@helm/client'
import { isStreaming, useChromeTheme, useHelm, type Chat } from '../../state/store'
import { sessionTone } from '../../views/session/SessionView'
import { Badge, Icon, Meter, StatusDot } from '@helm/ui'
import s from './RightSidebar.module.css'

const { useAgentRuns } = offline

export function RightSidebar() {
  const { state, online, tabSet, activeTab, actions } = useHelm()
  const collapsed = state.rightCollapsed
  const chrome = useChromeTheme()
  // Sample background runs exist only offline; online, real runs are the agent sessions.
  const sampleRuns = useAgentRuns(state.wsId)
  const runs = online ? [] : sampleRuns

  const chats = Object.values(state.chats)
    .filter((c) => c.wsId === state.wsId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const openIds = new Set(tabSet.tabs.filter((t) => t.kind === 'chat').map((t) => t.refId))
  const open = chats.filter((c) => openIds.has(c.id))
  const recent = chats.filter((c) => !openIds.has(c.id))
  const activeChatId = activeTab.kind === 'chat' ? activeTab.refId : undefined
  // Real host sessions from the Helm server (hand-offs and builds) for this workspace.
  const { status: serverStatus, sessions } = useServer()
  const target = serverStatus === 'online' ? { id: state.wsId } : undefined
  const agentSessions = target ? sessions.filter((x) => x.workspaceId === target.id) : []
  const liveCount =
    open.filter(isStreaming).length +
    runs.filter((r) => r.status === 'running').length +
    agentSessions.filter((x) => x.status === 'running' || x.status === 'waiting').length

  if (collapsed) {
    return (
      <aside className={cx(s.sidebar, s.collapsed)} aria-label="Sessions" data-theme={chrome}>
        <button className={s.railBtn} onClick={actions.toggleRight} title="Show sessions">
          <Icon name="chevL" size={14} />
        </button>
        <button className={s.railBtn} onClick={() => actions.startChat()} title="New chat">
          <Icon name="plus" size={16} />
        </button>
        <div className={s.railDivider} />
        {open.map((c) => (
          <button key={c.id} className={cx(s.railChat, c.id === activeChatId && s.active)} onClick={() => actions.openChat(c)} title={c.title}>
            <Icon name="chat" size={15} />
            {isStreaming(c) && <span className={s.railLive} />}
          </button>
        ))}
        <div className={s.railCount} title={`${liveCount} live processes`}>
          <span>{liveCount}</span>
          LIVE
        </div>
      </aside>
    )
  }

  return (
    <aside className={s.sidebar} aria-label="Sessions" data-theme={chrome}>
      <header className={s.header}>
        <span className={s.marker} />
        <h2 className={s.title}>Sessions</h2>
        <span className={s.liveBadge}>
          <StatusDot tone="amber" pulse /> {liveCount} live
        </span>
        <button className={s.headerBtn} onClick={actions.toggleRight} title="Collapse sessions">
          <Icon name="chevR" size={14} />
        </button>
      </header>

      <div className={s.scroll}>
        <button className={s.newChat} onClick={() => actions.startChat()}>
          <Icon name="plus" size={14} /> New session
        </button>

        <Section label="Agent sessions" count={agentSessions.length}>
          {serverStatus !== 'online' && (
            <p className={s.empty}>Start the Helm server to hand chats and builds to Claude Code or Codex. Sessions appear here.</p>
          )}
          {serverStatus === 'online' && agentSessions.length === 0 && (
            <p className={s.empty}>No sessions yet. Ask from the floating bar, or Build a task on the Kanban.</p>
          )}
          {agentSessions.map((x) => {
            const live = x.status === 'running' || x.status === 'starting' || x.status === 'waiting'
            return (
              <button
                key={x.id}
                className={cx(s.chat, activeTab.kind === 'session' && activeTab.refId === x.id && s.active)}
                onClick={() => actions.openSession(x.id, x.title)}
              >
                <div className={s.chatTop}>
                  <StatusDot tone={sessionTone[x.status]} pulse={live} />
                  <span className={s.chatTitle}>{x.title}</span>
                  <span className={s.chatTime}>{relTime(x.startedAt)}</span>
                </div>
                <div className={s.chatMeta}>
                  <Badge tone={x.kind === 'build' ? 'amber' : 'cyan'}>{x.kind}</Badge>
                  <span>{x.host === 'codex' ? 'Codex' : 'Claude Code'} · {x.status}</span>
                </div>
              </button>
            )
          })}
        </Section>

        <Section label="Open chats" count={open.length}>
          {open.length === 0 && <p className={s.empty}>No open chats. Start one from the floating bar below the dashboard.</p>}
          {open.map((c) => (
            <ChatRow key={c.id} chat={c} active={c.id === activeChatId} onClick={() => actions.openChat(c)} />
          ))}
        </Section>

        {!online && (
          <Section label="Agent runs" count={runs.length}>
            {runs.map((r) => (
              <div key={r.id} className={s.run}>
                <div className={s.runTop}>
                  <StatusDot tone={r.status === 'running' ? 'cyan' : 'neutral'} pulse={r.status === 'running'} />
                  <span className={s.runTitle}>{r.title}</span>
                  <span className={s.runPct}>{r.status === 'queued' ? 'QUEUED' : `${Math.floor(r.progress)}%`}</span>
                </div>
                <Meter value={r.progress} tone={r.status === 'running' ? 'cyan' : 'neutral'} segments={24} />
              </div>
            ))}
          </Section>
        )}

        <Section label="Recent" count={recent.length}>
          {recent.map((c) => (
            <ChatRow key={c.id} chat={c} onClick={() => actions.openChat(c)} />
          ))}
        </Section>
      </div>

      <footer className={s.footer}>
        <div className={s.telemetryRow}>
          <span>Context window</span>
          <span className={s.telemetryValue}>42.8k / 200k</span>
        </div>
        <Meter value={21} segments={30} />
        <div className={s.telemetryRow}>
          <span>Tokens today</span>
          <span className={s.telemetryValue}>1.24M</span>
        </div>
      </footer>
    </aside>
  )
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionLabel}>
        {label}
        <span className={s.sectionCount}>{count.toString().padStart(2, '0')}</span>
        <span className={s.sectionRule} />
      </div>
      <div className={s.sectionBody}>{children}</div>
    </section>
  )
}

function ChatRow({ chat, active, onClick }: { chat: Chat; active?: boolean; onClick: () => void }) {
  const { projects } = useHelm()
  const project = projects.find((p) => p.id === chat.projectId)
  const live = isStreaming(chat)
  const last = chat.messages[chat.messages.length - 1]
  return (
    <button className={cx(s.chat, active && s.active)} onClick={onClick}>
      <div className={s.chatTop}>
        <StatusDot tone={live ? 'amber' : active ? 'cyan' : 'neutral'} pulse={live} />
        <span className={s.chatTitle}>{chat.title}</span>
        <span className={s.chatTime}>{relTime(chat.updatedAt)}</span>
      </div>
      <div className={s.chatPreview}>{live ? 'Helm is responding…' : last?.text.replace(/[*`#]/g, '') ?? 'Empty session'}</div>
      <div className={s.chatMeta}>
        {project && <Badge tone="cyan">{project.code}</Badge>}
        <span>{chat.messages.length} msg</span>
      </div>
    </button>
  )
}
