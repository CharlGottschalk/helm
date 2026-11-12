// Built-in widget types. Each entry follows contracts/widget.md; `settings` follows
// contracts/settings.md and is rendered by the generic SettingsForm.
import type { ReactNode } from 'react'
import type { IconName } from '@helm/ui'
import type { ConnectionDecl, ListItem, SettingField, SettingValues, WidgetCapability, WidgetCategory } from '@usetdt/helm-sdk'
import { FocusTimerWidget } from './focusTimer'
import { QuickActionsWidget, quickActionSettings } from './quickActions'
import { LiveActivityWidget, LiveAgentRunsWidget, LiveBrainRadarWidget, LiveCalendarWidget, LiveHealthWidget, LiveKpiWidget, LiveNotesWidget, LiveProjectSpotlightWidget, LiveSessionsWidget, LiveReviewQueueWidget, LiveStacksWidget, LiveRelaysWidget, LiveInterviewsWidget } from './live'
import { useWidgetHost } from '../host'
import type { ComponentType } from 'react'

export type { WidgetCategory } from '@usetdt/helm-sdk'
export const categories: WidgetCategory[] = ['Overview', 'Work', 'Knowledge', 'Agents', 'Utility']

export interface WidgetType {
  type: string
  title: string
  code: string
  icon: IconName
  category: WidgetCategory
  description: string
  w: number
  h: number
  minW: number
  minH: number
  /** several instances allowed (each with its own settings) */
  multi?: boolean
  settings?: SettingField[]
  /** data the widget will read once repurposed onto live sources (contracts/connection.md) */
  connections?: ConnectionDecl[]
  /** sandboxed widgets: "orchestrate" when they start builds */
  capabilities?: WidgetCapability[]
  /** where a sandboxed extension came from ("stack tdt-helm", "work/helm"); absent for built-ins */
  sandboxed?: string
  render: (item: { id: string }, settings: SettingValues, ctx?: { openSettings: () => void }) => ReactNode
}

/** Live-only widgets: offline there is no sample source, so they say what they need. */
function needsServer<P extends object>(Live: ComponentType<P>) {
  return function LiveOnly(props: P) {
    return useWidgetHost().online ? <Live {...props} /> : <p className="hud-label">Live TDT data · start the Helm server</p>
  }
}
const Kpi = needsServer(LiveKpiWidget)
const Health = needsServer(LiveHealthWidget)
const Activity = needsServer(LiveActivityWidget)
const Calendar = needsServer(LiveCalendarWidget)
const Spotlight = needsServer(LiveProjectSpotlightWidget)
const Notes = needsServer(LiveNotesWidget)
const Radar = needsServer(LiveBrainRadarWidget)
const Runs = needsServer(LiveAgentRunsWidget)
const Sessions = needsServer(LiveSessionsWidget)
const ReviewQueue = needsServer(LiveReviewQueueWidget)
const Stacks = needsServer(LiveStacksWidget)
const Relays = needsServer(LiveRelaysWidget)
const Interviews = needsServer(LiveInterviewsWidget)

/** The TDT connection every built-in can declare; operations are the allowlist. */
const tdt = (...operations: string[]): ConnectionDecl => ({ id: 'tdt', kind: 'tdt-mcp', operations })

const projectSetting: SettingField = {
  id: 'projectId', type: 'select', label: 'Project', required: true,
  options: { from: 'connection', connection: 'tdt', call: 'tdt_project_list' },
}

