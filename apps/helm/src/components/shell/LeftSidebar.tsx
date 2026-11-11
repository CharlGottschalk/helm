import { useEffect, useRef, useState, type FormEvent } from 'react'
import { cx } from '../../lib/util'
import { offline, server, useServer, type Loaded, type TdtProject, type Workspace } from '@helm/client'
import { useToolTypes } from '@helm/widgets'
import { useChromeTheme, useHelm } from '../../state/store'
import { Icon, StatusDot, type IconName } from '@helm/ui'
import { Logo } from './Logo'
import s from './LeftSidebar.module.css'

const { statusTone } = offline

const availabilityTone = { available: 'green', 'missing or moved': 'amber', archived: 'neutral' } as const

export function LeftSidebar() {
  const { state, online, serverStatus, ws, projects, projectsLoad, activeTab, actions } = useHelm()
  const { all: toolTypes } = useToolTypes()
  const collapsed = state.leftCollapsed
  const chrome = useChromeTheme()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  /** New workspace terminal; offline opens a tab explaining how to start the server. */
  const openTerminal = async () => {
    const target = server.online ? { id: state.wsId } : undefined
    if (!target) return actions.openTerminal('offline')
    try {
      const t = await server.spawnTerminal(target.id)
      actions.openTerminal(t.id, 'Terminal')
    } catch {
      actions.openTerminal('offline')
    }
  }

  const register = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    const p = actions.addProject(draft.trim())
    actions.openProject(p)
    setDraft('')
    setAdding(false)
  }

  return (
    <aside className={cx(s.sidebar, collapsed && s.collapsed)} aria-label="Workspace navigation" data-theme={chrome}>
      <div className={s.brand} title={`Helm ${__HELM_VERSION__} · beta`}>
        <Logo />
        <div className={s.brandText}>
          <span className={s.brandName}>HELM</span>
          <span className={s.brandSub}>neural workspace</span>
          <span className={s.brandSub}>v{__HELM_VERSION__} · beta</span>
        </div>
        <button className={s.collapseBtn} onClick={actions.toggleLeft} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name={collapsed ? 'chevR' : 'chevL'} size={14} />
        </button>
      </div>

      <WorkspaceSwitcher collapsed={collapsed} />

      <nav className={s.group}>
        <div className={s.groupLabel}>Navigate</div>
        <NavItem icon="grid" label="Command deck" active={activeTab.kind === 'dashboard'} collapsed={collapsed} onClick={actions.openDashboard} />
        <NavItem icon="brain" label="Brain" active={activeTab.kind === 'graph'} collapsed={collapsed} onClick={() => actions.openGraph()} />
      </nav>

      <nav className={s.group} aria-label="Tools">
        <div className={s.groupLabel}>Tools</div>
        {toolTypes.map((t) => (
          <NavItem
            key={t.type}
            icon={t.icon}
            label={t.name}
            active={activeTab.kind === 'tool' && state.tools[activeTab.refId!]?.type === t.type}
            collapsed={collapsed}
            onClick={() => actions.openTool(t.type, t.name, { multi: false })}
          />
        ))}
        <NavItem icon="keyboard" label="Terminal" active={activeTab.kind === 'terminal'} collapsed={collapsed} onClick={openTerminal} />
      </nav>

      <div className={cx(s.group, s.projects)}>
        <div className={s.groupLabel}>
          Projects <span className={s.count}>{projects.length.toString().padStart(2, '0')}</span>
          <button
            className={s.addBtn}
            onClick={() => setAdding((a) => !a)}
            disabled={online}
            title={online ? 'Register projects with /tdt-add-project (Helm is read-only)' : 'Register project'}
          >
            <Icon name={adding ? 'x' : 'plus'} size={12} />
          </button>
        </div>
        {adding && !collapsed && (
          <form onSubmit={register} className={s.addForm}>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Project name ↵" onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          </form>
        )}
        {!collapsed && online && <ProjectsState ws={ws} load={projectsLoad} empty={projects.length === 0} />}
        <ul className={s.projectList}>
          {projects.map((p) => {
            const active = activeTab.kind === 'project' && activeTab.refId === p.id
            return (
              <li key={p.id}>
                <button className={cx(s.projectItem, active && s.active)} onClick={() => actions.openProject(p)} title={p.path ? `${p.path} · ${p.availability}` : p.name}>
                  <span className={s.projectCode}>{p.code.slice(0, 2)}</span>
                  <span className={s.projectName}>{p.name}</span>
                  {p.availability ? (
                    <StatusDot tone={availabilityTone[p.availability]} pulse={p.availability === 'missing or moved'} />
                  ) : (
                    <StatusDot tone={statusTone[p.status]} pulse={p.status === 'at-risk'} />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className={s.footer}>
        <span className={s.avatar}>OP</span>
        <div className={s.footerText}>
          <span className={s.footerName}>Operator</span>
          <span className={s.footerStatus}>
            {serverStatus === 'online' ? (
              <><StatusDot tone="green" /> Online · {ws.kind}</>
            ) : serverStatus === 'connecting' ? (
              <><StatusDot tone="cyan" pulse /> Connecting…</>
            ) : (
              <><StatusDot tone="amber" /> Offline · sample data</>
            )}
          </span>
        </div>
        <button className={s.settingsBtn} onClick={actions.openSettings} title="Settings (Ctrl+,)" aria-label="Open settings">
          <Icon name="cog" size={16} />
        </button>
      </div>
    </aside>
  )
}

/** Loading / error / empty notes for the live project list. */
function ProjectsState({ ws, load, empty }: { ws: Workspace; load?: Loaded<TdtProject[]>; empty: boolean }) {
  const { workspaces } = useServer()
  if (ws.id === 'none') return <p className={s.railNote}>No workspaces configured. Add one to Helm's config.json (see Configuration in the docs).</p>
  if (workspaces.find((w) => w.id === ws.id)?.tdt === false) return <p className={s.railNote} role="alert">This folder has no TDT harness (.tdt/config.json).</p>
  if (!load) return null
  if (load.loading && empty) return <p className={s.railNote}>Loading projects…</p>
  if (load.error)
    return (
      <div className={s.railNote} role="alert">
        <span>{load.error.message}</span>
        {load.error.retry !== 'inspect_outcome' && (
          <button className={s.railRetry} onClick={load.reload}>Retry</button>
        )}
      </div>
    )
  if (empty) return <p className={s.railNote}>No projects registered. Use /tdt-add-project.</p>
  return null
}

function NavItem({ icon, label, active, collapsed, onClick }: { icon: IconName; label: string; active: boolean; collapsed: boolean; onClick: () => void }) {
  return (
    <button className={cx(s.navItem, active && s.active)} onClick={onClick} title={collapsed ? label : undefined}>
      <Icon name={icon} size={16} />
      <span className={s.navLabel}>{label}</span>
    </button>
  )
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { ws, workspaces, actions } = useHelm()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className={s.switcher} ref={ref}>
      <button className={cx(s.wsButton, open && s.open)} onClick={() => setOpen((o) => !o)} title={collapsed ? ws.name : undefined} aria-expanded={open}>
        <span className={s.wsGlyph} data-tone={ws.tone}>{ws.code}</span>
        <span className={s.wsText}>
          <span className={s.wsName}>{ws.name}</span>
          <span className={s.wsKind}>{ws.kind}</span>
        </span>
        <Icon name="chevD" size={14} className={s.wsChevron} />
      </button>
      {open && (
        <div className={cx(s.wsMenu, collapsed && s.wsMenuFloating)} role="menu">
          <div className={s.groupLabel}>Switch workspace</div>
          {workspaces.map((w, i) => (
            <button
              key={w.id}
              role="menuitem"
              className={cx(s.wsOption, w.id === ws.id && s.active)}
              onClick={() => {
                actions.setWorkspace(w.id)
                setOpen(false)
              }}
            >
              <span className={s.wsGlyph} data-tone={w.tone}>{w.code}</span>
              <span className={s.wsText}>
                <span className={s.wsName}>{w.name}</span>
                <span className={s.wsKind}>{w.kind}</span>
              </span>
              <span className={s.wsKey}>{w.id === ws.id ? <Icon name="check" size={14} /> : `⌥${i + 1}`}</span>
            </button>
          ))}
          <button className={cx(s.wsOption, s.wsCreate)} disabled>
            <Icon name="plus" size={14} /> New workspace
          </button>
        </div>
      )}
    </div>
  )
}
