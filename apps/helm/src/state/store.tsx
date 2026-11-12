import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { basename, offline, server, useLoad, useServer, type Note, type Project, type HostId, type ServerTheme, type ServerWorkspace, type TdtProject, type Workspace } from '@helm/client'
import type { Tone } from '@helm/ui'
import { chromeTheme, themes as builtinThemes, type ThemeId } from '@helm/ui'
import type { SettingValues } from '@usetdt/helm-sdk'
import type { GridItem } from '../lib/gridLayout'
import { uid } from '../lib/util'

const { projects: seedProjects } = offline

const WS_TONES: Tone[] = ['cyan', 'violet', 'amber', 'green', 'blue']

/** A server workspace (~/.helm/config.json) in the switcher's shape. */
const toWorkspace = (w: ServerWorkspace, i: number): Workspace => ({
  id: w.id,
  name: w.name,
  code: w.name.replace(/[^a-z0-9 ]/gi, '').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || 'WS',
  kind: w.tdt ? `TDT · ${w.profile}` : 'Not a TDT workspace',
  tone: WS_TONES[i % WS_TONES.length],
})

/**
 * A registered TDT project in the shell's Project shape. Health, progress and team
 * are prototype fields with no TDT source; neutral values until widgets move to
 * live data (task 005).
 */
const toProject = (wsId: string, p: TdtProject): Project => {
  const name = basename(p.path)
  return {
    id: p.id, wsId, name, code: name.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'PRJ',
    status: p.availability === 'available' ? 'active' : 'paused', health: 0, progress: 0,
    description: p.path, ownerId: '', teamIds: [], stack: [], path: p.path, availability: p.availability, created: p.created,
  }
}

/* ── types ─────────────────────────────────────────────── */
export type TabKind = 'dashboard' | 'chat' | 'graph' | 'project' | 'design' | 'tool' | 'terminal' | 'session' | 'record' | 'projectGraph'

/** A tabbed tool instance (contracts/tool.md); settings follow contracts/settings.md. */
export interface ToolInstance {
  id: string
  type: string
  wsId: string
  settings: SettingValues
}

export interface Tab {
  id: string
  kind: TabKind
  title: string
  refId?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'thinking' | 'streaming' | 'done'
  at: number
}

export interface Chat {
  id: string
  wsId: string
  title: string
  projectId?: string
  messages: Message[]
  updatedAt: number
}

interface TabSet {
  tabs: Tab[]
  activeId: string
}

export interface Settings {
  /** a built-in ThemeId, or a plugin theme key `<plugin>/<id>` */
  theme: ThemeId | (string & {})
  scanlines: boolean
  reduceMotion: boolean
  /** where chat hand-offs go */
  host: HostId
}

interface State {
  settings: Settings
  wsId: string
  tabSets: Record<string, TabSet>
  leftCollapsed: boolean
  rightCollapsed: boolean
  chats: Record<string, Chat>
  doneTasks: Record<string, boolean>
  userNotes: Note[]
  userProjects: Project[]
  graphQuery: string
  layouts: Record<string, GridItem[]>
  tools: Record<string, ToolInstance>
}

type Action =
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'workspace'; wsId: string }
  | { type: 'openTab'; tab: Tab }
  | { type: 'closeTab'; id: string }
  | { type: 'activateTab'; id: string }
  | { type: 'toggleLeft' }
  | { type: 'toggleRight' }
  | { type: 'upsertChat'; chat: Chat }
  | { type: 'pushMessage'; chatId: string; message: Message }
  | { type: 'patchMessage'; chatId: string; messageId: string; patch?: Partial<Message>; append?: string }
  | { type: 'toggleTask'; id: string }
  | { type: 'addNote'; note: Note }
  | { type: 'graphQuery'; query: string }
  | { type: 'layout'; wsId: string; layout: GridItem[] }
  | { type: 'tool'; tool: ToolInstance }

/* ── defaults ──────────────────────────────────────────── */
export const DASHBOARD_TAB: Tab = { id: 'dashboard', kind: 'dashboard', title: 'Command deck' }

