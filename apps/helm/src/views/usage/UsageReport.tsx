// Token usage report (task 050): tokens Claude Code and Codex used on this machine, per day, week
// or month, with the heaviest sessions, projects or models first. Online: /api/usage/report.
// Offline: labelled sample data. The headline counts new tokens (fresh input, cache writes and
// output); cache reads, which re-send earlier context and dwarf everything else, are shown apart.
import { useEffect, useMemo, useState } from 'react'
import { server, type UsageReport as Report, type UsageTokens } from '@helm/client'
import { Badge, Button, Panel } from '@helm/ui'
import { useHelm } from '../../state/store'
import s from './UsageReport.module.css'

type Mode = 'day' | 'week' | 'month'
type Group = 'sessions' | 'projects' | 'models'
type HostId = 'claude' | 'codex'
const LABEL: Record<HostId, string> = { claude: 'Claude Code', codex: 'Codex' }
const DAY = 86_400_000

const zero = (): UsageTokens => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
const add = (a: UsageTokens, b: UsageTokens) => {
  a.input += b.input
  a.cacheWrite += b.cacheWrite
  a.cacheRead += b.cacheRead
  a.output += b.output
  return a
}
/** new tokens: everything but cache reads */
const fresh = (t: UsageTokens) => t.input + t.cacheWrite + t.output
const fmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat()
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** [from, to) of the period holding `anchor`; weeks start on Monday. */
export function periodOf(mode: Mode, anchor: Date): [Date, Date] {
  const a = midnight(anchor)
  if (mode === 'day') return [a, new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1)]
  if (mode === 'week') {
    const start = new Date(a.getFullYear(), a.getMonth(), a.getDate() - ((a.getDay() + 6) % 7))
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)]
  }
  return [new Date(a.getFullYear(), a.getMonth(), 1), new Date(a.getFullYear(), a.getMonth() + 1, 1)]
}
const step = (mode: Mode, anchor: Date, dir: number) =>
  mode === 'day'
    ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dir)
    : mode === 'week'
      ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * dir)
      : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)

