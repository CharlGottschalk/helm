// Renders a tool instance tab: standard header, settings, unconfigured state.
import { useState } from 'react'
import { Button, Icon } from '@helm/ui'
import { SettingsDialog } from '../../components/settings/SettingsDialog'
import { requiredMissing, resolveSettings } from '@usetdt/helm-sdk'
import { useOptionsResolver } from '../../services/options'
import { useHelm } from '../../state/store'
import { useToolTypes } from '@helm/widgets'
import s from './ToolHost.module.css'

export function ToolHost({ instanceId }: { instanceId: string }) {
  const { state, actions } = useHelm()
  const resolveOptions = useOptionsResolver()
  const [editing, setEditing] = useState(false)
  const { find: toolType, loading } = useToolTypes()
  const instance = state.tools[instanceId]
  const type = instance && toolType(instance.type)

  if (instance && !type && loading) return <div className={s.missing}><p className="hud-label">Loading extensions…</p></div>
  if (!instance || !type) {
    return (
      <div className={s.missing}>
        <p>This tool is no longer available.</p>
        <Button onClick={() => actions.closeTab(`tool:${instanceId}`)}>Close tab</Button>
      </div>
    )
  }

  const settings = resolveSettings(type.settings, instance.settings)
  const unconfigured = requiredMissing(type.settings, settings)

  return (
    <div className={s.view}>
      <header className={s.header}>
        <span className={s.icon}><Icon name={type.icon} size={18} /></span>
        <div className={s.titles}>
          <span className="hud-label">Tool · {type.sandboxed ?? type.name}</span>
          <h1 className={s.title}>{type.name}</h1>
        </div>
        {!!type.settings?.length && (
          <Button size="sm" variant="ghost" icon="sliders" onClick={() => setEditing(true)}>Settings</Button>
        )}
      </header>
      <div className={s.body}>
        {unconfigured ? (
          <div className={s.configure}>
            <Icon name="sliders" size={28} />
            <h2>Configure {type.name}</h2>
            <p>{type.description}</p>
            <Button variant="primary" icon="sliders" onClick={() => setEditing(true)}>Choose settings</Button>
          </div>
        ) : (
          type.render(instance, settings, { openSettings: () => setEditing(true) })
        )}
      </div>
      {editing && (
        <SettingsDialog
          title={`${type.name} settings`}
          subtitle="This tab only"
          fields={type.settings ?? []}
          values={instance.settings}
          resolveOptions={resolveOptions}
          onSave={(values) => actions.updateToolSettings(instance.id, values)}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
