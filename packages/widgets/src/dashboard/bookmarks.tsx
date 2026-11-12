// Bookmarks (task 046): per-instance links, each opening in a new browser tab. Only http(s)
// URLs pass configure; render re-checks so a hand-edited dashboard can't smuggle javascript:.
import { Button, Icon } from '@helm/ui'
import type { ListItem, SettingField } from '@usetdt/helm-sdk'
import s from './widgets.module.css'

const URL_PATTERN = '^https?://[^\\s]+$'

export const bookmarkSettings: SettingField[] = [
  { id: 'bookmarks', type: 'list', label: 'Bookmarks', addLabel: 'Add bookmark', max: 48, default: [], fields: [
    { id: 'title', type: 'text', label: 'Title', required: true, maxLength: 60 },
    { id: 'url', type: 'text', label: 'URL', required: true, maxLength: 2000, pattern: URL_PATTERN, placeholder: 'https://example.com',
      help: 'Must start with http:// or https:// (javascript:, data: and file: links are refused).' },
  ] },
]

const safeUrl = (v: unknown) => {
  if (typeof v !== 'string') return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}

export function BookmarksWidget({ bookmarks, openSettings }: { bookmarks: ListItem[]; openSettings?: () => void }) {
  if (!bookmarks.length)
    return (
      <div className={s.quickEmpty}>
        <p className={s.muted}>No bookmarks yet.</p>
        {openSettings && <Button size="sm" icon="plus" onClick={openSettings}>Add a bookmark</Button>}
      </div>
    )
  return (
    <div className={s.quick}>
      {bookmarks.map((b, i) => {
        const href = safeUrl(b.url)
        const title = typeof b.title === 'string' && b.title ? b.title : 'Untitled'
        const host = href ? new URL(href).host : 'Invalid URL'
        return href ? (
          <a key={i} className={s.quickTile} href={href} target="_blank" rel="noopener noreferrer" title={href}>
            <Icon name="link" size={18} />
            <span className={s.quickLabel}>{title}</span>
            <span className={s.quickHint}>{host}</span>
          </a>
        ) : (
          <span key={i} className={`${s.quickTile} ${s.quickOff}`} aria-disabled="true">
            <Icon name="link" size={18} />
            <span className={s.quickLabel}>{title}</span>
            <span className={s.quickHint}>{host}</span>
          </span>
        )
      })}
    </div>
  )
}
