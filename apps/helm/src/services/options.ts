// Resolves dynamic settings options ({ from: 'connection', … }) for built-in extensions.
// Projects come from the shell: TDT's registered projects online, sample data offline.
import { useCallback } from 'react'
import type { OptionsResolver } from '../components/settings/SettingsForm'
import type { SettingOption } from '@usetdt/helm-sdk'
import { useHelm } from '../state/store'

export function useOptionsResolver(): OptionsResolver {
  const { projects } = useHelm()
  return useCallback<OptionsResolver>(
    async (source) => {
      if (source.connection === 'tdt' && source.call === 'tdt_project_list') {
        return projects.map<SettingOption>((p) => ({
          value: p.id,
          label: p.availability && p.availability !== 'available' ? `${p.name} (${p.availability})` : p.name,
        }))
      }
      // TODO: generic path — call the declared operation and require [{ value, label }] back.
      throw new Error(`No resolver for ${source.connection}.${source.call}`)
    },
    [projects],
  )
}
