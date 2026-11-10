// Which host CLI receives chat hand-offs; saved with the other settings.
import { useHelm } from '../../state/store'
import s from './HostPicker.module.css'

export const suggestions = [
  'Summarise the last 24 hours',
  'What should I work on next?',
  'Check workspace health',
  'How is memory connected in the brain?',
]

export function HostPicker() {
  const { state, actions } = useHelm()
  return (
    <select
      className={s.picker}
      value={state.settings.host ?? 'claude'}
      onChange={(e) => actions.updateSettings({ host: e.target.value as 'claude' | 'codex' })}
      aria-label="Hand off to"
      title="Hand off to"
    >
      <option value="claude">Claude Code</option>
      <option value="codex">Codex</option>
    </select>
  )
}
