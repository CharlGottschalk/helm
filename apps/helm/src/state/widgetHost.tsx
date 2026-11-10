// Provides the @helm/widgets host interface from the app store.
import { useMemo, type ReactNode } from 'react'
import { WidgetHostProvider, type WidgetHost } from '@helm/widgets'
import { useHelm } from './store'

export function HelmWidgetHost({ children }: { children: ReactNode }) {
  const { state, online, ws, projects, actions } = useHelm()
  // the resolved workspace: state.wsId can briefly hold the other mode's id while the store switches
  const wsId = ws.id
  const { chats, userNotes, doneTasks } = state
  const host = useMemo<WidgetHost>(
    () => ({
      wsId,
      online,
      projects,
      chats: Object.values(chats)
        .filter((c) => c.wsId === wsId)
        .map((c) => ({ id: c.id, title: c.title, projectId: c.projectId, updatedAt: c.updatedAt, preview: c.messages[c.messages.length - 1]?.text })),
      userNotes: userNotes.filter((n) => n.wsId === wsId),
      doneTasks,
      toggleTask: actions.toggleTask,
      addNote: actions.addNote,
      openProject: actions.openProject,
      openGraph: actions.openGraph,
      openChat: (id) => {
        const chat = chats[id]
        if (chat) actions.openChat(chat)
      },
      startChat: actions.startChat,
      handoff: actions.handoff,
      defaultHost: state.settings.host,
      build: actions.build,
      openRecord: actions.openRecord,
      openSession: actions.openSession,
      openDesign: actions.openDesign,
      openSettings: actions.openSettings,
      openConnections: actions.openConnections,
    }),
    [wsId, online, projects, chats, userNotes, doneTasks, actions, state.settings.host],
  )
  return <WidgetHostProvider value={host}>{children}</WidgetHostProvider>
}
