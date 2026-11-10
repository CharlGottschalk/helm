import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Icon, Input, Panel } from '@helm/ui'
import { typeOf, type GridItem } from '../../lib/gridLayout'
import { cx } from '../../lib/util'
import { requiredMissing, resolveSettings } from '@usetdt/helm-sdk'
import { categories, useWidgetTypes, type WidgetCategory, type WidgetType } from '@helm/widgets'
import s from './WidgetLibrary.module.css'

// preview renders the real widget at dashboard scale, then shrinks it to fit the card
const COL_W = 190
const ROW_H = 76
const GAP = 14
const PREVIEW_W = 392
const PREVIEW_MAX_H = 180

interface Props {
  layout: GridItem[]
  onAdd: (type: string) => void
  onClose: () => void
}

export function WidgetLibrary({ layout, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<WidgetCategory | 'All'>('All')
  const searchRef = useRef<HTMLInputElement>(null)
  const { all: widgetTypes, errors } = useWidgetTypes()

  useEffect(() => {
    searchRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onDeck = useMemo(() => new Set(layout.map(typeOf)), [layout])
  const q = query.trim().toLowerCase()
  const shown = widgetTypes.filter(
    (t) => (category === 'All' || t.category === category) && (!q || `${t.title} ${t.description} ${t.category}`.toLowerCase().includes(q)),
  )
  const groups = categories.map((c) => [c, shown.filter((t) => t.category === c)] as const).filter(([, list]) => list.length)

  return (
    <div className={s.layer}>
      <div className={s.backdrop} onClick={onClose} />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-labelledby="library-title">
        <header className={s.header}>
          <span className={s.marker} />
          <h2 id="library-title" className={s.title}>Widget library</h2>
          <span className={s.count}>{widgetTypes.length} widgets</span>
          <button className={s.close} onClick={onClose} aria-label="Close widget library">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className={s.filters}>
          <Input ref={searchRef} icon="search" placeholder="Search widgets…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className={s.chips} role="tablist" aria-label="Category">
            {(['All', ...categories] as const).map((c) => (
              <button key={c} role="tab" aria-selected={category === c} className={cx(s.chip, category === c && s.chipOn)} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={s.list}>
          {errors.length > 0 && (
            <section className={s.errors} role="alert" aria-label="Extensions that could not be loaded">
              <div className={s.groupLabel}>
                Not loaded · {errors.length}
                <span className={s.rule} />
              </div>
              {errors.map((e) => (
                <p key={e.key} className={s.error}>
                  <code>{e.path}</code>
                  <span>{e.message}</span>
                </p>
              ))}
            </section>
          )}
          {groups.length === 0 && <p className={s.none}>No widgets match “{query}”.</p>}
          {groups.map(([cat, list]) => (
            <section key={cat} className={s.group}>
              <div className={s.groupLabel}>
                {cat}
                <span className={s.rule} />
              </div>
              {list.map((t) => (
                <WidgetCard key={t.type} t={t} added={!t.multi && onDeck.has(t.type)} onAdd={onAdd} />
              ))}
            </section>
          ))}
        </div>
      </aside>
    </div>
  )
}

function WidgetCard({ t, added, onAdd }: { t: WidgetType; added: boolean; onAdd: Props['onAdd'] }) {
  // previews render with default settings; widgets with required settings ask for them on Add
  const settings = resolveSettings(t.settings)
  const needsSetup = requiredMissing(t.settings, settings)

  const fullW = t.w * COL_W + (t.w - 1) * GAP
  const fullH = t.h * ROW_H + (t.h - 1) * GAP
  const scale = Math.min(PREVIEW_W / fullW, PREVIEW_MAX_H / fullH)

  return (
    <article className={cx(s.card, added && s.cardAdded)}>
      <div className={s.preview} style={{ height: fullH * scale }}>
        <div
          className={s.previewInner}
          style={{ width: fullW, height: fullH, marginLeft: -(fullW * scale) / 2, transform: `scale(${scale})` }}
          aria-hidden="true"
          {...{ inert: '' }}
        >
          <Panel title={t.title} code={`${t.code} · ${t.w}×${t.h}`} className={s.previewPanel}>
            {/* sandboxed extensions don't run until added to the deck */}
            {t.sandboxed ? <p className={s.sandboxNote}>Sandboxed · {t.sandboxed}</p> : t.render({ id: `preview-${t.type}` }, settings)}
          </Panel>
        </div>
      </div>
      <div className={s.meta}>
        <div className={s.metaTop}>
          <Icon name={t.icon} size={15} />
          <h3>{t.title}</h3>
          <Badge tone="neutral">{t.w}×{t.h}</Badge>
          {t.multi && <Badge tone="violet">Multi</Badge>}
          {t.sandboxed && <Badge tone="blue">{t.sandboxed}</Badge>}
          {!!t.settings?.length && <Badge tone="neutral">{t.settings.length} settings</Badge>}
        </div>
        <p>{t.description}</p>
        <div className={s.metaActions}>
          {added ? (
            <span className={s.onDeck}>
              <Icon name="check" size={13} stroke={2.2} /> On deck
            </span>
          ) : (
            <Button size="sm" variant="primary" icon={needsSetup ? 'sliders' : 'plus'} onClick={() => onAdd(t.type)}>
              {needsSetup ? 'Configure & add' : 'Add'}
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
