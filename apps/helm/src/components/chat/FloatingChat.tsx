import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HostPicker, suggestions } from './HostPicker'
import { cx } from '../../lib/util'
import { server } from '@helm/client'
import { useChromeTheme, useHelm } from '../../state/store'
import { Icon } from '@helm/ui'
import { Logo } from '../shell/Logo'
import s from './FloatingChat.module.css'

/** Command bar docked at the bottom of the centre area. Submitting opens a full chat tab. */
export function FloatingChat() {
  const { state, activeTab, projects, ws, actions } = useHelm()
  const chrome = useChromeTheme()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const project = activeTab.kind === 'project' ? projects.find((p) => p.id === activeTab.refId) : undefined

  // "/" focuses the bar from anywhere that isn't already a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !el.closest('input, textarea, [contenteditable]')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * Online: hand the prompt to the chosen host (D2); the session opens in a tab and
   * appears in the right panel. Offline (or if the host can't start): a chat tab that
   * keeps the prompt and explains how to hand it off.
   */
  const send = async (value: string) => {
    if (!value.trim()) return
    setText('')
    const target = server.online ? { id: ws.id } : undefined
    if (target) {
      try {
        const context = project?.path ? `\n\n(Context: project ${project.name}, registered id ${project.id}.)` : ''
        const session = await server.handoff(target.id, value + context, state.settings.host)
        actions.openSession(session.id, session.title)
        return
      } catch {
        // fall through to a chat tab so the prompt isn't lost
      }
    }
    actions.startChat(value, project?.id)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(text)
  }

  return (
    <div className={s.dock} data-theme={chrome}>
      <div className={cx(s.suggest, focused && !text && s.show)}>
        {suggestions.map((q) => (
          <button key={q} onMouseDown={(e) => e.preventDefault()} onClick={() => send(q)}>
            <Icon name="spark" size={12} /> {q}
          </button>
        ))}
      </div>
      <form className={cx(s.bar, focused && s.focused)} onSubmit={submit}>
        <span className={s.logo}>
          <Logo size={22} />
        </span>
        <span className={s.context}>{project ? project.code : ws.code}</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === 'Escape' && inputRef.current?.blur()}
          placeholder={project ? `Ask Helm about ${project.name}…` : `Ask Helm anything about ${ws.name}…`}
          aria-label="Ask Helm"
        />
        <HostPicker />
        <span className={s.kbd}>/</span>
        <button type="submit" className={s.send} disabled={!text.trim()} aria-label="Send">
          <Icon name="arrow" size={16} stroke={2} />
        </button>
        <span className={s.scan} />
      </form>
    </div>
  )
}
