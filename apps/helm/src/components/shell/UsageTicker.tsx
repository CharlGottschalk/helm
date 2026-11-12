// The sessions rail's usage tickers (task 048): each agent host's 5-hour window, with the weekly
// window and reset times on hover or click. Online: the server's /api/usage/limits, asked every
// minute while visible and on window focus (the server decides when it really checks a host).
// Offline: labelled sample numbers.
import { useEffect, useState } from 'react'
import { server, type HostUsage, type UsageWindow } from '@helm/client'
import { Badge, Meter, type Tone } from '@helm/ui'
import { useHelm } from '../../state/store'
import s from './RightSidebar.module.css'

const HOUR = 3_600_000
const SAMPLE: HostUsage[] = [
  { host: 'claude', state: 'ok', fiveHour: { pct: 42, resetsAt: Date.now() + 2.3 * HOUR }, weekly: { pct: 18, resetsAt: Date.now() + 80 * HOUR }, updatedAt: Date.now() },
  { host: 'codex', state: 'ok', fiveHour: { pct: 12, resetsAt: Date.now() + 4.1 * HOUR }, weekly: { pct: 30, resetsAt: Date.now() + 120 * HOUR }, updatedAt: Date.now() },
]
const LABEL = { claude: 'Claude Code', codex: 'Codex' } as const

export const usageTone = (pct: number): Tone => (pct >= 90 ? 'red' : pct >= 75 ? 'amber' : 'cyan')
const pct = (w: UsageWindow | null) => (w ? `${Math.round(w.pct)}%` : '—')

export function resetText(ms: number | null, now = Date.now()) {
  if (!ms) return ''
  const left = ms - now
  if (left <= 0) return 'resets now'
  if (left < 24 * HOUR) {
    const h = Math.floor(left / HOUR)
    const m = Math.round((left % HOUR) / 60_000)
    return `resets in ${h ? `${h}h ` : ''}${m}m`
  }
  return `resets ${new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
}

export function UsageTicker() {
  const { state, online, actions } = useHelm()
  const on = state.settings.usageLimits
  const [hosts, setHosts] = useState<HostUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!online || !on) return
    let live = true
    const load = (focus = false) =>
      server.usageLimits(focus).then(
        (r) => live && (setHosts(r.hosts), setError(null)),
        (e: Error) => live && setError(e.message),
      )
    void load()
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 60_000)
    const onFocus = () => void load(true)
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [online, on])

  if (!on) return null
  const rows: HostUsage[] = !online
    ? SAMPLE
    : (hosts ?? (['claude', 'codex'] as const).map((host) => ({ host, state: 'unavailable', reason: error ?? 'Checking…', fiveHour: null, weekly: null, updatedAt: null })))

  return (
    <footer className={s.footer} aria-label="Agent usage limits">
      <div className={s.telemetryRow}>
        <span>Usage limits</span>
        {!online && <Badge tone="amber">Sample data</Badge>}
        <button type="button" className={s.usageLink} onClick={actions.openUsage} title="Open the token usage report">
          Report
        </button>
      </div>
      {rows.map((u) => (
        <UsageRow key={u.host} u={u} />
      ))}
    </footer>
  )
}

function UsageRow({ u }: { u: HostUsage }) {
  const [open, setOpen] = useState(false)
  const five = u.fiveHour
  const tip = [
    `${LABEL[u.host]}`,
    `5 hours: ${pct(five)} ${resetText(five?.resetsAt ?? null)}`.trim(),
    `Week: ${pct(u.weekly)} ${resetText(u.weekly?.resetsAt ?? null)}`.trim(),
    u.reason,
  ].filter(Boolean).join('\n')
  return (
    <div className={s.usage}>
      <button type="button" className={s.usageBtn} aria-expanded={open} onClick={() => setOpen(!open)} title={tip}>
        <span className={s.telemetryRow}>
          <span>{LABEL[u.host]} · 5h</span>
          <span className={s.telemetryValue}>{pct(five)}</span>
        </span>
        {five && <Meter value={five.pct} tone={usageTone(five.pct)} segments={30} />}
      </button>
      {u.state !== 'ok' && u.reason && <p className={s.usageNote}>{u.state === 'stale' ? `Last known. ${u.reason}` : u.reason}</p>}
      {open && (
        <div className={s.usageDetail}>
          {five && <span className={s.usageNote}>5h {resetText(five.resetsAt)}</span>}
          <span className={s.telemetryRow}>
            <span>Week</span>
            <span className={s.telemetryValue}>{pct(u.weekly)}</span>
          </span>
          {u.weekly && <Meter value={u.weekly.pct} tone={usageTone(u.weekly.pct)} segments={30} />}
          {u.weekly && <span className={s.usageNote}>{resetText(u.weekly.resetsAt)}</span>}
        </div>
      )}
    </div>
  )
}