export const DEFAULT_LAYOUT: GridItem[] = [
  { id: 'kpis', type: 'kpis', x: 0, y: 0, w: 6, h: 2 },
  { id: 'health', type: 'health', x: 0, y: 2, w: 2, h: 5 },
  { id: 'calendar', type: 'calendar', x: 2, y: 2, w: 2, h: 5 },
  { id: 'review', type: 'review', x: 4, y: 2, w: 2, h: 5 },
  { id: 'notes', type: 'notes', x: 0, y: 7, w: 4, h: 4 },
  { id: 'activity', type: 'activity', x: 4, y: 7, w: 2, h: 4 },
]

const H = 3_600_000
const t0 = Date.now()
const msg = (role: Message['role'], text: string, at: number): Message => ({ id: uid('m'), role, text, status: 'done', at })

const seedChats: Chat[] = [
  {
    id: 'c-eviction', wsId: 'ws-labs', title: 'Memory eviction strategy', projectId: 'pr-orion', updatedAt: t0 - 0.6 * H,
    messages: [
      msg('user', 'What are our options for evicting stale agent memory?', t0 - 0.7 * H),
      msg('assistant', 'Three options came up in the brain:\n\n- **Recency × relevance score**, from Kenji\'s note\n- **Pinned facts** that never expire\n- **Per-project budgets** so one project can\'t crowd out the rest\n\nThe scoring approach fits best with the current Orion event log.', t0 - 0.6 * H),
    ],
  },
  {
    id: 'c-atlas', wsId: 'ws-labs', title: 'Atlas duplicate chunks', projectId: 'pr-atlas', updatedAt: t0 - 3 * H,
    messages: [
      msg('user', 'Why is Atlas creating duplicate chunks?', t0 - 3.2 * H),
      msg('assistant', 'Dedup runs **after** embedding, so identical content from two sources is embedded twice. Moving the hash check before the embedder fixes it.', t0 - 3 * H),
    ],
  },
  {
    id: 'c-launch', wsId: 'ws-labs', title: 'Lumen launch checklist', projectId: 'pr-lumen', updatedAt: t0 - 26 * H,
    messages: [msg('user', 'Draft the Lumen v1 launch checklist', t0 - 26 * H), msg('assistant', 'Done: 12 items across docs, tokens, a11y and release notes.', t0 - 26 * H)],
  },
  {
    id: 'c-brand', wsId: 'ws-orbital', title: 'Halo logo directions', projectId: 'pr-halo', updatedAt: t0 - 2 * H,
    messages: [msg('user', 'Summarise feedback on the logo directions', t0 - 2 * H), msg('assistant', 'The client favours direction B and wants a warmer palette.', t0 - 2 * H)],
  },
  {
    id: 'c-thesis', wsId: 'ws-personal', title: 'Chapter 3 outline', projectId: 'pr-thesis', updatedAt: t0 - 5 * H,
    messages: [msg('user', 'Help me outline chapter 3', t0 - 5 * H), msg('assistant', 'Here\'s a five-section outline built around episodic replay.', t0 - 5 * H)],
  },
]

function initialState(): State {
  const base: State = {
    settings: { theme: 'hud', scanlines: true, reduceMotion: false, host: 'claude' },
    wsId: offline.workspaces[0].id,
    tabSets: {},
    leftCollapsed: false,
    rightCollapsed: false,
    chats: Object.fromEntries(seedChats.map((c) => [c.id, c])),
    doneTasks: {},
    userNotes: [],
    userProjects: [],
    graphQuery: '',
    layouts: {},
    tools: {},
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<State>
    const merged = { ...base, ...saved, settings: { ...base.settings, ...saved.settings } }
    // any reply interrupted by a reload is considered finished
    for (const chat of Object.values(merged.chats)) {
      for (const m of chat.messages) if (m.status !== 'done') m.status = 'done'
    }
    return merged
  } catch {
    return base
  }
}

const STORAGE_KEY = 'helm.state.v1'

const tabSetOf = (state: State, wsId = state.wsId): TabSet =>
  state.tabSets[wsId] ?? { tabs: [DASHBOARD_TAB], activeId: DASHBOARD_TAB.id }

