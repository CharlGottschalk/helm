import { useEffect, useState } from 'react'
import { Badge, Button, Icon, Input, Meter, Panel, RadialGauge, Sparkline, StatusDot, type IconName } from '@helm/ui'
import { Logo } from '../../components/shell/Logo'
import { spaceScale, swatches, themes, typeScale, type Tone } from '@helm/ui'
import { useHelm } from '../../state/store'
import s from './DesignSystem.module.css'

const tones: Tone[] = ['cyan', 'amber', 'red', 'green', 'violet', 'blue', 'neutral']
const icons: IconName[] = ['grid', 'brain', 'layers', 'folder', 'chat', 'search', 'calendar', 'note', 'doc', 'pulse', 'bolt', 'user', 'clock', 'target', 'spark', 'link', 'sliders', 'focus', 'drag', 'hex']

export function DesignSystem() {
  const { state, actions } = useHelm()
  const [meter, setMeter] = useState(64)
  const theme = themes.find((t) => t.id === state.settings.theme) ?? themes[0]

  // read the computed value of every swatch token for the active theme
  const [resolved, setResolved] = useState<Record<string, string>>({})
  useEffect(() => {
    // wait for the theme cross-fade to settle before sampling
    const t = window.setTimeout(() => {
      const cs = getComputedStyle(document.documentElement)
      const next: Record<string, string> = {}
      for (const g of swatches) for (const c of g.items) next[c.css] = cs.getPropertyValue(c.css).trim()
      setResolved(next)
    }, 50)
    return () => window.clearTimeout(t)
  }, [theme.id])

  return (
    <div className={s.scroll}>
      <header className={s.header}>
        <Logo size={44} />
        <div>
          <span className="hud-label">Lumen · Helm design system · v0.2 · theme: {theme.name}</span>
          <h1 className={s.title}>Design system</h1>
          <p className={s.lede}>
            {theme.tagline} Every component reads from the same tokens, so a theme changes hues, surfaces, shape and motion without touching a component. Cyan is always the primary signal, amber means attention, red is critical.
          </p>
          <Button size="sm" icon="cog" className={s.themeBtn} onClick={actions.openSettings}>
            Switch theme
          </Button>
        </div>
      </header>

      <Section n="01" title="Colour">
        {swatches.map((g) => (
          <div key={g.group} className={s.swatchGroup}>
            <span className="hud-label">{g.group}</span>
            <div className={s.swatches}>
              {g.items.map((c) => (
                <div key={c.css} className={s.swatch}>
                  <span className={s.chip} style={{ background: `var(${c.css})` }} />
                  <span className={s.swatchName}>{c.name}</span>
                  <code>{c.css}</code>
                  <code className={s.dim}>{resolved[c.css]}</code>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section n="02" title="Typography">
        <div className={s.families}>
          <div><span className="hud-label">Display</span><span className={s.famDisplay}>Rajdhani</span><p>Titles, numbers, buttons. Uppercase with tracking for HUD labels.</p></div>
          <div><span className="hud-label">Body</span><span className={s.famBody}>Inter</span><p>Reading text, chat messages, descriptions.</p></div>
          <div><span className="hud-label">Mono</span><span className={s.famMono}>JetBrains Mono</span><p>Codes, telemetry, timestamps and micro-labels.</p></div>
        </div>
        <div className={s.typeScale}>
          {typeScale.map((t) => (
            <div key={t.token} className={s.typeRow}>
              <code>{t.token}</code>
              <span className={s.dim}>{t.px}px</span>
              <span style={{ fontSize: t.px, fontFamily: `var(--font-${t.family})` }} className={s.typeSample}>
                {t.sample}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section n="03" title="Space, shape & grid">
        <div className={s.spaceRow}>
          {spaceScale.map((px, i) => (
            <div key={px} className={s.space}>
              <span style={{ width: px, height: px }} />
              <code>--sp-{[1, 2, 3, 4, 5, 6, 8, 10][i]}</code>
              <span className={s.dim}>{px}px</span>
            </div>
          ))}
        </div>
        <div className={s.shapes}>
          <div className={s.shapeDemo}>
            <div className={s.bracketBox} />
            <span>Corner brackets · panels</span>
          </div>
          <div className={s.shapeDemo}>
            <div className={s.cutBox} />
            <span>Cut corners · primary actions</span>
          </div>
          <div className={s.shapeDemo}>
            <div className={s.hexBox} />
            <span>Hex · identity (avatars, codes)</span>
          </div>
          <div className={s.shapeDemo}>
            <div className={s.gridDemo}>
              {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
            </div>
            <span>Dashboard · 6 cols × 76px rows · 14px gap</span>
          </div>
        </div>
      </Section>

      <Section n="04" title="Components">
        <div className={s.components}>
          <Panel title="Buttons" code="C-01">
            <div className={s.row}>
              <Button variant="primary" icon="bolt">Engage</Button>
              <Button icon="brain">Ghost</Button>
              <Button variant="subtle" icon="sliders">Subtle</Button>
              <Button variant="danger" icon="x">Abort</Button>
            </div>
            <div className={s.row}>
              <Button variant="primary" size="sm">Small</Button>
              <Button size="sm">Small</Button>
              <Button iconOnly icon="plus" aria-label="Add" />
              <Button variant="primary" disabled>Disabled</Button>
            </div>
          </Panel>

          <Panel title="Badges & status" code="C-02">
            <div className={s.row}>
              {tones.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}
            </div>
            <div className={s.row}>
              {tones.map((t) => (
                <span key={t} className={s.dotDemo}><StatusDot tone={t} pulse={t === 'amber'} /> {t}</span>
              ))}
            </div>
          </Panel>

          <Panel title="Meters & gauges" code="C-03">
            <div className={s.meters}>
              <RadialGauge value={meter} size={110} label="LOAD" tone={meter > 80 ? 'red' : meter > 60 ? 'amber' : 'cyan'} />
              <div className={s.meterStack}>
                <input type="range" min={0} max={100} value={meter} onChange={(e) => setMeter(+e.target.value)} className={s.range} aria-label="Demo value" />
                <Meter value={meter} />
                <Meter value={meter} tone="amber" segments={12} />
                <Meter value={meter} tone="green" segments={32} />
                <Sparkline data={[3, 5, 4, 7, 6, 9, 8, 11, 10, 13]} />
              </div>
            </div>
          </Panel>

          <Panel title="Inputs" code="C-04">
            <div className={s.col}>
              <Input icon="search" placeholder="Search the brain…" kbd="/" />
              <Input icon="chat" placeholder="Message Helm" />
            </div>
          </Panel>

          <Panel title="Iconography" code="C-05" className={s.wide}>
            <div className={s.icons}>
              {icons.map((n) => (
                <div key={n} className={s.icon}>
                  <Icon name={n} size={20} />
                  <code>{n}</code>
                </div>
              ))}
            </div>
            <p className={s.note}>24px grid · 1.6 stroke · square caps · miter joins. Icons take colour from text.</p>
          </Panel>

          <Panel title="Motion" code="C-06" className={s.wide}>
            <div className={s.motion}>
              {[
                ['--dur-fast', '120ms', 'Hover, press, toggles'],
                ['--dur-med', '220ms', 'Panels, menus, layout moves'],
                ['--dur-slow', '420ms', 'Entrances, sidebar collapse, gauges'],
              ].map(([t, v, use]) => (
                <div key={t} className={s.motionItem}>
                  <div className={s.motionTrack}><span style={{ animationDuration: `calc(${v} * 4)` }} /></div>
                  <code>{t}</code>
                  <span className={s.dim}>{v} · {use}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </Section>
    </div>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.sectionNum}>{n}</span>
        <h2>{title}</h2>
        <span className={s.rule} />
      </div>
      {children}
    </section>
  )
}
