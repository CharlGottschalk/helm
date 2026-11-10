// Workspace terminal tab (xterm.js ↔ server node-pty over the WebSocket).
// Also embedded by SessionView to show a host agent's live chat.
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@helm/ui'
import { snapshotTokens } from '@usetdt/helm-sdk'
import { server, useServer } from '@helm/client'
import { useHelm } from '../../state/store'
import s from './TerminalView.module.css'

function xtermTheme() {
  const t = snapshotTokens()
  return {
    background: 'rgba(0,0,0,0)',
    foreground: t['--c-text-0'],
    cursor: t['--c-cyan'],
    cursorAccent: t['--c-bg-0'],
    selectionBackground: `rgb(${t['--rgb-accent']} / 0.3)`,
    red: t['--c-red'],
    green: t['--c-green'],
    yellow: t['--c-amber'],
    blue: t['--c-blue'],
    magenta: t['--c-violet'],
    cyan: t['--c-cyan'],
  }
}

export function TerminalPane({ terminalId }: { terminalId: string }) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const { state } = useHelm()
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const term = new Terminal({
      allowTransparency: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: 13,
      cursorBlink: true,
      theme: xtermTheme(),
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    const conn = server.attachTerminal(terminalId, {
      onData: (d) => term.write(d),
      onReset: () => term.reset(),
      onExit: (code) => setExited(code),
    })
    const input = term.onData((d) => conn.write(d))
    const ro = new ResizeObserver(() => {
      fit.fit()
      conn.resize(term.cols, term.rows)
    })
    ro.observe(el)
    term.focus()
    return () => {
      ro.disconnect()
      input.dispose()
      conn.detach()
      term.dispose()
      termRef.current = null
    }
  }, [terminalId])

  // Re-theme when the user switches theme; wait for the cross-fade so tokens are final.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (termRef.current) termRef.current.options.theme = xtermTheme()
    }, 550)
    return () => window.clearTimeout(t)
  }, [state.settings.theme])

  return (
    <div className={s.paneWrap}>
      <div ref={host} className={s.pane} />
      {exited !== null && <div className={s.exited}>Process exited with code {exited}</div>}
    </div>
  )
}

export function TerminalView({ terminalId }: { terminalId: string }) {
  const { status } = useServer()
  if (status !== 'online' || terminalId === 'offline') {
    return (
      <div className={s.offline}>
        <Icon name="keyboard" size={28} />
        <h2>Terminal needs the Helm server</h2>
        <p>Terminals run on your machine through node-pty, confined to the workspace folder. Start Helm with:</p>
        <pre className={s.cmd}>npx helm</pre>
        <p className={s.hint}>In development: <code>npm run dev:server</code> and open <code>http://localhost:5173/#token=dev</code>.</p>
      </div>
    )
  }
  return (
    <div className={s.view}>
      <TerminalPane terminalId={terminalId} />
    </div>
  )
}
