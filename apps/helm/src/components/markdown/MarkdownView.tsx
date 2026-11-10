// Renders TDT note bodies. react-markdown never interprets raw HTML, so note text
// stays inert. [[wikilinks]] become buttons that open the linked record.
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { refFromLink, wikilinksToMarkdown, type RecordRef } from '../../services/records'
import s from './MarkdownView.module.css'

interface Props {
  markdown: string
  onOpenRecord?: (ref: RecordRef) => void
}

export function MarkdownView({ markdown, onOpenRecord }: Props) {
  return (
    <div className={s.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith('helm-record:') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('helm-record:')) {
              const target = decodeURIComponent(href.slice('helm-record:'.length))
              return (
                <button type="button" className={s.wikilink} onClick={() => onOpenRecord?.(refFromLink(target))} title={target}>
                  {children}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {wikilinksToMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  )
}