export const widgetTypes: WidgetType[] = [
  { type: 'kpis', title: 'Telemetry', code: 'W-00', icon: 'pulse', category: 'Overview', description: 'Headline numbers: active projects, pending reviews, sessions and brain size.', w: 6, h: 2, minW: 2, minH: 2,
    connections: [tdt('tdt_workspace_status', 'tdt_brain_audit')], render: () => <Kpi /> },
  { type: 'health', title: 'Workspace health', code: 'W-01', icon: 'target', category: 'Overview', description: 'Project availability, pending reviews and captures, and interrupted-operation warnings.', w: 2, h: 5, minW: 2, minH: 3,
    connections: [tdt('tdt_workspace_status')], render: () => <Health /> },
  { type: 'activity', title: 'Activity', code: 'W-05', icon: 'clock', category: 'Overview', description: 'Timeline of what changed across the workspace.', w: 2, h: 4, minW: 1, minH: 2,
    connections: [tdt('tdt_capture_requests', 'tdt_reminder_list', 'tdt_project_list')], render: () => <Activity /> },
  { type: 'relays', title: 'Relays', code: 'W-15', icon: 'link', category: 'Work', description: 'Open requests between linked projects. Open one to read it; close relays in chat with /tdt-relay.', w: 2, h: 4, minW: 2, minH: 3,
    settings: [
      { ...projectSetting, required: false, help: 'Relays to or from this project. Leave empty for all.' },
      { id: 'status', type: 'select', label: 'Show', options: [{ value: 'open', label: 'Open relays' }, { value: 'all', label: 'All relays' }], default: 'open' },
      { id: 'limit', type: 'number', label: 'Show at most', min: 1, max: 30, step: 1, default: 8, unit: 'relays' },
    ],
    connections: [tdt('tdt_project_list', 'tdt_relay_list', 'tdt_relay_read')],
    render: (_i, s) => <Relays projectId={(s.projectId as string) || undefined} status={s.status as 'open' | 'all'} limit={s.limit as number} /> },
  { type: 'interviews', title: 'Waiting interviews', code: 'W-16', icon: 'chat', category: 'Work', description: 'TDT interviews waiting for your answers. Open resumes one in a new tab (everyday profile).', w: 2, h: 3, minW: 2, minH: 3,
    settings: [{ id: 'limit', type: 'number', label: 'Show at most', min: 1, max: 20, step: 1, default: 6, unit: 'interviews' }],
    connections: [tdt('tdt_ui_sessions')],
    render: (_i, s) => <Interviews limit={s.limit as number} /> },
  { type: 'calendar', title: 'Calendar', code: 'W-02', icon: 'calendar', category: 'Work', description: 'Month view of TDT reminders by due date, with the selected day’s agenda.', w: 2, h: 5, minW: 2, minH: 4,
    connections: [tdt('tdt_reminder_list')], render: () => <Calendar /> },
  { type: 'spotlight', title: 'Project spotlight', code: 'W-08', icon: 'folder', category: 'Work', description: 'One project at a glance: availability, path and references. Add one per project.', w: 2, h: 4, minW: 2, minH: 4, multi: true,
    settings: [projectSetting], connections: [tdt('tdt_project_list', 'tdt_project_read', 'tdt_project_references')],
    render: (_i, s) => <Spotlight projectId={s.projectId as string | undefined} /> },
  { type: 'timer', title: 'Focus timer', code: 'W-09', icon: 'bolt', category: 'Work', description: 'Focus, deep-work and break countdowns on a dial.', w: 2, h: 4, minW: 2, minH: 4,
    settings: [{ id: 'focusMinutes', type: 'number', label: 'Focus length', min: 5, max: 120, step: 5, default: 25, unit: 'min' }],
    render: (_i, s) => <FocusTimerWidget key={String(s.focusMinutes)} focusMinutes={s.focusMinutes as number} /> },
  { type: 'notes', title: 'Notes', code: 'W-04', icon: 'note', category: 'Knowledge', description: 'Scratchpad notes and approved knowledge, with quick capture via /tdt-note.', w: 4, h: 4, minW: 2, minH: 2,
    settings: [
      { id: 'show', type: 'select', label: 'Show', options: [{ value: 'all', label: 'Notes and knowledge' }, { value: 'note', label: 'Scratchpad notes only' }, { value: 'doc', label: 'Knowledge only' }], default: 'all' },
      { id: 'tag', type: 'text', label: 'Only this tag', placeholder: 'e.g. memory', help: 'Scratchpad tag filter. Leave empty for all notes.', maxLength: 64 },
      { id: 'limit', type: 'number', label: 'Show at most', min: 1, max: 30, step: 1, default: 12, unit: 'notes' },
    ],
    connections: [tdt('tdt_note_list', 'tdt_brain_audit')],
    render: (_i, s) => <Notes show={s.show as 'all' | 'note' | 'doc'} tag={s.tag as string | undefined} limit={s.limit as number} /> },
  { type: 'review', title: 'Review queue', code: 'W-12', icon: 'check', category: 'Knowledge', description: 'Pending knowledge candidates. Open one to read it, or hand off /tdt-review-brain.', w: 2, h: 4, minW: 2, minH: 3,
    settings: [{ id: 'limit', type: 'number', label: 'Show at most', min: 1, max: 30, step: 1, default: 8, unit: 'candidates' }],
    connections: [tdt('tdt_candidate_list', 'tdt_candidate_read')],
    render: (_i, s) => <ReviewQueue limit={s.limit as number} /> },
  { type: 'radar', title: 'Brain radar', code: 'W-10', icon: 'brain', category: 'Knowledge', description: 'Radar sweep of the workspace brain with counts by kind.', w: 3, h: 4, minW: 2, minH: 3,
    connections: [tdt('tdt_brain_audit', 'tdt_workspace_status', 'tdt_note_list')], render: () => <Radar /> },
  { type: 'runs', title: 'Agent runs', code: 'W-06', icon: 'spark', category: 'Agents', description: 'Live Helm agent sessions and pending knowledge captures.', w: 2, h: 3, minW: 2, minH: 2,
    connections: [tdt('tdt_capture_requests')], render: () => <Runs /> },
  { type: 'sessions', title: 'Recent sessions', code: 'W-07', icon: 'chat', category: 'Agents', description: 'Latest agent sessions in this workspace. Click to reopen in a tab.', w: 2, h: 4, minW: 2, minH: 3, render: () => <Sessions /> },
  { type: 'stacks', title: 'Stacks & skills', code: 'W-14', icon: 'hex', category: 'Utility', description: 'Installed stacks with an on-demand marketplace update check, and pending skill proposals.', w: 2, h: 4, minW: 2, minH: 3,
    connections: [tdt('tdt_stack_list', 'tdt_skill_proposals', 'tdt_marketplace_read')], render: () => <Stacks /> },
  // works offline (shell actions and hand-offs); local apps need the server
  { type: 'quick', title: 'Quick actions', code: 'W-11', icon: 'grid', category: 'Utility', description: 'Buttons you choose: run a skill in a new session, open a tool, a Helm function or a local app. Add one per set of buttons.', w: 3, h: 3, minW: 2, minH: 2, multi: true,
    settings: quickActionSettings, connections: [tdt('tdt_skill_list', 'tdt_project_list')],
    render: (_i, s, ctx) => <QuickActionsWidget buttons={(s.buttons as ListItem[] | undefined) ?? []} openSettings={ctx?.openSettings} /> },
]

export const widgetType = (type: string) => widgetTypes.find((t) => t.type === type)
