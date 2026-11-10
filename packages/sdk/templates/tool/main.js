// Runs inside a sandboxed Helm frame (docs/tool.md, docs/widget.md#bridge).
import { getHelm } from '@usetdt/helm-sdk/frame'

const helm = getHelm()
const content = document.getElementById('content')

helm.on('settings', async (s) => {
  if (!s.project) {
    content.className = 'h-state'
    content.textContent = 'Choose a project in settings.'
    return
  }
  const r = await helm.call('tdt', 'tdt_project_read', { id: s.project })
  content.className = r.ok ? '' : 'h-state h-state--error'
  content.textContent = r.ok ? r.data.project.path : (r.error?.message ?? 'TDT did not answer')
})
helm.ready()
