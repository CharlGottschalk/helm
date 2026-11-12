import { useEffect, type CSSProperties } from 'react'
import { FloatingChat } from './components/chat/FloatingChat'
import { SettingsModal } from './components/settings/SettingsModal'
import { cx } from './lib/util'
import { LeftSidebar } from './components/shell/LeftSidebar'
import { RightSidebar } from './components/shell/RightSidebar'
import { TabBar } from './components/shell/TabBar'
import { useHelm } from './state/store'
import { BrainGraph } from './views/graph/BrainGraph'
import { ProjectGraph } from './views/graph/ProjectGraph'
import { ChatView } from './views/chat/ChatView'
import { Dashboard } from './views/dashboard/Dashboard'
import { DesignSystem } from './views/design/DesignSystem'
import { ProjectView } from './views/project/ProjectView'
import { RecordView } from './views/record/RecordView'
import { SessionView } from './views/session/SessionView'
import { TerminalView } from './views/terminal/TerminalView'
import { ToolHost } from './views/tools/ToolHost'
import { Onboarding } from './views/onboarding/Onboarding'
import s from './App.module.css'

export function App() {
  const { state, online, workspaces, activeTab, actions } = useHelm()

  // Alt+1..3 switches workspace; Ctrl+, opens settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        actions.openSettings()
        return
      }
      const ws = e.altKey && workspaces[Number(e.code.replace('Digit', '')) - 1]
      if (ws) {
        e.preventDefault()
        actions.setWorkspace(ws.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, workspaces])

  // No workspace configured yet: onboarding instead of an empty shell (task 042)
  if (online && !workspaces.length) return <Onboarding />

  const style = {
    '--left': state.leftCollapsed ? 'var(--rail-w)' : 'var(--left-w)',
    '--right': state.rightCollapsed ? 'var(--rail-w)' : 'var(--right-w)',
  } as CSSProperties

  let view
  switch (activeTab.kind) {
    case 'chat':
      view = <ChatView key={activeTab.id} chatId={activeTab.refId!} />
      break
    case 'graph':
      view = <BrainGraph key={state.wsId} />
      break
    case 'projectGraph':
      view = <ProjectGraph key={activeTab.id} projectId={activeTab.refId!} />
      break
    case 'project':
      view = <ProjectView key={activeTab.id} projectId={activeTab.refId!} />
      break
    case 'design':
      view = <DesignSystem />
      break
    case 'tool':
      view = <ToolHost key={activeTab.id} instanceId={activeTab.refId!} />
      break
    case 'terminal':
      view = <TerminalView key={activeTab.id} terminalId={activeTab.refId!} />
      break
    case 'session':
      view = <SessionView key={activeTab.id} sessionId={activeTab.refId!} />
      break
    case 'record':
      view = <RecordView key={activeTab.id} refJson={activeTab.refId!} />
      break
    default:
      view = <Dashboard key={state.wsId} />
  }

  return (
    <div className={s.app} style={style}>
      <LeftSidebar />
      <main className={s.center}>
        <TabBar />
        <div className={s.viewport}>
          <div key={`${state.wsId}:${activeTab.id}`} className={cx(s.view, 'view-enter')}>
            {view}
          </div>
        </div>
        {!['chat', 'terminal', 'session', 'record'].includes(activeTab.kind) && <FloatingChat />}
      </main>
      <RightSidebar />
      <SettingsModal />
    </div>
  )
}