function withTabSet(state: State, set: TabSet): State {
  return { ...state, tabSets: { ...state.tabSets, [state.wsId]: set } }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } }
    case 'workspace':
      return { ...state, wsId: action.wsId, graphQuery: '' }
    case 'openTab': {
      const set = tabSetOf(state)
      const exists = set.tabs.some((t) => t.id === action.tab.id)
      const tabs = exists ? set.tabs.map((t) => (t.id === action.tab.id ? action.tab : t)) : [...set.tabs, action.tab]
      return withTabSet(state, { tabs, activeId: action.tab.id })
    }
    case 'closeTab': {
      if (action.id === DASHBOARD_TAB.id) return state
      const set = tabSetOf(state)
      const idx = set.tabs.findIndex((t) => t.id === action.id)
      const tabs = set.tabs.filter((t) => t.id !== action.id)
      const activeId = set.activeId === action.id ? tabs[Math.max(0, idx - 1)].id : set.activeId
      return withTabSet(state, { tabs, activeId })
    }
    case 'activateTab':
      return withTabSet(state, { ...tabSetOf(state), activeId: action.id })
    case 'toggleLeft':
      return { ...state, leftCollapsed: !state.leftCollapsed }
    case 'toggleRight':
      return { ...state, rightCollapsed: !state.rightCollapsed }
    case 'upsertChat':
      return { ...state, chats: { ...state.chats, [action.chat.id]: action.chat } }
    case 'pushMessage': {
      const chat = state.chats[action.chatId]
      if (!chat) return state
      return {
        ...state,
        chats: { ...state.chats, [chat.id]: { ...chat, messages: [...chat.messages, action.message], updatedAt: Date.now() } },
      }
    }
    case 'patchMessage': {
      const chat = state.chats[action.chatId]
      if (!chat) return state
      const messages = chat.messages.map((m) =>
        m.id === action.messageId ? { ...m, ...action.patch, text: m.text + (action.append ?? '') } : m,
      )
      return { ...state, chats: { ...state.chats, [chat.id]: { ...chat, messages, updatedAt: Date.now() } } }
    }
    case 'toggleTask':
      return { ...state, doneTasks: { ...state.doneTasks, [action.id]: !state.doneTasks[action.id] } }
    case 'addNote':
      return { ...state, userNotes: [action.note, ...state.userNotes] }
    case 'graphQuery':
      return { ...state, graphQuery: action.query }
    case 'layout':
      return { ...state, layouts: { ...state.layouts, [action.wsId]: action.layout } }
    case 'tool':
      return { ...state, tools: { ...state.tools, [action.tool.id]: action.tool } }
  }
}

