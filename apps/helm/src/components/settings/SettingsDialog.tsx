import type { SettingField, SettingValues } from '@usetdt/helm-sdk'
import { cx, Icon, useModal } from '@helm/ui'
import { SettingsForm, type OptionsResolver } from './SettingsForm'
import s from './SettingsDialog.module.css'

interface Props {
  title: string
  subtitle?: string
  fields: SettingField[]
  values: SettingValues
  resolveOptions?: OptionsResolver
  onSave: (values: SettingValues) => void
  onClose: () => void
}

/** Modal wrapper around SettingsForm for widget and tool instances. */
export function SettingsDialog({ title, subtitle, fields, values, resolveOptions, onSave, onClose }: Props) {
  const modal = useModal(onClose)
  return (
    <dialog className={cx('hud-modal', s.overlay)} aria-labelledby="instance-settings-title" {...modal}>
      <div className={s.dialog}>
        <header className={s.header}>
          <Icon name="sliders" size={16} />
          <div>
            <h2 id="instance-settings-title">{title}</h2>
            {subtitle && <span className="hud-label">{subtitle}</span>}
          </div>
          <button className={s.close} onClick={onClose} aria-label="Close settings">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className={s.body}>
          <SettingsForm
            fields={fields}
            values={values}
            resolveOptions={resolveOptions}
            onCancel={onClose}
            onSave={(v) => {
              onSave(v)
              onClose()
            }}
          />
        </div>
      </div>
    </dialog>
  )
}
