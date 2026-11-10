// React bindings for code inside a sandboxed Helm frame (docs/react.md). Import from
// '@usetdt/helm-sdk/react'; react and react-dom are optional peer dependencies, so plugins
// that don't import this entry never ship React.
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { TdtResult } from './connection.js'
import { getHelm, type HelmBridge } from './frame.js'
import type { SettingValues } from './settings.js'

/* ── one subscription per frame: the bridge has no `off` and sends settings only after ready() ── */
let settings: SettingValues | undefined
let tokens: Record<string, string> = {}
let refreshes = 0
const subs = new Set<() => void>()
let started = false
const emit = () => subs.forEach((fn) => fn())
function subscribe(fn: () => void) {
  if (!started) {
    started = true
    const helm = getHelm()
    helm.on('settings', (s) => ((settings = s), emit()))
    helm.on('theme', (t) => ((tokens = t), emit()))
    helm.on('refresh', () => (refreshes++, emit()))
  }
  subs.add(fn)
  return () => void subs.delete(fn)
}

/** The bridge Helm injected into this frame. */
export const useHelm = (): HelmBridge => getHelm()

/** The instance's setting values; undefined until Helm sends them (right after ready()). */
export const useSettings = (): SettingValues | undefined => useSyncExternalStore(subscribe, () => settings)

/** Current theme token values. The CSS variables are already applied, so most plugins only need var(--…). */
export const useTheme = (): Record<string, string> => useSyncExternalStore(subscribe, () => tokens)

export type ConnectionState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined; result?: undefined; reload: () => void }
  | { status: 'error'; data?: undefined; error: string; result?: TdtResult<T>; reload: () => void }
  | { status: 'ready'; data: T; error?: undefined; result: TdtResult<T>; reload: () => void }

/**
 * Call a declared connection operation. Waits for settings, then reruns when `args` change
 * (compared as JSON), on Helm's refresh, and on reload(). Pass `args: null` to skip the call.
 */
export function useConnection<T = unknown>(connection: string, operation: string, args: Record<string, unknown> | null = {}): ConnectionState<T> {
  const ready = useSettings() !== undefined
  const tick = useSyncExternalStore(subscribe, () => refreshes)
  const [reloads, setReloads] = useState(0)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; error: string; result?: TdtResult<T> } | { status: 'ready'; data: T; result: TdtResult<T> }>({ status: 'loading' })
  const key = JSON.stringify(args)
  useEffect(() => {
    if (!ready || args === null) return
    let live = true
    setState({ status: 'loading' })
    getHelm()
      .call<T>(connection, operation, args)
      .then(
        (r) => live && setState(r.ok ? { status: 'ready', data: r.data as T, result: r } : { status: 'error', error: r.error?.message ?? 'The connection did not answer', result: r }),
        (e: Error) => live && setState({ status: 'error', error: e.message }),
      )
    return () => void (live = false)
  }, [ready, connection, operation, key, tick, reloads]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => setReloads((n) => n + 1) } as ConnectionState<T>
}

function Ready({ children }: { children: ReactNode }) {
  useEffect(() => getHelm().ready(), [])
  return <>{children}</>
}

/** Render the plugin into `container` (default #app, else body) and tell Helm it is ready after the first render. */
export function mount(node: ReactNode, container: Element | null = document.getElementById('app') ?? document.body) {
  if (!container) throw new Error('mount: no container element')
  subscribe(() => {}) // listen before ready(), which makes Helm send settings
  container.className = ''
  container.replaceChildren()
  createRoot(container).render(<Ready>{node}</Ready>)
}

/* ── UI kit (docs/kit.md) as components: the same classes, so React and HTML plugins match ── */
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')
type Tone = 'cyan' | 'amber' | 'red' | 'green' | 'violet' | 'blue'

/** A non-ready state in place of content. No kind = empty/unconfigured. */
export function State({ kind, action, children }: { kind?: 'loading' | 'error'; action?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <div className={cx('h-state', kind && `h-state--${kind}`)} role={kind === 'error' ? 'alert' : undefined} aria-live="polite">
      <span>{children}</span>
      {action && <Button ghost onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}
export const Stack = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cx('h-stack', className)} {...p} />
export const List = ({ className, ...p }: HTMLAttributes<HTMLUListElement>) => <ul className={cx('h-list', className)} {...p} />
/** A list row: label left, value right. With onClick it renders as a button row. */
export function Row({ label, value, onClick }: { label: ReactNode; value?: ReactNode; onClick?: () => void }) {
  const inner = (<><span>{label}</span>{value !== undefined && value}</>)
  return onClick ? <li><button type="button" className="h-row" onClick={onClick}>{inner}</button></li> : <li className="h-row">{inner}</li>
}
export const Value = ({ className, ...p }: HTMLAttributes<HTMLElement>) => <b className={cx('h-value', className)} {...p} />
export const Muted = ({ className, ...p }: HTMLAttributes<HTMLSpanElement>) => <span className={cx('h-muted', className)} {...p} />
export const Badge = ({ tone, className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) => <span className={cx('h-badge', tone && `h-badge--${tone}`, className)} {...p} />
export const Button = ({ ghost, className, type = 'button', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { ghost?: boolean }) => <button type={type} className={cx('h-btn', ghost && 'h-btn--ghost', className)} {...p} />
export const Field = ({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) => <label className={cx('h-field', className)} {...p} />
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx('h-input', className)} {...p} />