/* ── context ───────────────────────────────────────────── */
function useHelmStore() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable: run in-memory */
    }
  }, [state])

  // reflect appearance settings on <html>; cross-fade colours when the theme changes
  const { theme, scanlines, reduceMotion } = state.settings
  const firstTheme = useRef(true)
  useEffect(() => {
    const root = document.documentElement
    if (!firstTheme.current) {
      root.classList.add('theme-switching')
      const t = window.setTimeout(() => root.classList.remove('theme-switching'), 500)
      root.dataset.theme = theme
      return () => window.clearTimeout(t)
    }
    firstTheme.current = false
    root.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    document.documentElement.dataset.scanlines = scanlines ? 'on' : 'off'
    document.documentElement.dataset.motion = reduceMotion ? 'reduced' : 'full'
  }, [scanlines, reduceMotion])

  const [settingsOpen, setSettingsOpen] = useState(false)
  // the section Settings opens on (e.g. a plugin's "set up the connection" link)
  const [settingsSection, setSettingsSection] = useState<'connections' | undefined>()

  // Online: workspaces from the server and projects from TDT. Offline: sample data.
  const { status, workspaces: serverWorkspaces, extensionsVersion } = useServer()
  const online = status === 'online'

  // Plugin themes (per Helm, approved plugins only): their tokens go in one <style>, under the
  // same [data-theme] selectors as the built-ins. A theme that is gone falls back to the default.
  const themesLoad = useLoad(online ? `themes:${extensionsVersion}` : undefined, () => server.themes())
  const pluginThemes = useMemo(() => themesLoad.data?.themes ?? [], [themesLoad.data])
  useEffect(() => {
    let el = document.getElementById('helm-plugin-themes')
    if (!el) {
      el = document.createElement('style')
      el.id = 'helm-plugin-themes'
      document.head.append(el)
    }
    el.textContent = pluginThemes.map(themeCss).join('\n')
  }, [pluginThemes])
  useEffect(() => {
    if (builtinThemes.some((t) => t.id === theme) || status === 'connecting') return
    if (!online || (themesLoad.data && !pluginThemes.some((t) => t.key === theme))) dispatch({ type: 'settings', patch: { theme: 'hud' } })
  }, [theme, status, online, themesLoad.data, pluginThemes])
  const workspaces = useMemo(() => (online ? serverWorkspaces.map(toWorkspace) : offline.workspaces), [online, serverWorkspaces])
  const ws: Workspace | undefined = workspaces.find((w) => w.id === state.wsId) ?? workspaces[0]
  // A saved workspace id from the other mode (or a removed entry): follow the list.
  useEffect(() => {
    if (status !== 'connecting' && ws && ws.id !== state.wsId) dispatch({ type: 'workspace', wsId: ws.id })
  }, [status, ws, state.wsId])
  const liveProjects = useLoad(online && ws ? `projects:${ws.id}` : undefined, () => server.projects(ws!.id))
  const projects = useMemo(
    () =>
      online
        ? (liveProjects.data ?? []).map((p) => toProject(ws!.id, p))
        : [...seedProjects, ...state.userProjects].filter((p) => p.wsId === state.wsId),
    [online, liveProjects.data, ws, state.userProjects, state.wsId],
  )
  const tabSet = tabSetOf(state)
  const activeTab = tabSet.tabs.find((t) => t.id === tabSet.activeId) ?? DASHBOARD_TAB

  // Chat never runs a model (D2): online, each message is handed to Claude Code or Codex
  // in a workspace terminal; the chat keeps a note and the session opens in its own tab.
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const relay = useCallback((chatId: string, prompt: string) => {
    const s = stateRef.current
    const note = (text: string) =>
      dispatch({ type: 'pushMessage', chatId, message: { id: uid('m'), role: 'assistant', text, status: 'done', at: Date.now() } })
    if (!server.online) {
      note('Offline: Helm can’t reach Claude Code or Codex. Start the Helm server (`helm`) and send this again to hand it off.')
      return
    }
    const host = s.settings.host
    const hostName = host === 'codex' ? 'Codex' : 'Claude Code'
    const project = projectsRef.current.find((p) => p.id === s.chats[chatId]?.projectId)
    const text = project?.path ? `${prompt}\n\n(Context: project ${project.name}, registered id ${project.id}.)` : prompt
    const pending = uid('m')
    dispatch({ type: 'pushMessage', chatId, message: { id: pending, role: 'assistant', text: '', status: 'thinking', at: Date.now() } })
    server
      .handoff(s.wsId, text, host)
      .then((session) => {
        dispatch({ type: 'patchMessage', chatId, messageId: pending, append: `Handed off to **${hostName}**. The session opened in its own tab and is listed in the right panel.`, patch: { status: 'done' } })
        dispatch({ type: 'openTab', tab: { id: `session:${session.id}`, kind: 'session', title: session.title, refId: session.id } })
      })
      .catch((e: Error) => dispatch({ type: 'patchMessage', chatId, messageId: pending, append: `Couldn’t start ${hostName}: ${e.message}`, patch: { status: 'done' } }))
  }, [])

  const actions = useMemo(
    () => ({
      updateSettings: (patch: Partial<Settings>) => dispatch({ type: 'settings', patch }),
      openSettings: () => (setSettingsSection(undefined), setSettingsOpen(true)),
      openConnections: () => (setSettingsSection('connections'), setSettingsOpen(true)),
      closeSettings: () => setSettingsOpen(false),
      setWorkspace: (wsId: string) => dispatch({ type: 'workspace', wsId }),
      activateTab: (id: string) => dispatch({ type: 'activateTab', id }),
      closeTab: (id: string) => dispatch({ type: 'closeTab', id }),
      toggleLeft: () => dispatch({ type: 'toggleLeft' }),
      toggleRight: () => dispatch({ type: 'toggleRight' }),
      openDashboard: () => dispatch({ type: 'activateTab', id: DASHBOARD_TAB.id }),
      openGraph: (query?: string) => {
        if (query !== undefined) dispatch({ type: 'graphQuery', query })
        dispatch({ type: 'openTab', tab: { id: 'graph', kind: 'graph', title: 'Brain' } })
      },
      openDesign: () => dispatch({ type: 'openTab', tab: { id: 'design', kind: 'design', title: 'Design system' } }),
      /** A linked project's file graph (tdt_project_graph); one tab per project. */
      openProjectGraph: (p: Project) =>
        dispatch({ type: 'openTab', tab: { id: `pgraph:${p.id}`, kind: 'projectGraph', title: `${p.name} graph`, refId: p.id } }),
      openProject: (p: Project) =>
        dispatch({ type: 'openTab', tab: { id: `project:${p.id}`, kind: 'project', title: p.name, refId: p.id } }),
      openChat: (chat: Chat) =>
        dispatch({ type: 'openTab', tab: { id: `chat:${chat.id}`, kind: 'chat', title: chat.title, refId: chat.id } }),
      /** Start a new chat. With a prompt it sends immediately; without one it opens empty. */
      startChat: (prompt?: string, projectId?: string) => {
        const id = uid('c')
        const text = prompt?.trim()
        const chat: Chat = {
          id,
          wsId: stateRef.current.wsId,
          title: text ? titleFrom(text) : 'New session',
          projectId,
          messages: text ? [{ id: uid('m'), role: 'user', text, status: 'done', at: Date.now() }] : [],
          updatedAt: Date.now(),
        }
        dispatch({ type: 'upsertChat', chat })
        dispatch({ type: 'openTab', tab: { id: `chat:${id}`, kind: 'chat', title: chat.title, refId: id } })
        if (text) relay(id, text)
      },
      /** Hand a prompt (e.g. a skill invocation) to the chosen host; offline or on failure it becomes a chat that says why. */
      handoff: (prompt: string, projectId?: string) => {
        const s = stateRef.current
        const fallback = () => actions.startChat(prompt, projectId)
        if (!server.online) return fallback()
        server
          .handoff(s.wsId, prompt, s.settings.host)
          .then((session) => dispatch({ type: 'openTab', tab: { id: `session:${session.id}`, kind: 'session', title: session.title, refId: session.id } }))
          .catch(fallback)
      },
      /** Start an orchestrated build with the chosen host and open its session; rejects offline or on failure. */
      build: async (projectId: string, taskId: string, host?: HostId) => {
        const s = stateRef.current
        if (!server.online) throw new Error('Start the Helm server (`helm`) to run builds.')
        const session = await server.build(s.wsId, { projectId, taskId, host: host ?? s.settings.host })
        dispatch({ type: 'openTab', tab: { id: `session:${session.id}`, kind: 'session', title: session.title, refId: session.id } })
      },
      sendMessage: (chatId: string, text: string) => {
        const chat = stateRef.current.chats[chatId]
        if (!chat || !text.trim()) return
        if (chat.messages.length === 0) {
          const title = titleFrom(text)
          dispatch({ type: 'upsertChat', chat: { ...chat, title } })
          dispatch({ type: 'openTab', tab: { id: `chat:${chatId}`, kind: 'chat', title, refId: chatId } })
        }
        dispatch({ type: 'pushMessage', chatId, message: { id: uid('m'), role: 'user', text: text.trim(), status: 'done', at: Date.now() } })
        relay(chatId, text)
      },
      toggleTask: (id: string) => dispatch({ type: 'toggleTask', id }),
      addNote: (title: string) =>
        dispatch({
          type: 'addNote',
          note: { id: uid('n'), wsId: stateRef.current.wsId, kind: 'note', title, excerpt: 'Quick capture', projectIds: [], conceptIds: [], personIds: [], updated: Date.now() },
        }),
      setGraphQuery: (query: string) => dispatch({ type: 'graphQuery', query }),
      /** Open a tool tab. Single-instance tools reuse their instance; multi tools get a new one. */
      openTool: (type: string, name: string, opts: { multi?: boolean; settings?: SettingValues } = {}) => {
        const s = stateRef.current
        const existing = !opts.multi && Object.values(s.tools).find((t) => t.type === type && t.wsId === s.wsId)
        const tool: ToolInstance = existing || { id: uid(`${type}-`), type, wsId: s.wsId, settings: opts.settings ?? {} }
        if (!existing) dispatch({ type: 'tool', tool })
        dispatch({ type: 'openTab', tab: { id: `tool:${tool.id}`, kind: 'tool', title: name, refId: tool.id } })
      },
      updateToolSettings: (id: string, settings: SettingValues) => {
        const tool = stateRef.current.tools[id]
        if (tool) dispatch({ type: 'tool', tool: { ...tool, settings } })
      },
      /** Agent session detail (server session id). */
      openSession: (id: string, title: string) =>
        dispatch({ type: 'openTab', tab: { id: `session:${id}`, kind: 'session', title, refId: id } }),
      /** Brain record reader/editor tab; one tab per record path. refId is the serialized RecordRef. */
      openRecord: (ref: { kind: string; path: string; id?: string; title: string }) =>
        dispatch({ type: 'openTab', tab: { id: `record:${ref.path}`, kind: 'record', title: ref.title, refId: JSON.stringify(ref) } }),
      /** Workspace terminal tab (server terminal id, or 'offline'). */
      openTerminal: (id: string, title = 'Terminal') =>
        dispatch({ type: 'openTab', tab: { id: `term:${id}`, kind: 'terminal', title, refId: id } }),
      setLayout: (layout: GridItem[]) => dispatch({ type: 'layout', wsId: stateRef.current.wsId, layout }),
    }),
    [relay],
  )

  return {
    state,
    online,
    serverStatus: status,
    workspaces,
    ws: ws ?? NO_WORKSPACE,
    projects,
    projectsLoad: online ? liveProjects : undefined,
    tabSet,
    activeTab,
    settingsOpen,
    settingsSection,
    pluginThemes,
    actions,
  }
}

