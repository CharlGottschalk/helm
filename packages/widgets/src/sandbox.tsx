// Sandboxed widgets and tools from enabled plugins and work/helm/ (sdk docs/README.md).
// The frame is an opaque-origin iframe with its own CSP (served by the Helm server);
// it reaches Helm only through postMessage, and every request is checked here
// against the manifest it declared.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@helm/ui'
import { allowed, isWrite, snapshotTokens, tokensCss, validateManifest, type FilesResult, type HttpResult, type SettingValues, type TdtResult, type ToolManifest, type WidgetManifest } from '@usetdt/helm-sdk'
import { server, useServer, useServerData, type ServerExtension } from '@helm/client'
import { useWidgetHost } from './host'
import { useWriteDialog } from './WriteDialog'
import { orWriteKind, settleMove } from './move'
import { widgetTypes, type WidgetType } from './dashboard/registry'
import { toolTypes, type ToolType } from './tools/registry'
import s from './dashboard/widgets.module.css'

type Manifest = WidgetManifest | ToolManifest
type Ext = ServerExtension & { manifest: Manifest }
export interface ExtensionError {
  key: string
  path: string
  message: string
}

const MAX_MESSAGE = 256 * 1024
const CALLS_PER_MINUTE = 60
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const originLabel = (e: ServerExtension) => (e.origin === 'generated' ? 'work/helm' : `plugin ${e.origin.plugin}`)

const refused = (message: string): TdtResult => ({
  api_version: 1, ok: false, data: null, coverage: { truncated: false, omissions: [] }, warnings: [],
  error: { code: 'refused', message, retry: 'inspect_outcome' },
})

/** Read-only TDT tools per workspace, fetched once: extensions may not call writes in v1. */
const readOnlyTools = new Map<string, Promise<Set<string>>>()
function readOnly(ws: string) {
  let p = readOnlyTools.get(ws)
  if (!p) {
    p = server.tdtTools(ws).then((list) => new Set(list.filter((t) => t.readOnly).map((t) => t.name)))
    p.catch(() => readOnlyTools.delete(ws))
    readOnlyTools.set(ws, p)
  }
  return p
}