function periodTitle(mode: Mode, from: Date, to: Date) {
  const today = midnight(new Date())
  if (mode === 'day') {
    const diff = Math.round((today.getTime() - from.getTime()) / DAY)
    const date = from.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return diff === 0 ? `Today · ${date}` : diff === 1 ? `Yesterday · ${date}` : date
  }
  if (mode === 'week') {
    const last = new Date(to.getTime() - DAY)
    return `Week of ${from.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  return from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/* ── offline sample (labelled) ── */
function sample(from: Date, to: Date): Report {
  const days: Report['days'] = []
  let i = 0
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1), i++) {
    const future = d > new Date()
    const w = future ? 0 : 0.4 + ((i * 37) % 11) / 10
    days.push({
      date: dateKey(d),
      claude: { input: Math.round(3000 * w), cacheWrite: Math.round(1_800_000 * w), cacheRead: Math.round(60_000_000 * w), output: Math.round(420_000 * w) },
      codex: { input: Math.round(90_000 * w * 0.6), cacheWrite: 0, cacheRead: Math.round(2_100_000 * w * 0.6), output: Math.round(40_000 * w * 0.6) },
    })
  }
  const start = Math.min(from.getTime() + 9 * 3_600_000, Date.now())
  const ses = (host: HostId, id: string, project: string, model: string, k: number) => ({
    host, id, project, startedAt: start + k * 3_600_000,
    byModel: { [model]: { input: 1200 * k, cacheWrite: 600_000 * k, cacheRead: 20_000_000 * k, output: 140_000 * k } },
  })
  return {
    from: from.getTime(), to: to.getTime(), days, skipped: 0,
    sessions: [ses('claude', 's1', 'helm-dev', 'claude-opus-5-5', 3), ses('claude', 's2', 'nuula', 'claude-sonnet-5-5', 2), ses('codex', 's3', 'sites', 'gpt-5.6-sol', 1)],
  }
}

/* ── list rows ── */
interface Row {
  key: string
  host?: HostId
  name: string
  detail: string
  tokens: UsageTokens
  open?: () => void
}

export function UsageReport() {
  const { state, online, actions } = useHelm()
  const [mode, setMode] = useState<Mode>('day')
  const [anchor, setAnchor] = useState(() => midnight(new Date()))
  const [group, setGroup] = useState<Group>('sessions')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [from, to] = periodOf(mode, anchor)
  const fromMs = from.getTime()
  const toMs = to.getTime()

  useEffect(() => {
    if (!online) return
    let live = true
    setReport(null)
    setError(null)
    server.usageReport(fromMs, toMs).then(
      (r) => live && setReport(r),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [online, fromMs, toMs, tick])

  const data = online ? report : sample(from, to)

  const totals = useMemo(() => {
    const t = { claude: zero(), codex: zero() }
    for (const d of data?.days ?? []) add(t.claude, d.claude), add(t.codex, d.codex)
    return t
  }, [data])
  const all = add(add(zero(), totals.claude), totals.codex)

  const rows = useMemo<Row[]>(() => {
    const ses = data?.sessions ?? []
    const out = new Map<string, Row>()
    const put = (key: string, r: Omit<Row, 'tokens' | 'key'>, t: UsageTokens) => {
      const row = out.get(key) ?? { ...r, key, tokens: zero() }
      add(row.tokens, t)
      out.set(key, row)
    }
    for (const x of ses) {
      const sum = Object.values(x.byModel).reduce((a, t) => add(a, t), zero())
      if (group === 'sessions') {
        const helm = x.helm && x.helm.wsId === state.wsId ? x.helm : undefined
        put(`${x.host}:${x.id}`, {
          host: x.host,
          name: x.project || 'Unknown folder',
          detail: `${new Date(x.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${Object.keys(x.byModel).join(', ')}`,
          open: helm ? () => actions.openSession(helm.id, helm.title) : undefined,
        }, sum)
      } else if (group === 'projects') {
        put(x.project || '—', { name: x.project || 'Unknown folder', detail: '' }, sum)
      } else {
        for (const [model, t] of Object.entries(x.byModel)) put(`${x.host}:${model}`, { host: x.host, name: model, detail: '' }, t)
      }
    }
    if (group === 'projects')
      for (const r of out.values()) {
        const c = ses.filter((x) => (x.project || '—') === r.key).length
        r.detail = `${c} session${c === 1 ? '' : 's'}`
      }
    return [...out.values()].sort((a, b) => fresh(b.tokens) - fresh(a.tokens))
  }, [data, group, state.wsId, actions])

  const max = Math.max(1, ...(data?.days ?? []).map((d) => fresh(d.claude) + fresh(d.codex)))
  const pick = (m: Mode, a = anchor) => (setMode(m), setAnchor(midnight(a)))
  const yesterday = new Date(midnight(new Date()).getTime() - DAY)

  return (
    <div className={s.scroll}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Token usage</h1>
          <p className={s.lede}>
            Claude Code and Codex on this machine, from their own transcript files.{' '}
            {!online && <Badge tone="amber">Sample data</Badge>}
          </p>
        </div>
        {online && (
          <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)}>
            Refresh
          </Button>
        )}
      </header>

      <div className={s.controls}>
        <div className={s.seg} role="group" aria-label="Period">
          {(['day', 'week', 'month'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <div className={s.nav}>
          <button type="button" className={s.arrow} aria-label="Earlier" onClick={() => setAnchor(step(mode, anchor, -1))}>
            ‹
          </button>
          <span className={s.period}>{periodTitle(mode, from, to)}</span>
          <button type="button" className={s.arrow} aria-label="Later" disabled={to.getTime() > Date.now()} onClick={() => setAnchor(step(mode, anchor, 1))}>
            ›
          </button>
        </div>
        {mode === 'day' && (
          <div className={s.dayPick}>
            <button type="button" className={s.chip} aria-pressed={dateKey(anchor) === dateKey(yesterday)} onClick={() => pick('day', yesterday)}>
              Yesterday
            </button>
            <input
              type="date"
              className={s.date}
              aria-label="Pick a day"
              value={dateKey(anchor)}
              max={dateKey(new Date())}
              onChange={(e) => e.target.value && pick('day', fromKey(e.target.value))}
            />
          </div>
        )}
      </div>

      {error && <p className={s.error}>Could not load usage: {error}</p>}
      {online && !report && !error && <p className={s.muted}>Reading transcripts…</p>}

      {data && (
        <>
          <div className={s.stats}>
            <div className={s.stat}>
              <span className={s.statLabel}>New tokens</span>
              <span className={s.statValue} title={`${full.format(fresh(all))} tokens: input ${full.format(all.input)}, cache writes ${full.format(all.cacheWrite)}, output ${full.format(all.output)}`}>
                {fmt.format(fresh(all))}
              </span>
              <span className={s.statNote}>input, cache writes and output</span>
            </div>
            {(['claude', 'codex'] as const).map((h) => (
              <div key={h} className={s.stat}>
                <span className={s.statLabel}>
                  <i className={s.swatch} data-host={h} /> {LABEL[h]}
                </span>
                <span className={s.statValue}>{fmt.format(fresh(totals[h]))}</span>
                <span className={s.statNote}>output {fmt.format(totals[h].output)}</span>
              </div>
            ))}
            <div className={s.stat}>
              <span className={s.statLabel}>Cache reads</span>
              <span className={s.statValueSmall}>{fmt.format(all.cacheRead)}</span>
              <span className={s.statNote}>earlier context sent again, counted apart</span>
            </div>
          </div>

          {mode !== 'day' && (
            <Panel title="Per day" code="U-01">
              <div className={s.chart} role="list">
                {data.days.map((d) => {
                  const c = fresh(d.claude)
                  const x = fresh(d.codex)
                  const day = fromKey(d.date)
                  const future = day.getTime() > Date.now()
                  return (
                    <button
                      key={d.date}
                      type="button"
                      role="listitem"
                      className={s.bar}
                      disabled={future}
                      onClick={() => pick('day', day)}
                      aria-label={`${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmt.format(c + x)} new tokens. Open this day`}
                      title={`${day.toLocaleDateString()}\nClaude Code ${fmt.format(c)}\nCodex ${fmt.format(x)}`}
                    >
                      <span className={s.barStack}>
                        <span className={s.barPart} data-host="codex" style={{ height: `${(x / max) * 100}%` }} />
                        <span className={s.barPart} data-host="claude" style={{ height: `${(c / max) * 100}%` }} />
                      </span>
                      <span className={s.barLabel}>{mode === 'week' ? day.toLocaleDateString(undefined, { weekday: 'short' }) : day.getDate() === 1 || day.getDate() % 5 === 0 ? day.getDate() : ''}</span>
                    </button>
                  )
                })}
              </div>
            </Panel>
          )}

          <Panel
            title="Heaviest"
            code="U-02"
            actions={
              <div className={s.seg} role="group" aria-label="Group by">
                {(['sessions', 'projects', 'models'] as const).map((g) => (
                  <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>
                    {g[0].toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            }
          >
            {rows.length === 0 ? (
              <p className={s.muted}>No Claude Code or Codex usage in this period on this machine.</p>
            ) : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">{group === 'sessions' ? 'Session' : group === 'projects' ? 'Project' : 'Model'}</th>
                    <th scope="col">New tokens</th>
                    <th scope="col">Input</th>
                    <th scope="col">Output</th>
                    <th scope="col">Cache reads</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">
                        <span className={s.rowName}>
                          {r.host && <i className={s.swatch} data-host={r.host} title={LABEL[r.host]} />}
                          {r.open ? (
                            <button type="button" className={s.link} onClick={r.open} title="Open the Helm session">
                              {r.name}
                            </button>
                          ) : (
                            r.name
                          )}
                        </span>
                        {r.detail && <span className={s.rowDetail}>{r.detail}</span>}
                      </th>
                      <td className={s.strong}>{fmt.format(fresh(r.tokens))}</td>
                      <td title={`fresh ${full.format(r.tokens.input)}, cache writes ${full.format(r.tokens.cacheWrite)}`}>{fmt.format(r.tokens.input + r.tokens.cacheWrite)}</td>
                      <td>{fmt.format(r.tokens.output)}</td>
                      <td className={s.dim}>{fmt.format(r.tokens.cacheRead)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.skipped > 0 && <p className={s.muted}>{data.skipped} unreadable lines skipped.</p>}
          </Panel>
        </>
      )}
    </div>
  )
}
