import { useEffect, useRef, useState } from 'react'
import { Button, Icon, StatusDot } from '@helm/ui'
import { SettingsDialog } from '../../components/settings/SettingsDialog'
import { compactLayout, findSlot, typeOf, type GridItem } from '../../lib/gridLayout'
import { uid } from '../../lib/util'
import { requiredMissing, resolveSettings, type SettingValues } from '@usetdt/helm-sdk'
import { useOptionsResolver } from '../../services/options'
import { DEFAULT_LAYOUT, useHelm } from '../../state/store'
import { DashboardGrid, type WidgetDef } from './DashboardGrid'
import { useWidgetTypes } from '@helm/widgets'
import { WidgetLibrary } from './WidgetLibrary'
import s from './Dashboard.module.css'

interface Toast {
  text: string
  undo?: GridItem[]
}

export function Dashboard() {
  const { state, ws, actions } = useHelm()
  const layout = state.layouts[state.wsId] ?? DEFAULT_LAYOUT
  const resolveOptions = useOptionsResolver()
  const { find: widgetType } = useWidgetTypes()
  /** settings dialog target: an existing instance, or a type being added */
  const [editing, setEditing] = useState<{ id?: string; type: string; adding?: boolean } | null>(null)
  const editingType = editing ? widgetType(editing.type) : undefined
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const timers = useRef<number[]>([])
  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Night watch' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))

  const showToast = (t: Toast) => {
    setToast(t)
    const shown = t
    later(() => setToast((cur) => (cur === shown ? null : cur)), 5000)
  }

  const saveSettings = (id: string, values: SettingValues) =>
    actions.setLayout(layout.map((i) => (i.id === id ? { ...i, config: values } : i)))

  const resolve = (item: GridItem): WidgetDef | undefined => {
    const t = widgetType(typeOf(item))
    if (!t) return undefined
    const openSettings = () => setEditing({ id: item.id, type: t.type })
    const settings = resolveSettings(t.settings, item.config)
    const unconfigured = requiredMissing(t.settings, settings)
    const extra = t.settings?.length ? (
      <button className={s.settingsBtn} onClick={openSettings} title="Widget settings" aria-label={`${t.title} settings`}>
        <Icon name="sliders" size={13} />
      </button>
    ) : undefined
    return {
      title: t.title,
      code: t.code,
      minW: t.minW,
      minH: t.minH,
      actions: extra,
      render: () =>
        unconfigured ? (
          <div className={s.configure}>
            <Icon name="sliders" size={20} />
            <p>Configure this widget to choose what it shows.</p>
            <Button size="sm" variant="primary" onClick={openSettings}>Configure</Button>
          </div>
        ) : (
          t.render(item, settings, { openSettings })
        ),
    }
  }

  /** Library "Add": widgets with required settings ask for them first. */
  const requestAdd = (type: string) => {
    const t = widgetType(type)
    if (!t) return
    if (requiredMissing(t.settings, resolveSettings(t.settings))) setEditing({ type, adding: true })
    else addWidget(type)
  }

  const addWidget = (type: string, config?: SettingValues) => {
    const t = widgetType(type)
    if (!t) return
    const id = t.multi ? uid(`${type}-`) : type
    const { x, y } = findSlot(layout, t.w, t.h)
    actions.setLayout([...layout, { id, type, config, x, y, w: t.w, h: t.h }])
    setHighlightId(id)
    later(() => setHighlightId((cur) => (cur === id ? null : cur)), 1800)
    later(() => document.querySelector(`[data-widget-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
    showToast({ text: `${t.title} added to the deck` })
  }

  const removeWidget = (id: string) => {
    const item = layout.find((i) => i.id === id)
    if (!item) return
    const title = widgetType(typeOf(item))?.title ?? 'Widget'
    actions.setLayout(compactLayout(layout.filter((i) => i.id !== id)))
    showToast({ text: `${title} removed`, undo: layout })
  }

  return (
    <div className={s.root}>
      <div className={s.scroll}>
        <header className={s.header}>
          <div>
            <span className="hud-label">Command deck · {ws.name}</span>
            <h1 className={s.greeting}>
              {greeting}, <span className="glow-text">Operator</span>
            </h1>
          </div>
          <div className={s.headerRight}>
            <Clock />
            <div className={s.layoutTools}>
              <span className={s.gridInfo}>
                <StatusDot tone="cyan" /> {layout.length} WIDGETS
              </span>
              <Button size="sm" variant="subtle" icon="reset" onClick={() => actions.setLayout(DEFAULT_LAYOUT)} title="Reset layout">
                Reset
              </Button>
              <Button size="sm" variant="primary" icon="plus" onClick={() => setLibraryOpen(true)}>
                Add widget
              </Button>
            </div>
          </div>
        </header>

        {layout.length === 0 ? (
          <div className={s.emptyDeck}>
            <Icon name="grid" size={28} />
            <h2>The deck is empty</h2>
            <p>Open the widget library to add telemetry, tasks, agents and more.</p>
            <Button variant="primary" icon="plus" onClick={() => setLibraryOpen(true)}>
              Open widget library
            </Button>
          </div>
        ) : (
          <DashboardGrid layout={layout} resolve={resolve} onChange={actions.setLayout} onRemove={removeWidget} highlightId={highlightId} />
        )}
      </div>

      {libraryOpen && <WidgetLibrary layout={layout} onAdd={requestAdd} onClose={() => setLibraryOpen(false)} />}

      {editing && editingType && (
        <SettingsDialog
          title={`${editingType.title} settings`}
          subtitle={editing.adding ? 'Configure before adding' : editingType.code}
          fields={editingType.settings ?? []}
          values={editing.id ? layout.find((i) => i.id === editing.id)?.config ?? {} : {}}
          resolveOptions={resolveOptions}
          onSave={(values) => (editing.id ? saveSettings(editing.id, values) : addWidget(editing.type, values))}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && (
        <div className={s.toast} role="status">
          <StatusDot tone="cyan" />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className={s.toastUndo}
              onClick={() => {
                actions.setLayout(toast.undo!)
                setToast(null)
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Ticks on its own so the grid doesn't re-render every second. */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className={s.clock}>
      <span className={s.clockTime}>{now.toLocaleTimeString('en-GB')}</span>
      <span className="hud-label">{now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>
    </div>
  )
}
