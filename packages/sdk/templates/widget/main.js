// Runs inside a sandboxed Helm frame (docs/widget.md#bridge).
import { getHelm, el } from '@usetdt/helm-sdk/frame'

const helm = getHelm()
const app = document.getElementById('app')
let settings = {}

function state(kind, message, action) {
  app.className = 'h-state' + (kind ? ' h-state--' + kind : '')
  app.replaceChildren(el('span', {}, message))
  if (action) {
    const b = el('button', { class: 'h-btn h-btn--ghost' }, action.label)
    b.onclick = action.run
    app.append(b)
  }
}

async function load() {
  state('loading', 'Loading…')
  const r = await helm.call('tdt', 'tdt_workspace_status', {})
  if (!r.ok) return state('error', r.error?.message ?? 'TDT did not answer', { label: 'Retry', run: load })
  const d = r.data ?? {}
  const rows = [['Pending reviews', d.pending_candidates], ['Due reminders', d.due_reminders], ['Projects', d.projects_total]]
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, settings.limit ?? 10)
  if (!rows.length) return state('', 'Nothing to show yet.')
  app.className = ''
  // connection data goes in as text, never as HTML
  app.replaceChildren(el('ul', { class: 'h-list' }, ...rows.map(([label, value]) => el('li', { class: 'h-row' }, el('span', {}, label), el('b', { class: 'h-value' }, value)))))
}

helm.on('settings', (s) => {
  settings = s
  load()
})
helm.on('refresh', load)
helm.ready()
