// Resolves dynamic settings options ({ from: 'connection', … }) for built-in extensions.
// Projects come from the shell: TDT's registered projects online, sample data offline.
// `helm` sources are Helm's own lists (tool types, the local apps allowlist).
import { useCallback } from 'react'
import type { OptionsResolver } from '../components/settings/SettingsForm'
import type { SettingOption } from '@usetdt/helm-sdk'
import { server } from '@helm/client'
import { useToolTypes } from '@helm/widgets'
import { useHelm } from '../state/store'

export function useOptionsResolver(): OptionsResolver {
  const { projects, online, ws } = useHelm()
  const tools = useToolTypes()
  return useCallback<OptionsResolver>(
    async (source) => {
      if (source.connection === 'tdt' && source.call === 'tdt_project_list') {
        return projects.map<SettingOption>((p) => ({
          value: p.id,
          label: p.availability && p.availability !== 'available' ? `${p.name} (${p.availability})` : p.name,
        }))
      }
      if (source.connection === 'tdt' && source.call === 'tdt_skill_list') {
        if (!online) return []
        const out: SettingOption[] = []
        let cursor: string | null | undefined
        do {
          const page = await server.tdt<{ items: { id: string; description?: string | null }[]; next_cursor?: string | null }>(ws.id, 'tdt_skill_list', { limit: 50, ...(cursor ? { cursor } : {}) })
          out.push(...page.items.map((i) => ({ value: i.id, label: i.description ? `${i.id} — ${i.description}` : i.id })))
          cursor = page.next_cursor
        } while (cursor && out.length < 1000)
        return out
      }
      if (source.connection === 'helm' && source.call === 'tools') {
        return tools.all.map((t) => ({ value: t.type, label: t.name }))
      }
      if (source.connection === 'helm' && source.call === 'local-apps') {
        if (!online) throw new Error('Local apps need the Helm server')
        const { apps } = await server.localApps()
        if (!apps.length) throw new Error('No local apps yet. Add one in Settings → Local apps')
        return apps.map((a) => ({ value: a.id, label: a.name }))
      }
      // TODO: generic path — call the declared operation and require [{ value, label }] back.
      throw new Error(`No resolver for ${source.connection}.${source.call}`)
    },
    [projects, online, ws.id, tools],
  )
}
