import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MarkdownView } from '../../components/markdown/MarkdownView'
import { Badge, Button, Icon, StatusDot } from '@helm/ui'
import { Logo } from '../../components/shell/Logo'
import { HostPicker, suggestions } from '../../components/chat/HostPicker'
import { cx } from '../../lib/util'
import { isStreaming, useHelm, useUserName, type Message } from '../../state/store'
import s from './ChatView.module.css'

export function ChatView({ chatId }: { chatId: string }) {
  const { state, projects, ws, actions } = useHelm()
  const chat = state.chats[chatId]
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)

  const lastText = chat?.messages[chat.messages.length - 1]?.text.length ?? 0
  const count = chat?.messages.length ?? 0

  // follow the stream unless the reader scrolled up
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [count, lastText])

  useEffect(() => inputRef.current?.focus(), [])

  if (!chat) {
    return (
      <div className={s.missing}>
        <p>This session no longer exists.</p>
        <Button onClick={() => actions.closeTab(`chat:${chatId}`)}>Close tab</Button>
      </div>
    )
  }

  const project = projects.find((p) => p.id === chat.projectId)
  const busy = isStreaming(chat)

  const send = (text = draft) => {
    if (!text.trim() || busy) return
    pinned.current = true
    actions.sendMessage(chat.id, text)
    setDraft('')
  }

  return (
    <div className={s.view}>
      <header className={s.header}>
        <div className={s.headMain}>
          <span className="hud-label">
            Session · {chat.id.toUpperCase()} · {ws.name}
          </span>
          <h1 className={s.title}>{chat.title}</h1>
        </div>
        <div className={s.headMeta}>
          {project && (
            <button className={s.projectLink} onClick={() => actions.openProject(project)}>
              <Badge tone="cyan">{project.code}</Badge> {project.name}
            </button>
          )}
          <span className={s.stat}>
            <StatusDot tone={busy ? 'amber' : 'green'} pulse={busy} /> {busy ? 'Handing off' : 'Idle'}
          </span>
          <span className={s.stat}>{chat.messages.length} msg</span>
          <Button size="sm" variant="subtle" icon="brain" onClick={() => actions.openGraph(project?.name ?? '')}>
            Context
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className={s.scroll}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        <div className={s.thread}>
          {chat.messages.length === 0 && (
            <div className={s.empty}>
              <Logo size={56} />
              <h2>What are we working on?</h2>
              <p>Messages hand off to Claude Code or Codex in a {ws.name} terminal. Helm never runs a model itself.</p>
              <div className={s.starters}>
                {suggestions.map((q) => (
                  <button key={q} onClick={() => send(q)}>
                    <Icon name="spark" size={14} />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
        </div>
      </div>

      <div className={s.composerWrap}>
        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={busy ? 'Handing off…' : 'Message to hand off  ·  Shift+Enter for a new line'}
          />
          <div className={s.composerBar}>
            <span className="hud-label">
              {project ? `Context · ${project.name}` : `Context · ${ws.name}`} · hand off to
            </span>
            <HostPicker />
            <Button type="submit" variant="primary" size="sm" icon="arrow" disabled={!draft.trim() || busy}>
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MessageRow({ message }: { message: Message }) {
  const user = message.role === 'user'
  const me = useUserName()
  return (
    <div className={cx(s.msg, user ? s.user : s.assistant)}>
      <div className={s.avatar}>{user ? me.initials : <Logo size={20} />}</div>
      <div className={s.bubble}>
        <div className={s.msgHead}>
          <span>{user ? me.name : 'Helm'}</span>
          <span className={s.msgTime}>{new Date(message.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {message.status === 'thinking' ? (
          <div className={s.thinking}>
            <span />
            <span />
            <span />
            <em>Handing off</em>
          </div>
        ) : (
          <div className={cx(message.status === 'streaming' && s.streaming)}>
            <MarkdownView markdown={message.text} />
          </div>
        )}
      </div>
    </div>
  )
}
