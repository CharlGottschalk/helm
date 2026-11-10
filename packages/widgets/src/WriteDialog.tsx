// Helm's write confirmation dialog (tasks 025, 027). It shows the summary the server built for one
// exact action; the caller spends the server's one-time token only when this resolves true.
// The move variant (tasks 028, 026) offers a build instead of the write: the caller does exactly one of them.
// Rendered by the shell, outside any sandboxed frame, so extensions can neither open nor answer it.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, cx, useModal } from '@helm/ui'
import type { WriteSummary } from '@helm/client'
import type { DbEngine } from '@usetdt/helm-sdk'
import s from './WriteDialog.module.css'

const ENGINE: Record<DbEngine, string> = { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL' }

/** What the user chose; only `write` spends the token. */
export type Choice = 'cancel' | 'write' | 'build'
/** A task moving into Doing: the dialog names it and the build host. */
export interface MoveInfo {
  taskId: string
  project: string
  host: string
}

/**
 * `[dialog, ask, askMove]`: render `dialog`; `ask(summary)` resolves true only when the user confirms the
 * write; `askMove(summary, move)` resolves the user's choice. One dialog at a time.
 */
export function useWriteDialog(): [ReactNode, (summary: WriteSummary) => Promise<boolean>, (summary: WriteSummary, move: MoveInfo) => Promise<Choice>] {
  const [open, setOpen] = useState<{ summary: WriteSummary; move?: MoveInfo; done: (c: Choice) => void }>()
  const busy = useRef(false)
  const askMove = useCallback(
    (summary: WriteSummary, move?: MoveInfo) =>
      new Promise<Choice>((resolve) => {
        if (busy.current) return resolve('cancel') // another confirmation is open: refuse, don't stack dialogs
        busy.current = true
        setOpen({ summary, move, done: (c) => ((busy.current = false), setOpen(undefined), resolve(c)) })
      }),
    [],
  )
  const ask = useCallback((summary: WriteSummary) => askMove(summary).then((c) => c === 'write'), [askMove])
  useEffect(() => () => void (busy.current && open?.done('cancel')), []) // eslint-disable-line react-hooks/exhaustive-deps
  return [open ? <WriteDialog summary={open.summary} move={open.move} onDone={open.done} /> : null, ask, askMove]
}

function WriteDialog({ summary, move, onDone }: { summary: WriteSummary; move?: MoveInfo; onDone: (c: Choice) => void }) {
  const modal = useModal(() => onDone('cancel'))
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  const toggle = summary.kind === 'explorer-writes'
  const db = summary.kind === 'db-write' || summary.kind === 'explorer-writes'
  return (
    <dialog className={cx('hud-modal', s.overlay)} role="alertdialog" aria-labelledby="write-title" aria-describedby="write-what" {...modal}>
      <div className={s.dialog}>
        <h2 id="write-title" className={s.title}>{move ? 'Move task into Doing' : TITLE[summary.kind]}</h2>
        {move && summary.kind !== 'db-write' && summary.kind !== 'explorer-writes' ? <Move summary={summary} move={move} /> : !db ? <Other summary={summary} /> : (<>
        <p id="write-what" className={s.text}>
          {toggle ? (
            <>The DB explorer will be allowed to run writes on connection <q>{summary.profile}</q> ({ENGINE[summary.engine]}) until you turn them off or Helm restarts. Each statement is still confirmed.</>
          ) : summary.operation ? (
            <>{summary.actor} wants to run <q>{summary.operation}</q> on connection <q>{summary.profile}</q> ({ENGINE[summary.engine]}).</>
          ) : (
            <>{summary.actor} wants to run this statement on connection <q>{summary.profile}</q> ({ENGINE[summary.engine]}).</>
          )}
        </p>
        {summary.kind === 'db-write' && (
          <dl className={s.detail}>
            <dt className="hud-label">SQL</dt>
            <dd><pre className={s.code}>{summary.sql}</pre></dd>
            {summary.args.length > 0 && (
              <>
                <dt className="hud-label">Args</dt>
                <dd><pre className={s.code}>{JSON.stringify(summary.args)}</pre></dd>
              </>
            )}
          </dl>
        )}
        </>)}
        {!move && <p className={s.warn}>{toggle ? 'Writes change data and cannot be undone by Helm.' : 'This changes data and cannot be undone by Helm.'}</p>}
        <footer className={s.foot}>
          <Button ref={cancel} variant="subtle" onClick={() => onDone('cancel')}>Cancel</Button>
          {move ? (<>
          <Button variant="ghost" onClick={() => onDone('write')}>Move only</Button>
          <Button variant="primary" icon="bolt" onClick={() => onDone('build')}>Move and start build</Button>
          </>) : <Button variant="danger" icon="bolt" onClick={() => onDone('write')}>{toggle ? 'Turn on writes' : summary.kind === 'files-write' ? 'Write file' : summary.kind === 'db-write' ? 'Run write' : 'Send'}</Button>}
        </footer>
      </div>
    </dialog>
  )
}

const TITLE: Record<WriteSummary['kind'], string> = {
  'db-write': 'Confirm database write',
  'explorer-writes': 'Turn on database writes',
  'http-write': 'Confirm request',
  'mcp-write': 'Confirm tool call',
  'files-write': 'Confirm file change',
}

/** Moving a task into Doing: the task, the exact write (line diff, request or tool args) and the build host; either choice does one thing. */
function Move({ summary, move }: { summary: Exclude<WriteSummary, { kind: 'db-write' | 'explorer-writes' }>; move: MoveInfo }) {
  const target = summary.kind === 'files-write' ? <>writes this change to <q>{summary.path}</q></> : summary.kind === 'http-write' ? <>sends this request to service <q>{summary.service}</q></> : <>calls this tool on MCP server <q>{summary.server}</q></>
  return (
    <>
      <p id="write-what" className={s.text}>{summary.actor} wants to move task <q>{move.taskId}</q> in {move.project} into Doing.</p>
      {summary.kind === 'files-write' ? <Diff summary={summary} /> : <Detail summary={summary} />}
      <p className={s.warn}>
        <strong>Move and start build</strong> starts a {move.host} build session and writes nothing; the build skill sets the status itself.{' '}
        <strong>Move only</strong> {target} and starts no build.
      </p>
    </>
  )
}

function Diff({ summary }: { summary: Extract<WriteSummary, { kind: 'files-write' }> }) {
  return (
    <dl className={s.detail}>
      <dt className="hud-label">Changes</dt>
      <dd>
        <pre className={s.code} aria-label="Line changes: lines starting with minus are removed, plus are added">
          {summary.diff.length === 0 && 'No changes.'}
          {summary.diff.map((d, i) => (
            <span key={i} className={d.op === '-' ? s.del : d.op === '+' ? s.add : s.ctx}>{`${d.op} ${String(d.line).padStart(4)}  ${d.text}`}</span>
          ))}
          {summary.omitted > 0 && `… ${summary.omitted} more lines`}
        </pre>
      </dd>
    </dl>
  )
}

/** http, mcp and files writes: who, what, where, and the exact request, tool args or line diff. */
function Other({ summary }: { summary: Exclude<WriteSummary, { kind: 'db-write' | 'explorer-writes' }> }) {
  if (summary.kind === 'http-write')
    return (
      <>
        <p id="write-what" className={s.text}>{summary.actor} wants to send <q>{summary.operation}</q> to service <q>{summary.service}</q>.</p>
        <Detail summary={summary} />
      </>
    )
  if (summary.kind === 'mcp-write')
    return (
      <>
        <p id="write-what" className={s.text}>{summary.actor} wants to call tool <q>{summary.operation}</q> on MCP server <q>{summary.server}</q>.</p>
        <Detail summary={summary} />
      </>
    )
  return (
    <>
      <p id="write-what" className={s.text}>{summary.actor} wants to change <q>{summary.path}</q> in {summary.root}.</p>
      <Diff summary={summary} />
    </>
  )
}

/** The exact http request or mcp tool args. */
function Detail({ summary }: { summary: Extract<WriteSummary, { kind: 'http-write' | 'mcp-write' }> }) {
  if (summary.kind === 'mcp-write')
    return (
      <dl className={s.detail}>
        <dt className="hud-label">Tool</dt>
        <dd><pre className={s.code}>{summary.operation}</pre></dd>
        <dt className="hud-label">Args</dt>
        <dd><pre className={s.code}>{JSON.stringify(summary.args, null, 2)}</pre></dd>
      </dl>
    )
  return (
    <dl className={s.detail}>
      <dt className="hud-label">Request</dt>
      <dd><pre className={s.code}>{summary.method} {summary.url}</pre></dd>
      {summary.body !== null && (
        <>
          <dt className="hud-label">Body</dt>
          <dd><pre className={s.code}>{JSON.stringify(summary.body, null, 2)}</pre></dd>
        </>
      )}
    </dl>
  )
}
