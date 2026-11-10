import { forwardRef, useLayoutEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react'
import { cx } from '../util'
import { toneColor, type Tone } from '../tokens'
import { Icon, type IconName } from './Icon'
import s from './hud.module.css'

export { Icon } from './Icon'
export type { IconName } from './Icon'

/* ── Panel ───────────────────────────────────────────── */
interface PanelProps {
  title?: ReactNode
  code?: string
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  flush?: boolean
  raised?: boolean
  headerProps?: React.HTMLAttributes<HTMLDivElement>
}

export function Panel({ title, code, actions, children, className, bodyClassName, flush, raised, headerProps }: PanelProps) {
  return (
    <section className={cx(s.panel, raised && s.raised, className)}>
      {title !== undefined && (
        <div {...headerProps} className={cx(s.panelHeader, headerProps?.className)}>
          <span className={s.marker} />
          <h3 className={s.panelTitle}>{title}</h3>
          {code && <span className={s.panelCode}>{code}</span>}
          {actions && <div className={s.panelActions}>{actions}</div>}
        </div>
      )}
      <div className={cx(s.panelBody, flush && s.flush, bodyClassName)}>{children}</div>
    </section>
  )
}

/* ── Button ──────────────────────────────────────────── */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, iconOnly, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(s.btn, s[variant], size === 'sm' && s.sm, iconOnly && s.iconOnly, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {!iconOnly && children}
    </button>
  )
})

/* ── Badge & dot ─────────────────────────────────────── */
export function Badge({ tone = 'cyan', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx(s.badge, s[tone], className)}>{children}</span>
}

export function StatusDot({ tone = 'green', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span className={cx(s.dot, s[tone], pulse && s.pulse, className)} />
}

/* ── Meter ───────────────────────────────────────────── */
export function Meter({ value, tone = 'cyan', segments = 20 }: { value: number; tone?: Tone; segments?: number }) {
  const on = Math.round((value / 100) * segments)
  return (
    <div className={cx(s.meter, s[tone])} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={cx(s.seg, i < on && s.on)} />
      ))}
    </div>
  )
}

/* ── Input ───────────────────────────────────────────── */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName
  kbd?: string
  wrapClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, kbd, wrapClassName, className, ...rest },
  ref,
) {
  return (
    <label className={cx(s.inputWrap, wrapClassName)}>
      {icon && <Icon name={icon} size={14} />}
      <input ref={ref} className={cx(s.input, className)} {...rest} />
      {kbd && <span className={s.kbd}>{kbd}</span>}
    </label>
  )
})

/* ── Radial gauge ────────────────────────────────────── */
export function RadialGauge({ value, size = 120, tone = 'cyan', label }: { value: number; size?: number; tone?: Tone; label?: string }) {
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  const col = toneColor[tone]
  return (
    <div className={s.gauge} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle className={s.gaugeRing} cx={size / 2} cy={size / 2} r={size / 2 - 2} fill="none" strokeWidth={1} strokeDasharray="2 6" style={{ stroke: 'var(--c-accent-2)', strokeOpacity: 0.45 }} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} style={{ stroke: col, strokeOpacity: 0.1 }} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ stroke: col, filter: `drop-shadow(0 0 4px ${col})`, transition: 'stroke-dasharray 600ms var(--ease-out)' }}
        />
      </svg>
      <div className={s.gaugeValue} style={{ fontSize: size * 0.24 }}>
        {value.toFixed(1)}
        {label && <small>{label}</small>}
      </div>
    </div>
  )
}

/* ── Sparkline ───────────────────────────────────────── */
export function Sparkline({ data, width = 160, height = 36, tone = 'cyan' }: { data: number[]; width?: number; height?: number; tone?: Tone }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data.map((d, i) => [(i / (data.length - 1)) * width, height - 2 - ((d - min) / (max - min || 1)) * (height - 4)])
  const line = pts.map((p) => p.join(',')).join(' ')
  const col = toneColor[tone]
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${height} ${line} ${width},${height}`} style={{ fill: col, fillOpacity: 0.08 }} />
      <polyline points={line} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ stroke: col }} />
    </svg>
  )
}

/**
 * Props for a `<dialog className="hud-modal …">` that is mounted while open: opens it modal (top layer,
 * inert page, focus contained and returned on close), Esc and a click outside the panel call `onClose`.
 */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return {
    ref,
    onCancel: (e: SyntheticEvent) => (e.preventDefault(), onClose()),
    onMouseDown: (e: MouseEvent) => e.target === e.currentTarget && onClose(),
  }
}
