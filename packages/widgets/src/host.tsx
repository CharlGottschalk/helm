// What a built-in widget or tool may ask of the app hosting it (apps/helm today,
// a VS Code panel later). Data comes from @helm/client; navigation and hand-offs
// go through this interface, never through the app's store.
import { createContext, useContext } from 'react'
import type { Note, Project } from '@helm/client'

/** A chat session in the current workspace, as widgets list it. */
export interface HostChat {
  id: string
  title: string
  projectId?: string
  updatedAt: number
  /** last message, plain text */
  preview?: string
}

export interface WidgetHost {
  /** current workspace id */
  wsId: string
  /** a Helm server answers: widgets read live TDT data; otherwise sample data */
  online: boolean
  /** projects of the current workspace */
  projects: Project[]
  /** chats of the current workspace */
  chats: HostChat[]
  /** notes captured in this session, current workspace */
  userNotes: Note[]
  doneTasks: Record<string, boolean>
  toggleTask(id: string): void
  addNote(title: string): void
  openProject(project: Project): void
  openGraph(query?: string): void
  openChat(id: string): void
  startChat(prompt?: string, projectId?: string): void
  /** hand a prompt (e.g. a skill invocation) to Claude/Codex; offline it opens a sample chat */
  handoff(prompt: string, projectId?: string): void
  /** the app setting builds use when no host is given */
  defaultHost: 'claude' | 'codex'
  /** start a build with `host` (default: the app setting) and open its session; rejects with a message to show */
  build(projectId: string, taskId: string, host?: 'claude' | 'codex'): Promise<void>
  /** open a brain record tab (scratchpad note, candidate, knowledge, project) */
  openRecord(ref: { kind: 'knowledge' | 'candidate' | 'scratchpad' | 'project'; path: string; id?: string; title: string }): void
  openSession(id: string, title: string): void
  openDesign(): void
  /** open a tool tab (built-in or plugin) by type; single-instance tools reuse their tab */
  openTool(type: string, name: string): void
  openSettings(): void
  /** Helm's Settings, opened on Connections */
  openConnections(): void
}

const Ctx = createContext<WidgetHost | null>(null)
export const WidgetHostProvider = Ctx.Provider

export function useWidgetHost() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWidgetHost must be used inside <WidgetHostProvider>')
  return v
}
