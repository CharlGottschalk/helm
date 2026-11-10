// Built-in DB explorer (task 020): browse tables and columns, run ad hoc read-only SQL on a
// database profile from Settings → Connections. The server runs everything read-only under the
// db connection caps; the browser never sees a host password. Plugins can't use these routes.
// Writes (task 025): a per-profile toggle and every write statement go through Helm's confirmation flow.
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Button, Icon, Input, cx } from '@helm/ui'
import { server, type DbProfileView } from '@helm/client'
import type { DbEngine, DbRows, DbWrite, FilesResult } from '@usetdt/helm-sdk'
import { useWidgetHost } from '../host'
import { useWriteDialog } from '../WriteDialog'
import s from './DbExplorer.module.css'

const PAGE = 100
type Table = { schema: string; name: string; columns: { name: string; type: string }[] }
type View = { kind: 'browse'; table: Table; offset: number } | { kind: 'query' | 'write'; sql: string }
type Outcome = { ms: number; result: FilesResult<DbRows | DbWrite> }
const isWrite = (d: DbRows | DbWrite | null | undefined): d is DbWrite => !!d && 'rowsAffected' in d

const quote = (engine: DbEngine, id: string) => (engine === 'mysql' ? '`' + id.replace(/`/g, '``') + '`' : '"' + id.replace(/"/g, '""') + '"')
const qualified = (engine: DbEngine, t: Table) => (engine === 'postgres' ? `${quote(engine, t.schema)}.${quote(engine, t.name)}` : quote(engine, t.name))
const label = (engine: DbEngine, t: Table) => (engine === 'postgres' && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name)
const browseSql = (engine: DbEngine, t: Table, offset: number) => `SELECT * FROM ${qualified(engine, t)} LIMIT ${PAGE} OFFSET ${offset}`

function toTables(rows: unknown[][]): Table[] {
  const out = new Map<string, Table>()
  for (const [schema, name, column, type] of rows.map((r) => r.map((v) => (v == null ? '' : String(v))))) {
    const key = `${schema}\0${name}`
    if (!out.has(key)) out.set(key, { schema, name, columns: [] })
    out.get(key)!.columns.push({ name: column, type })
  }
  return [...out.values()]
}

