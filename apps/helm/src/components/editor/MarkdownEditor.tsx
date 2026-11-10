// CodeMirror 6 Markdown editor. Colours, fonts and radii come from Helm's CSS
// tokens (var(--…)), so it follows every theme without re-creating the editor.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--c-text-0)',
    backgroundColor: 'var(--c-well)',
    fontSize: 'var(--fs-md)',
    border: '1px solid var(--c-line-strong)',
    borderRadius: 'var(--radius-sm)',
  },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--c-line-hot)', boxShadow: 'var(--glow-cyan)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { padding: 'var(--sp-3) var(--sp-2)', caretColor: 'var(--c-cyan)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--c-cyan)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(var(--rgb-accent) / 0.25)' },
  '.cm-activeLine': { backgroundColor: 'var(--c-surface-hover)' },
  '.cm-placeholder': { color: 'var(--c-text-3)' },
})

const highlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--c-text-0)', fontWeight: '700' },
  { tag: t.heading1, fontSize: '1.15em' },
  { tag: [t.strong], fontWeight: '700', color: 'var(--c-text-0)' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--c-cyan)' },
  { tag: [t.monospace], color: 'var(--c-green)' },
  { tag: [t.quote], color: 'var(--c-text-2)', fontStyle: 'italic' },
  { tag: [t.list], color: 'var(--c-amber)' },
  { tag: [t.processingInstruction, t.meta, t.punctuation], color: 'var(--c-text-3)' },
  { tag: [t.contentSeparator], color: 'var(--c-line-strong)' },
])

interface Props {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  ariaLabel?: string
}

export function MarkdownEditor({ value, onChange, readOnly, placeholder, ariaLabel = 'Markdown editor' }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const el = host.current
    if (!el) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        theme,
        EditorState.readOnly.of(!!readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        ...(placeholder ? [placeholderExt(placeholder)] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
        }),
      ],
    })
    view.current = new EditorView({ state, parent: el })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // Recreate only when read-only mode flips; value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // External value changes (reload, discard) replace the document.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  return <div ref={host} style={{ height: '100%', minHeight: 0 }} />
}
