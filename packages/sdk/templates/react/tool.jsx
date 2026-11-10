// Runs inside a sandboxed Helm frame (docs/tool.md, docs/react.md). Same tool as the plain template, in React.
import { State, mount, useConnection, useSettings } from '@usetdt/helm-sdk/react'

function App() {
  const settings = useSettings()
  const project = settings?.project
  const r = useConnection('tdt', 'tdt_project_read', project ? { id: project } : null)
  if (settings && !project) return <State>Choose a project in settings.</State>
  if (r.status === 'loading') return <State kind="loading">Loading…</State>
  if (r.status === 'error') return <State kind="error">{r.error}</State>
  return <>{r.data.project.path}</>
}

mount(<App />, document.getElementById('content'))