/** Built-in-shaped widget and tool types for the current workspace's valid extensions, plus load errors. */
export function useExtensionTypes() {
  const host = useWidgetHost()
  const { extensionsVersion } = useServer()
  const load = useServerData(host.online ? host.wsId : undefined, `extensions:${extensionsVersion}`, (ws) => server.extensions(ws))
  return useMemo(() => {
    const widgets: WidgetType[] = []
    const tools: ToolType[] = []
    const errors: ExtensionError[] = [...(load.data?.errors ?? [])]
    for (const e of load.data?.extensions ?? []) {
      const problems = validateManifest(e.manifest, e.kind)
      const path = e.origin === 'generated' ? `work/helm/${e.kind}s/${e.key.split('.').pop()}/manifest.json` : `plugin ${e.origin.plugin}: ${e.key.split('.').pop()}/manifest.json`
      if (problems.length) {
        errors.push({ key: e.key, path, message: problems.join('; ') })
        continue
      }
      const ext = e as Ext
      const m = ext.manifest
      const base = { type: e.key, icon: m.icon, description: m.description, multi: m.multi, settings: m.settings, connections: m.connections, sandboxed: originLabel(e) }
      if (m.contract === 'helm.widget/1')
        widgets.push({
          ...base, title: m.name, code: 'EXT', capabilities: m.capabilities, category: m.category, w: m.size.w, h: m.size.h, minW: m.size.minW ?? 1, minH: m.size.minH ?? 1,
          render: (item, settings, ctx) => <SandboxFrame ext={ext} instanceId={item.id} settings={settings} openSettings={ctx?.openSettings} />,
        })
      else
        tools.push({
          ...base, name: m.name, capabilities: m.capabilities,
          render: (instance, settings, ctx) => <SandboxFrame ext={ext} instanceId={instance.id} settings={settings} openSettings={ctx?.openSettings} />,
        })
    }
    return { widgets, tools, errors, loading: host.online && load.loading, loadError: load.error?.message, reload: load.reload }
  }, [load.data, load.loading, load.error, host.online]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Built-in plus extension widget types; `loading` while extensions may still appear. */
export function useWidgetTypes() {
  const x = useExtensionTypes()
  return useMemo(() => {
    const all = [...widgetTypes, ...x.widgets]
    return { all, find: (type: string) => all.find((t) => t.type === type), errors: x.errors, loading: x.loading }
  }, [x])
}

/** Built-in plus extension tool types. */
export function useToolTypes() {
  const x = useExtensionTypes()
  return useMemo(() => {
    const all = [...toolTypes, ...x.tools]
    return { all, find: (type: string) => all.find((t) => t.type === type), loading: x.loading }
  }, [x])
}

interface FrameProps {
  ext: Ext
  instanceId: string
  settings: SettingValues
  openSettings?: () => void
}

export function SandboxFrame({ ext, instanceId, settings, openSettings }: FrameProps) {
  const host = useWidgetHost()
  const { sessions } = useServer()
  const ref = useRef<HTMLIFrameElement>(null)
  const [src, setSrc] = useState<string>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const loads = useRef(0)
  const [writeDialog, askWrite, askMove] = useWriteDialog()
  const m = ext.manifest
  const caps: string[] = m.capabilities ?? []
  const isTool = m.contract === 'helm.tool/1'
  // tools, and widgets that start builds, see the workspace's sessions
  const getsSessions = isTool || caps.includes('orchestrate')
  const wsSessions = useMemo(() => sessions.filter((x) => x.workspaceId === host.wsId), [sessions, host.wsId])
  // the message handler reads the latest values without re-subscribing
  const live = useRef({ host, settings, openSettings, wsSessions })
  live.current = { host, settings, openSettings, wsSessions }

  const post = (type: string, value?: unknown, id?: number) => ref.current?.contentWindow?.postMessage({ helm: 1, type, id, value }, '*')
  // the frame's color-scheme must match the iframe element's, or the browser paints an opaque backdrop
  const scheme = () => getComputedStyle(document.documentElement).colorScheme || 'normal'
  const themeCss = (tokens = snapshotTokens(ref.current?.parentElement ?? document.documentElement)) => `${tokensCss(tokens)}:root{color-scheme:${scheme()}}`

  // a one-time frame URL per (re)load
  useEffect(() => {
    if (!host.online || error) return
    let gone = false
    setSrc(undefined)
    setReady(false)
    server.extensionFrame(host.wsId, { key: ext.key, instance: instanceId, css: themeCss() }).then(
      (r) => !gone && ((loads.current = 0), setSrc(r.url)),
      (e: Error) => !gone && setError(e.message),
    )
    return () => {
      gone = true
    }
  }, [host.online, host.wsId, ext.key, instanceId, attempt, error]) // eslint-disable-line react-hooks/exhaustive-deps

  // bridge: requests from the frame
  useEffect(() => {
    const calls: number[] = []
    /** false once this instance made CALLS_PER_MINUTE calls in the last minute */
    const spend = () => {
      const now = Date.now()
      while (calls.length && calls[0] < now - 60_000) calls.shift()
      if (calls.length >= CALLS_PER_MINUTE) return false
      calls.push(now)
      return true
    }
    const call = async (msg: Record<string, unknown>): Promise<TdtResult | FilesResult | HttpResult> => {
      const { connection, operation } = msg
      if (typeof connection !== 'string' || typeof operation !== 'string') return refused('call(connection, operation, args) needs two names')
      if (!allowed(m.connections, connection, operation)) return refused(`"${connection}.${operation}" is not declared in this extension's manifest`)
      const kind = m.connections?.find((c) => c.id === connection)?.kind
      if (!kind) return refused(`"${connection}" is not declared in this extension's manifest`)
      if (!spend()) return refused(`Rate limit: at most ${CALLS_PER_MINUTE} calls a minute`)
      const ws = live.current.host.wsId
      const args = isObj(msg.args) ? msg.args : {}
      if (kind === 'db' || kind === 'http' || kind === 'mcp' || kind === 'files') {
        const body = { key: ext.key, connection, operation, args }
        const send = { db: server.extensionDb, http: server.extensionHttp, mcp: server.extensionMcp, files: server.extensionFiles }[kind]
        const none = kind === 'http' ? { status: null } : {}
        try {
          if (!isWrite(m.connections, connection, operation)) return await send.call(server, ws, body)
          // a write: the server describes it and issues a one-time token; the user decides in Helm's dialog
          const confirm = await server.extensionConfirm(ws, kind, body)
          if (!('token' in confirm)) return confirm
          if (!(await askWrite(confirm.summary))) return { ok: false, ...none, data: null, error: { code: 'declined', message: 'The user declined this write; nothing was changed' } }
          return await send.call(server, ws, { ...body, token: confirm.token })
        } catch (e) {
          return { ok: false, ...none, data: null, error: { code: 'unavailable', message: (e as Error).message } }
        }
      }
      try {
        if (!(await readOnly(ws)).has(operation)) return refused(`"${operation}" is not a read-only TDT tool in this workspace; extensions can't make TDT writes`)
        return await server.callTool(ws, operation, args)
      } catch (e) {
        return { ...refused((e as Error).message), error: { code: 'unavailable', message: (e as Error).message, retry: 'safe' } }
      }
    }
    // Moving a task into Doing (tasks 028, 026): one dialog offers a declared files/http/mcp write
    // ("Move only") or the build ("Move and start build"); exactly one of them happens, or neither on Cancel.
    const moveOrBuild = async (input: { projectId: string; taskId: string; host?: 'claude' | 'codex' }, project: string, orWrite: unknown) => {
      const fail = (error: string) => ({ ok: false, error })
      if (!isObj(orWrite) || typeof orWrite.connection !== 'string' || typeof orWrite.operation !== 'string') return fail('orWrite needs connection and operation')
      const { connection, operation } = orWrite
      const kind = orWriteKind(m.connections, connection, operation)
      if (!kind) return fail(`orWrite must be a declared files, http or mcp write; "${connection}.${operation}" is not`)
      const send = { files: server.extensionFiles, http: server.extensionHttp, mcp: server.extensionMcp }[kind]
      if (!spend()) return fail(`Rate limit: at most ${CALLS_PER_MINUTE} calls a minute`)
      const ws = live.current.host.wsId
      const body = { key: ext.key, connection, operation, args: isObj(orWrite.args) ? orWrite.args : {} }
      try {
        const confirm = await server.extensionConfirm(ws, kind, body)
        if (!('token' in confirm)) return { ok: false, error: confirm.error?.message ?? 'The write was refused', write: confirm }
        const hostName = (input.host ?? live.current.host.defaultHost) === 'codex' ? 'Codex' : 'Claude Code'
        const choice = await askMove(confirm.summary, { taskId: input.taskId, project, host: hostName })
        return await settleMove(
          choice,
          () => send.call(server, ws, { ...body, token: confirm.token }),
          () => live.current.host.build(input.projectId, input.taskId, input.host),
        )
      } catch (e) {
        return fail((e as Error).message)
      }
    }
    // a hand-off or build runs an agent with text the extension chose, so the user confirms it
    const confirmed = (what: string) => window.confirm(`${m.name} (${originLabel(ext)}) wants to ${what}\n\nAllow?`)

    const onMessage = async (ev: MessageEvent) => {
      if (!ref.current || ev.source !== ref.current.contentWindow) return
      const msg: unknown = ev.data
      if (!isObj(msg) || msg.helm !== 1 || msg.instance !== instanceId) return
      if (JSON.stringify(msg).length > MAX_MESSAGE) return
      const { host, settings, openSettings, wsSessions } = live.current
      const id = typeof msg.id === 'number' ? msg.id : undefined
      switch (msg.type) {
        case 'ready':
          post('settings', settings)
          if (getsSessions) post('sessions', wsSessions)
          setReady(true)
          return
        case 'call':
          return post('result', await call(msg), id)
        case 'openSettings':
          return openSettings?.()
        case 'openConnections':
          return host.openConnections()
        case 'openTab': {
          const tab = isObj(msg.tab) ? msg.tab : {}
          if (tab.kind === 'session') {
            // only this workspace's sessions, which the frame was already sent
            const session = getsSessions ? wsSessions.find((x) => x.id === tab.id) : undefined
            return session && host.openSession(session.id, session.title)
          }
          const project = tab.kind === 'project' ? host.projects.find((p) => p.id === tab.id) : undefined
          return project && host.openProject(project)
        }
        case 'startChat':
          if (isTool && !caps.includes('chat')) return
          if (typeof msg.prompt === 'string' && msg.prompt.trim() && confirmed(`start an agent session with:\n\n${msg.prompt.slice(0, 2000)}`)) host.handoff(msg.prompt)
          return
        case 'resize':
          return post('result', false, id) // v1: the user sizes widgets
        case 'build': {
          const input = isObj(msg.input) ? msg.input : {}
          if (!caps.includes('orchestrate')) return post('result', { ok: false, error: `This ${isTool ? 'tool' : 'widget'} did not declare the "orchestrate" capability` }, id)
          if (typeof input.projectId !== 'string' || typeof input.taskId !== 'string') return post('result', { ok: false, error: 'build needs projectId and taskId' }, id)
          if (input.host !== undefined && input.host !== 'claude' && input.host !== 'codex') return post('result', { ok: false, error: 'host must be "claude" or "codex"' }, id)
          // Helm no longer reads task files itself: this confirmation and the build skill's own status check are the guard
          const name = host.projects.find((p) => p.id === input.projectId)?.name ?? input.projectId
          if (msg.orWrite !== undefined) return post('result', await moveOrBuild(input as { projectId: string; taskId: string; host?: 'claude' | 'codex' }, name, msg.orWrite), id)
          if (!confirmed(`build task ${input.taskId} in ${name}${input.host ? ` with ${input.host === 'codex' ? 'Codex' : 'Claude Code'}` : ''}`)) return post('result', { ok: false, error: 'Declined by the user' }, id)
          try {
            await host.build(input.projectId, input.taskId, input.host)
            return post('result', { ok: true }, id)
          } catch (e) {
            return post('result', { ok: false, error: (e as Error).message }, id)
          }
        }
        case 'openTerminal':
          return post('result', { ok: false, error: caps.includes('terminal') ? 'Terminals for extensions are not available in this Helm version' : 'This tool did not declare the "terminal" capability' }, id)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [ext, instanceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // push settings, sessions, theme and refresh once the frame said ready
  const settingsKey = JSON.stringify(settings)
  useEffect(() => void (ready && post('settings', settings)), [ready, settingsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void (ready && getsSessions && post('sessions', wsSessions)), [ready, wsSessions]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return
    const sendTheme = () => {
      const tokens = snapshotTokens(ref.current?.parentElement ?? document.documentElement)
      if (ref.current) ref.current.style.colorScheme = scheme()
      ref.current?.contentWindow?.postMessage({ helm: 1, type: 'theme', css: themeCss(tokens), value: tokens }, '*')
    }
    sendTheme()
    const observer = new MutationObserver(sendTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    const seconds = m.contract === 'helm.widget/1' ? m.refresh?.intervalSeconds : undefined
    const timer = seconds ? window.setInterval(() => post('refresh'), seconds * 1000) : undefined
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!host.online) return <p className="hud-label">Sandboxed extension · start the Helm server</p>
  if (error)
    return (
      <div className={s.loadError} role="alert">
        <span>{error}</span>
        <Button size="sm" variant="ghost" icon="reset" onClick={() => (setError(undefined), setAttempt((n) => n + 1))}>Retry</Button>
      </div>
    )
  return (
    <>
    <iframe
      ref={ref}
      title={m.name}
      sandbox="allow-scripts"
      src={src}
      style={{ display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent', colorScheme: scheme() }}
      onLoad={() => {
        // the first load is the frame document; another one means it navigated itself away
        if (src && ++loads.current > 1) setError(`${m.name} tried to navigate away and was stopped.`)
      }}
    />
    {writeDialog}
    </>
  )
}
