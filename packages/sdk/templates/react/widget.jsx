// Runs inside a sandboxed Helm frame (docs/react.md). Same widget as the plain template, in React.
import { List, Row, State, Value, mount, useConnection, useSettings } from '@usetdt/helm-sdk/react'

function App() {
  const settings = useSettings() ?? {}
  const r = useConnection('tdt', 'tdt_workspace_status')
  if (r.status === 'loading') return <State kind="loading">Loading…</State>
  if (r.status === 'error') return <State kind="error" action={{ label: 'Retry', onClick: r.reload }}>{r.error}</State>
  const d = r.data ?? {}
  const rows = [['Pending reviews', d.pending_candidates], ['Due reminders', d.due_reminders], ['Projects', d.projects_total]]
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, settings.limit ?? 10)
  if (!rows.length) return <State>Nothing to show yet.</State>
  // connection data is rendered as text by React, never as HTML
  return <List>{rows.map(([label, value]) => <Row key={label} label={label} value={<Value>{value}</Value>} />)}</List>
}

mount(<App />)