// Values were validated by the server (theme.md#theme-plugins); this guard keeps any rule text out.
const SAFE_CSS = /^[^;{}<>\\]*$/
const block = (key: string, tokens: Record<string, string>) =>
  `[data-theme="${key}"]{${Object.entries(tokens).filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && SAFE_CSS.test(v)).map(([k, v]) => `${k}:${v}`).join(';')}}`
function themeCss(t: ServerTheme) {
  if (!/^[@a-z0-9._/-]+$/.test(t.key)) return ''
  return block(t.key, t.tokens) + (t.chrome ? block(`${t.key}:chrome`, { ...t.tokens, ...t.chrome }) : '')
}

/** data-theme for a theme's rails: the built-in sub-theme, or a plugin theme's `<key>:chrome`. */
export function chromeOf(theme: string, plugins: ServerTheme[]) {
  return chromeTheme[theme as ThemeId] ?? (plugins.find((t) => t.key === theme)?.chrome ? `${theme}:chrome` : undefined)
}

/** Online with no workspaces configured in HELM_HOME/config.json. */
const NO_WORKSPACE: Workspace = { id: 'none', name: 'No workspace', code: '--', kind: "Add one to Helm's config.json", tone: 'neutral' }

function titleFrom(text: string) {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 38 ? t.slice(0, 36) + '…' : t
}

type HelmContext = ReturnType<typeof useHelmStore>
const Ctx = createContext<HelmContext | null>(null)

export function HelmProvider({ children }: { children: ReactNode }) {
  const value = useHelmStore()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHelm() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useHelm must be used inside <HelmProvider>')
  return v
}

/** data-theme for rail elements (sidebars, tab bar, chat dock) when the active theme has a separate chrome sub-theme. */
export function useChromeTheme() {
  const { state, pluginThemes } = useHelm()
  return chromeOf(state.settings.theme, pluginThemes)
}

export function isStreaming(chat: Chat) {
  const last = chat.messages[chat.messages.length - 1]
  return !!last && last.status !== 'done'
}