const show = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function DbExplorer() {
  const { online } = useWidgetHost()
  const [profiles, setProfiles] = useState<DbProfileView[]>()
  const [profile, setProfile] = useState('')
  const [loadError, setLoadError] = useState<string>()
  const [tables, setTables] = useState<Table[]>()
  const [schemaError, setSchemaError] = useState<string>()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [sql, setSql] = useState('')
  const [view, setView] = useState<View>()
  const [outcome, setOutcome] = useState<Outcome>()
  const [busy, setBusy] = useState(false)
  const [writesOn, setWritesOn] = useState<string[]>([])
  const [writeError, setWriteError] = useState<string>()
  const [writeDialog, askWrite] = useWriteDialog()
  const current = profiles?.find((p) => p.name === profile)
  const writes = writesOn.includes(profile)

  useEffect(() => {
    if (!online) return
    server.dbProfiles().then(
      (r) => {
        setProfiles(r.profiles)
        setWritesOn(r.explorerWrites ?? [])
        setProfile((p) => (r.profiles.some((x) => x.name === p) ? p : r.profiles[0]?.name ?? ''))
      },
      (e: Error) => setLoadError(e.message),
    )
  }, [online])

  const loadSchema = useCallback(() => {
    if (!profile) return
    setTables(undefined)
    setSchemaError(undefined)
    server.dbSchema(profile).then(
      (r) => (r.ok && r.data ? setTables(toTables(r.data.rows)) : setSchemaError(r.error?.message ?? 'Could not list tables')),
      (e: Error) => setSchemaError(e.message),
    )
  }, [profile])
  useEffect(() => {
    setView(undefined)
    setOutcome(undefined)
    loadSchema()
  }, [loadSchema])

  // turning writes on is confirmed in Helm's dialog; turning them off never is
  const toggleWrites = async () => {
    if (!current) return
    setWriteError(undefined)
    try {
      let token: string | undefined
      if (!writes) {
        const c = await server.dbConfirm(current.name, { enable: true })
        if (!(await askWrite(c.summary))) return
        token = c.token
      }
      const r = await server.dbSetWrites(current.name, !writes, token)
      setWritesOn((w) => (r.enabled ? [...w.filter((x) => x !== current.name), current.name] : w.filter((x) => x !== current.name)))
    } catch (e) {
      setWriteError((e as Error).message)
    }
  }

  const exec = async (next: View) => {
    if (!current) return
    let token = ''
    if (next.kind === 'write') {
      // the server describes the exact statement and issues a one-time token; nothing runs unless the user confirms
      setWriteError(undefined)
      try {
        const c = await server.dbConfirm(current.name, { sql: next.sql })
        if (!(await askWrite(c.summary))) return
        token = c.token
      } catch (e) {
        return setWriteError((e as Error).message)
      }
    }
    setView(next)
    setBusy(true)
    const started = performance.now()
    try {
      const text = next.kind === 'browse' ? browseSql(current.engine, next.table, next.offset) : next.sql
      const result = next.kind === 'write' ? await server.dbWrite(current.name, text, token) : await server.dbQuery(current.name, text)
      setOutcome({ ms: performance.now() - started, result })
    } catch (e) {
      setOutcome({ ms: performance.now() - started, result: { ok: false, data: null, error: { code: 'request_failed', message: (e as Error).message } } })
    } finally {
      setBusy(false)
    }
  }
  const runSql = () => sql.trim() && void exec({ kind: 'query', sql })
  const onKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && (e.preventDefault(), runSql())

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (tables ?? []).filter((t) => !f || t.name.toLowerCase().includes(f) || t.columns.some((c) => c.name.toLowerCase().includes(f)))
  }, [tables, filter])

  if (!online) return <p className={s.note}>Start the Helm server to explore databases.</p>
  if (loadError) return <p className={s.error} role="alert">{loadError}</p>
  if (!profiles) return <p className={s.note}>Loading database profiles…</p>
  if (!profiles.length) return <p className={s.note}>No database profiles yet. Add one in Settings → Connections or with <code>helm db add</code>.</p>

  const res = outcome?.result
  const rows = res?.data && !isWrite(res.data) ? res.data : undefined
  const browse = view?.kind === 'browse' ? view : undefined
  return (
    <div className={s.explorer}>
      <div className={s.bar}>
        <label className={s.pick}>
          <span className="hud-label">Database</span>
          <select className={s.select} value={profile} onChange={(e) => setProfile(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>{p.name} · {p.engine}</option>
            ))}
          </select>
        </label>
        <span className={s.note}>
          {writes ? 'Writes on · Run stays read-only, Run write asks for each statement' : `Read-only · ${current?.engine === 'sqlite' ? 'file opened read-only' : 'read-only transaction'}`} · 5 s, 1000 rows, 1 MiB
        </span>
        <Button size="sm" variant={writes ? 'danger' : 'ghost'} icon="sliders" aria-pressed={writes} onClick={() => void toggleWrites()}>{writes ? 'Writes on' : 'Writes off'}</Button>
        <Button size="sm" variant="ghost" icon="reset" onClick={loadSchema}>Refresh</Button>
      </div>
      {writeError && <p className={s.error} role="alert">{writeError}</p>}
      {writeDialog}

      <div className={s.split}>
        <aside className={s.tables} aria-label="Tables">
          <Input icon="search" placeholder="Filter tables and columns" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tables and columns" />
          {schemaError ? (
            <p className={s.error} role="alert">{schemaError}</p>
          ) : !tables ? (
            <p className={s.note}>Loading tables…</p>
          ) : !shown.length ? (
            <p className={s.note}>{tables.length ? 'No match.' : 'No tables.'}</p>
          ) : (
            <ul className={s.tableList}>
              {shown.map((t) => {
                const key = `${t.schema}.${t.name}`
                const active = browse && browse.table.schema === t.schema && browse.table.name === t.name
                return (
                  <li key={key}>
                    <div className={cx(s.tableRow, active && s.active)}>
                      <button className={s.twisty} aria-expanded={!!open[key]} aria-label={`${open[key] ? 'Hide' : 'Show'} columns of ${t.name}`} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                        <Icon name={open[key] ? 'chevD' : 'chevR'} size={12} />
                      </button>
                      <button className={s.tableName} onClick={() => current && void exec({ kind: 'browse', table: t, offset: 0 })} title={`Browse ${label(current!.engine, t)}`}>
                        {label(current!.engine, t)}
                      </button>
                      <span className={s.count}>{t.columns.length}</span>
                    </div>
                    {open[key] && (
                      <ul className={s.columns}>
                        {t.columns.map((c) => (
                          <li key={c.name}><span>{c.name}</span><span className={s.type}>{c.type}</span></li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className={s.main}>
          <div className={s.editor}>
            <textarea
              className={s.sql}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={onKey}
              placeholder="SELECT … (one statement; Ctrl+Enter runs it)"
              aria-label="SQL"
              spellCheck={false}
              rows={5}
            />
            <div className={s.editorActions}>
              {writes && (
                <Button size="sm" variant="danger" icon="sliders" disabled={busy || !sql.trim()} onClick={() => sql.trim() && void exec({ kind: 'write', sql })}>{busy && view?.kind === 'write' ? 'Writing…' : 'Run write'}</Button>
              )}
              <Button size="sm" variant="primary" icon="bolt" disabled={busy || !sql.trim()} onClick={runSql}>{busy && view?.kind === 'query' ? 'Running…' : 'Run'}</Button>
            </div>
          </div>

          {view && (
            <div className={s.status}>
              <span className={s.statusText} role="status">
                {view.kind === 'browse' ? `${label(current!.engine, view.table)} · rows ${view.offset + 1}–${view.offset + (rows?.rows.length ?? 0)}` : view.kind === 'write' ? 'Write' : 'Query'}
                {busy ? ' · running…' : res?.ok && res.data ? ` · ${isWrite(res.data) ? `${res.data.rowsAffected} row${res.data.rowsAffected === 1 ? '' : 's'} affected` : `${res.data.rows.length} row${res.data.rows.length === 1 ? '' : 's'}`} · ${Math.round(outcome!.ms)} ms` : ''}
              </span>
              {browse && (
                <span className={s.pager}>
                  <Button size="sm" variant="ghost" icon="chevL" disabled={busy || browse.offset === 0} onClick={() => void exec({ ...browse, offset: Math.max(0, browse.offset - PAGE) })}>Previous</Button>
                  <Button size="sm" variant="ghost" disabled={busy || !res?.ok || (rows?.rows.length ?? 0) < PAGE} onClick={() => void exec({ ...browse, offset: browse.offset + PAGE })}>Next <Icon name="chevR" size={14} /></Button>
                </span>
              )}
            </div>
          )}

          {res && !busy && (res.ok && res.data ? rows && <Grid data={rows} /> : <p className={s.error} role="alert">{res.error?.message ?? 'The query failed'}</p>)}
        </section>
      </div>
    </div>
  )
}

function Grid({ data }: { data: DbRows }) {
  if (!data.columns.length) return <p className={s.note}>The statement returned no columns.</p>
  return (
    <div className={s.grid}>
      <table>
        <thead>
          <tr>{data.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => {
                const t = show(v)
                return <td key={j}>{t === null ? <span className={s.null}>NULL</span> : t}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!data.rows.length && <p className={s.note}>No rows.</p>}
    </div>
  )
}
