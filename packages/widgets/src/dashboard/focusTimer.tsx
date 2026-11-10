import { useEffect, useState } from 'react'
import { Button } from '@helm/ui'
import { cx } from '@helm/ui'
import s from './widgets.module.css'

/* ── Focus timer ─────────────────────────────────────── */
export function FocusTimerWidget({ focusMinutes = 25 }: { focusMinutes?: number }) {
  const PRESETS = [
    { label: 'Focus', min: focusMinutes },
    { label: 'Deep', min: 50 },
    { label: 'Break', min: 5 },
  ]
  const [preset, setPreset] = useState(PRESETS[0])
  const [left, setLeft] = useState(preset.min * 60)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000)
    return () => window.clearInterval(t)
  }, [running])

  useEffect(() => {
    if (left === 0) setRunning(false)
  }, [left])

  const total = preset.min * 60
  const pct = ((total - left) / total) * 100
  const r = 54
  const c = 2 * Math.PI * r
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')

  return (
    <div className={s.timer}>
      <div className={s.segmented}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={cx(preset.label === p.label && s.on)}
            onClick={() => {
              setPreset(p)
              setLeft(p.min * 60)
              setRunning(false)
            }}
          >
            {p.label} {p.min}
          </button>
        ))}
      </div>
      <div className={s.timerDial}>
        <svg viewBox="0 0 128 128" width="128" height="128">
          <circle cx="64" cy="64" r={r} fill="none" strokeWidth="5" style={{ stroke: 'var(--c-cyan)', strokeOpacity: 0.12 }} />
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
            transform="rotate(-90 64 64)"
            style={{ stroke: 'var(--c-cyan)', transition: 'stroke-dasharray 1s linear' }}
          />
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2
            const len = i % 5 === 0 ? 5 : 2
            return (
              <line
                key={i}
                x1={64 + Math.sin(a) * 61}
                y1={64 - Math.cos(a) * 61}
                x2={64 + Math.sin(a) * (61 - len)}
                y2={64 - Math.cos(a) * (61 - len)}
                style={{ stroke: 'var(--c-text-3)', strokeWidth: 1 }}
              />
            )
          })}
        </svg>
        <div className={s.timerReadout}>
          <span className={s.timerTime}>{mm}:{ss}</span>
          <span className="hud-label">{running ? 'Engaged' : left === 0 ? 'Complete' : 'Standby'}</span>
        </div>
      </div>
      <div className={s.timerActions}>
        <Button size="sm" variant="primary" icon={running ? 'minus' : 'bolt'} onClick={() => setRunning((v) => !v)} disabled={left === 0}>
          {running ? 'Pause' : 'Start'}
        </Button>
        <Button size="sm" variant="subtle" icon="reset" onClick={() => { setRunning(false); setLeft(total) }}>
          Reset
        </Button>
      </div>
    </div>
  )
}
