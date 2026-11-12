// Quick actions (task 045): user-chosen buttons, per widget instance. Each button runs one
// action: hand a skill off to a new session, open a tool tab, perform a Helm function, or
// start a local app from the server-side allowlist (by id only; the server holds the command).
import { useState } from 'react'
import { Button, Icon, cx, type IconName } from '@helm/ui'
import { ICON_NAMES, type ItemField, type ListItem, type SettingField } from '@usetdt/helm-sdk'
import { server } from '@helm/client'
import { useWidgetHost } from '../host'
import { useToolTypes } from '../sandbox'
import s from './widgets.module.css'

const FUNCTIONS = [
  { value: 'new-session', label: 'New session', hint: 'Start a chat' },
  { value: 'open-brain', label: 'Open brain', hint: 'Graph & search' },
  { value: 'design-system', label: 'Design system', hint: 'Tokens & parts' },
  { value: 'settings', label: 'Settings', hint: 'Theme & effects' },
  { value: 'connections', label: 'Connections', hint: 'Services & servers' },
] as const
type HelmFunction = (typeof FUNCTIONS)[number]['value']

const SKILL = /^\/?[A-Za-z0-9][A-Za-z0-9_:.-]{0,127}$/

const buttonFields: ItemField[] = [
  { id: 'kind', type: 'select', label: 'Action', required: true, default: 'skill', options: [
    { value: 'skill', label: 'Run a skill (hands off to a new session)' },
    { value: 'tool', label: 'Open a tool' },
    { value: 'function', label: 'Helm function' },
    { value: 'app', label: 'Start a local app' },
  ] },
  { id: 'label', type: 'text', label: 'Label', required: true, maxLength: 40 },
  { id: 'icon', type: 'select', label: 'Icon', default: 'spark', options: ICON_NAMES.map((n) => n) },
  { id: 'skill', type: 'text', label: 'Skill', required: true, when: { field: 'kind', is: 'skill' }, placeholder: 'tdt-review-brain', maxLength: 129,
    pattern: SKILL.source, help: 'An installed skill, or any skill name your agent knows.',
    suggestions: { from: 'connection', connection: 'tdt', call: 'tdt_skill_list' } },
  { id: 'args', type: 'text', label: 'Arguments', when: { field: 'kind', is: 'skill' }, maxLength: 500, placeholder: 'Optional' },
  { id: 'project', type: 'select', label: 'Project', when: { field: 'kind', is: 'skill' }, help: 'Optional: its registered id goes to the skill as the first argument, as Build does.',
    options: { from: 'connection', connection: 'tdt', call: 'tdt_project_list' } },
  { id: 'tool', type: 'select', label: 'Tool', required: true, when: { field: 'kind', is: 'tool' },
    options: { from: 'connection', connection: 'helm', call: 'tools' } },
  { id: 'action', type: 'select', label: 'Function', required: true, when: { field: 'kind', is: 'function' }, options: FUNCTIONS.map(({ value, label }) => ({ value, label })) },
  { id: 'app', type: 'select', label: 'App', required: true, when: { field: 'kind', is: 'app' }, help: 'Apps you allow in Settings → Local apps.',
    options: { from: 'connection', connection: 'helm', call: 'local-apps' } },
]

/** Today's six buttons: what a new instance (and every dashboard saved before 045) shows. */
const DEFAULT_BUTTONS: ListItem[] = [
  { kind: 'function', label: 'New session', icon: 'chat', action: 'new-session' },
  { kind: 'function', label: 'Open brain', icon: 'brain', action: 'open-brain' },
  { kind: 'skill', label: 'Review brain', icon: 'check', skill: 'tdt-review-brain' },
  { kind: 'skill', label: 'Reminders', icon: 'calendar', skill: 'tdt-check-reminders' },
  { kind: 'function', label: 'Design system', icon: 'layers', action: 'design-system' },
  { kind: 'function', label: 'Settings', icon: 'cog', action: 'settings' },
]

export const quickActionSettings: SettingField[] = [
  { id: 'buttons', type: 'list', label: 'Buttons', addLabel: 'Add button', max: 24, fields: buttonFields, default: DEFAULT_BUTTONS },
]

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function QuickActionsWidget({ buttons, openSettings }: { buttons: ListItem[]; openSettings?: () => void }) {
  const host = useWidgetHost()
  const tools = useToolTypes()
  const [status, setStatus] = useState<{ ok: boolean; text: string }>()

  if (!buttons.length)
    return (
      <div className={s.quickEmpty}>
        <p className={s.muted}>No buttons yet.</p>
        {openSettings && <Button size="sm" icon="plus" onClick={openSettings}>Add buttons</Button>}
      </div>
    )

  const plan = (b: ListItem): { hint: string; run?: () => void | Promise<void> } => {
    switch (b.kind) {
      case 'skill': {
        const skill = str(b.skill).replace(/^\//, '')
        if (!SKILL.test(skill)) return { hint: 'No skill set' }
        const project = host.projects.find((p) => p.id === str(b.project))
        const args = str(b.args).trim().replace(/[\r\n]+/g, ' ')
        const prompt = ['/' + skill, project?.id, args].filter(Boolean).join(' ')
        const hint = ['/' + skill, args].filter(Boolean).join(' ') + (project ? ` · ${project.name}` : '')
        if (b.project && !project) return { hint: host.projects.length ? 'Project not found' : 'Loading…' }
        return { hint, run: () => host.handoff(prompt, project?.id) }
      }
      case 'tool': {
        const tool = tools.find(str(b.tool))
        if (!tool) return { hint: tools.loading ? 'Loading…' : 'Tool not installed' }
        return { hint: tool.name, run: () => host.openTool(tool.type, tool.name) }
      }
      case 'function': {
        const fn = FUNCTIONS.find((f) => f.value === b.action)
        const run: Record<HelmFunction, () => void> = {
          'new-session': () => host.startChat(),
          'open-brain': () => host.openGraph(),
          'design-system': host.openDesign,
          settings: host.openSettings,
          connections: host.openConnections,
        }
        return fn ? { hint: fn.hint, run: run[fn.value] } : { hint: 'Unknown function' }
      }
      case 'app': {
        const id = str(b.app)
        if (!id) return { hint: 'No app set' }
        return {
          hint: 'Local app',
          run: async () => {
            if (!host.online) return setStatus({ ok: false, text: 'Starting a local app needs the Helm server.' })
            setStatus(undefined)
            try {
              const r = await server.launchLocalApp(id)
              setStatus({ ok: true, text: `Started ${r.name}` })
            } catch (e) {
              setStatus({ ok: false, text: (e as Error).message })
            }
          },
        }
      }
      default:
        return { hint: 'Unknown action' }
    }
  }

  return (
    <div className={s.quickWrap}>
      <div className={s.quick}>
        {buttons.map((b, i) => {
          const p = plan(b)
          const icon = (ICON_NAMES as readonly string[]).includes(str(b.icon)) ? (b.icon as IconName) : 'spark'
          return (
            <button key={i} className={cx(s.quickTile, !p.run && s.quickOff)} disabled={!p.run} onClick={() => void p.run?.()}>
              <Icon name={icon} size={18} />
              <span className={s.quickLabel}>{str(b.label) || 'Untitled'}</span>
              <span className={s.quickHint}>{p.hint}</span>
            </button>
          )
        })}
      </div>
      <p className={status?.ok === false ? s.quickError : s.quickHint} role="status">{status?.text}</p>
    </div>
  )
}
