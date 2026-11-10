import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, Input, themes, useModal } from '@helm/ui'
import { server, type DbProfileInput, type DbProfileView, type HttpProfileView, type McpServerView } from '@helm/client'
import { DB_ENGINES, validateManifest, type DbEngine } from '@usetdt/helm-sdk'
import { cx } from '../../lib/util'
import { chromeOf, useHelm } from '../../state/store'
import { Icon, type IconName } from '@helm/ui'
import s from './SettingsModal.module.css'

type Section = 'appearance' | 'plugins' | 'connections' | 'shortcuts'

const sections: { id: Section; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'plugins', label: 'Plugins', icon: 'layers' },
  { id: 'connections', label: 'Connections', icon: 'link' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
]

const shortcuts: [string, string][] = [
  ['/', 'Focus the floating chat'],
  ['Ctrl ,', 'Open settings'],
  ['Alt 1 – 3', 'Switch workspace'],
  ['Enter', 'Send message · jump to first brain match'],
  ['Shift Enter', 'New line in a message'],
  ['Esc', 'Close menus, dialogs and search'],
  ['Middle-click', 'Close a tab'],
]

export function SettingsModal() {
  const { settingsOpen, settingsSection } = useHelm()
  const [section, setSection] = useState<Section>('appearance')
  useEffect(() => void (settingsOpen && settingsSection && setSection(settingsSection)), [settingsOpen, settingsSection])
  if (!settingsOpen) return null
  return <SettingsDialogBody section={section} setSection={setSection} />
}

function SettingsDialogBody({ section, setSection }: { section: Section; setSection: (s: Section) => void }) {
  const { state, actions, pluginThemes } = useHelm()
  const { theme, scanlines, reduceMotion } = state.settings
  const choices = [
    ...themes.map((t) => ({ key: t.id as string, name: t.name, tagline: t.tagline, plugin: undefined as string | undefined, warnings: [] as string[] })),
    ...pluginThemes.map((t) => ({ key: t.key, name: t.name, tagline: t.tagline, plugin: t.plugin, warnings: t.warnings })),
  ]
  const modal = useModal(actions.closeSettings)
  useEffect(() => modal.ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), [modal.ref])

  return (
    <dialog className={cx('hud-modal', s.overlay)} aria-labelledby="settings-title" {...modal}>
      <div className={s.dialog}>
        <header className={s.header}>
          <span className={s.marker} />
          <h2 id="settings-title" className={s.title}>System settings</h2>
          <span className={s.code}>S-00</span>
          <button className={s.close} onClick={actions.closeSettings} aria-label="Close settings">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className={s.body}>
          <nav className={s.nav} aria-label="Settings sections">
            {sections.map((sec) => (
              <button key={sec.id} className={cx(s.navItem, section === sec.id && s.active)} onClick={() => setSection(sec.id)}>
                <Icon name={sec.icon} size={15} />
                {sec.label}
              </button>
            ))}
          </nav>

          <div className={s.content}>
            {section === 'appearance' && (
              <>
                <Group label="Theme" hint="Applies instantly and is remembered on this device. Approved theme plugins appear here in every workspace.">
                  <div className={s.themes} role="radiogroup" aria-label="Theme">
                    {choices.map((t) => (
                      <button
                        key={t.key}
                        role="radio"
                        aria-checked={theme === t.key}
                        className={cx(s.themeCard, theme === t.key && s.selected)}
                        onClick={() => actions.updateSettings({ theme: t.key })}
                        title={t.warnings.length ? t.warnings.join('\n') : undefined}
                      >
                        <ThemePreview id={t.key} chrome={chromeOf(t.key, pluginThemes)} />
                        <span className={s.themeMeta}>
                          <span className={s.themeName}>
                            {t.name}
                            {theme === t.key && <Icon name="check" size={14} stroke={2.2} />}
                          </span>
                          <span className={s.themeTag}>{t.tagline}</span>
                          {t.plugin && (
                            <span className={s.themeTag}>
                              From {t.plugin} {t.warnings.length > 0 && <Badge tone="amber">Below AA contrast</Badge>}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </Group>

                <Group label="Effects">
                  <Toggle
                    label="Scanlines"
                    hint={theme === 'glass' ? 'Aurora Glass has no scanlines, so this only affects the other themes.' : 'A faint CRT line overlay across the whole interface.'}
                    checked={scanlines}
                    onChange={(v) => actions.updateSettings({ scanlines: v })}
                  />
                  <Toggle
                    label="Reduce motion"
                    hint="Turns off view entrances, glitches, pulses and the drifting aurora."
                    checked={reduceMotion}
                    onChange={(v) => actions.updateSettings({ reduceMotion: v })}
                  />
                </Group>
              </>
            )}

            {section === 'plugins' && <PluginsSection />}

            {section === 'connections' && <><ConnectionsSection /><ServicesSection /><McpServersSection /></>}

            {section === 'shortcuts' && (
              <Group label="Keyboard">
                <ul className={s.shortcuts}>
                  {shortcuts.map(([keys, what]) => (
                    <li key={keys}>
                      <span>{what}</span>
                      <span className={s.keys}>
                        {keys.split(' ').map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </Group>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}

function Group({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <section className={s.group}>
      <div className={s.groupHead}>
        <h3>{label}</h3>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={s.toggleRow}>
      <div>
        <div className={s.toggleLabel}>{label}</div>
        <div className={s.toggleHint}>{hint}</div>
      </div>
      <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cx(s.switch, checked && s.on)} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  )
}

type HttpCallDecl = { method?: string; path?: string; query?: Record<string, string>; body?: unknown; write?: boolean }
type OAuthDecl = { authorizeUrl?: string; tokenUrl?: string; scopes?: string[] }
type ConnDecl = { id: string; kind: string; operations?: string[]; writes?: string[]; calls?: Record<string, HttpCallDecl>; oauth2?: OAuthDecl; queries?: Record<string, { sql?: string; write?: boolean }>; root?: string; paths?: string[]; engine?: string; service?: string; server?: string }
type Decl = { name?: string; connections?: ConnDecl[]; permissions?: { write?: boolean }; capabilities?: string[] }

/** One line per connection for plugin review: what it may call, and where. */
const describeConn = (c: ConnDecl) => {
  // reads only: each write is listed on its own line below
  const ops = (c.operations ?? Object.keys(c.calls ?? {}).filter((k) => c.calls![k]?.write !== true).concat(Object.keys(c.queries ?? {}).filter((k) => c.queries![k]?.write !== true))).filter((o) => o !== 'write')
  const where =
    c.kind === 'files' ? ` of ${(c.paths ?? []).join(', ')} in the ${c.root}`
    : c.kind === 'db' ? ` (read-only ${c.engine} queries) on database profile ${c.service}`
    : c.kind === 'http' ? ` (read calls) on service profile ${c.service}`
    : c.kind === 'mcp' ? ` (read tools) on MCP server ${c.server}`
    : ''
  return `${c.id} (${c.kind}): ${ops.join(', ')}${where}`
}
/** An http call as review shows it: method, path, query and the exact body. */
const describeCall = (x: HttpCallDecl) =>
  `${x.method} ${x.path}${x.query && Object.keys(x.query).length ? '?' + Object.entries(x.query).map(([k, v]) => `${k}=${v}`).join('&') : ''}${x.body !== undefined ? '\n' + JSON.stringify(x.body, null, 2) : ''}`

const loadPlugins = () => server.plugins()

/** Plugins: install (scripts never run), review what each declares, approve, enable per workspace. */
function PluginsSection() {
  const { ws } = useHelm()
  const { online, data, error, busy, act } = useConnectionList(loadPlugins)
  const plugins = data?.plugins
  const [spec, setSpec] = useState('')

  const install = (e: FormEvent) => {
    e.preventDefault()
    if (spec.trim()) void act('install', () => server.installPlugin(spec.trim()).then(() => setSpec('')))
  }

  if (!online) return <Group label="Plugins" hint="Start the Helm server to install and manage plugins." />
  return (
    <>
      <Group label="Install" hint="An npm package name, a git URL or a plugin folder (linked, for development). Install scripts never run. Plugins are installed for this Helm and enabled per workspace.">
        <form className={s.installRow} onSubmit={install}>
          <Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="helm-plugin-example or ./my-plugin" aria-label="Plugin to install" icon="plus" wrapClassName={s.installInput} />
          <Button type="submit" variant="primary" disabled={!spec.trim() || !!busy}>{busy === 'install' ? 'Installing…' : 'Install'}</Button>
        </form>
        {error && <p className={s.pluginError} role="alert">{error}</p>}
      </Group>
      <Group label="Installed" hint={`Review what a plugin declares before approving it; any change to its declarations asks again. Enabling applies to ${ws.name}.`}>
        {!plugins ? (
          <p className={s.toggleHint}>Loading…</p>
        ) : !plugins.length ? (
          <p className={s.toggleHint}>No plugins installed.</p>
        ) : (
          <ul className={s.plugins}>
            {plugins.map((p) => {
              const invalid = p.bundles.flatMap((b) => (b.error ? [`${b.dir}: ${b.error}`] : b.kind === 'theme' ? [] : validateManifest(b.manifest, b.kind).map((x) => `${b.dir}: ${x}`)))
              const hasExtensions = p.bundles.some((b) => b.kind !== 'theme')
              const enabled = p.enabledIn.includes(ws.id)
              const canApprove = p.supported && !p.approved && !invalid.length && !p.problems.length
              return (
                <li key={p.name} className={s.plugin}>
                  <div className={s.pluginHead}>
                    <span className={s.toggleLabel}>{p.name}<span className={s.pluginVersion}>{p.version && ` ${p.version}`}</span></span>
                    {p.linked && <Badge tone="violet">Linked</Badge>}
                    {!p.supported ? <Badge tone="red">Needs a newer Helm</Badge> : p.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Needs review</Badge>}
                  </div>
                  <ul className={s.decls}>
                    {p.bundles.map((b) => {
                      const m = (b.manifest ?? {}) as Decl
                      if (b.theme)
                        return (
                          <li key={b.kind + b.dir}>
                            <span className={s.declKind}>theme</span> {m.name ?? b.id}
                            <span className={s.toggleHint}>
                              {` · ${Object.keys(b.theme.tokens).length} tokens${b.theme.chrome ? ' and a rail sub-theme' : ''} · no calls or writes · in every workspace once approved`}
                            </span>
                            {b.theme.warnings.map((w) => (
                              <span key={w} className={s.writeQuery}>
                                <span className={s.writeLabel}>Below AA contrast</span>
                                <code>{w}</code>
                              </span>
                            ))}
                          </li>
                        )
                      return (
                        <li key={b.kind + b.dir}>
                          <span className={s.declKind}>{b.kind}</span> {m.name ?? b.id}
                          <span className={s.toggleHint}>
                            {' · '}
                            {(m.connections ?? []).map(describeConn).join('; ') || 'no connections'}
                            {m.permissions?.write ? ' · asks to write' : ' · read-only'}
                            {m.capabilities?.length ? ` · capabilities: ${m.capabilities.join(', ')}` : ''}
                          </span>
                          {/* every http call's method, path and body: the approval covers exactly these; writes are also confirmed per call */}
                          {(m.connections ?? []).flatMap((c) =>
                            Object.entries(c.kind === 'http' ? c.calls ?? {} : {}).map(([name, x]) => (
                              <span key={c.id + name} className={s.writeQuery}>
                                <span className={x.write === true ? s.writeLabel : s.callLabel}>{x.write === true ? 'Writes' : 'Calls'} · {c.id}.{name} on {c.service}</span>
                                <code>{describeCall(x)}</code>
                              </span>
                            )),
                          )}
                          {/* OAuth2 sign-in: the approval covers these exact URLs and scopes */}
                          {(m.connections ?? []).flatMap((c) =>
                            c.kind === 'http' && c.oauth2 ? [(
                              <span key={c.id + ':oauth2'} className={s.writeQuery}>
                                <span className={s.callLabel}>Signs in · {c.id} on {c.service} with OAuth2</span>
                                <code>{`authorize ${c.oauth2.authorizeUrl}\ntoken ${c.oauth2.tokenUrl}\nscopes ${(c.oauth2.scopes ?? []).join(' ') || '(none)'}`}</code>
                              </span>
                            )] : [],
                          )}
                          {/* mcp write tools and files writes: each call is confirmed */}
                          {(m.connections ?? []).flatMap((c) =>
                            c.kind === 'mcp' ? (c.writes ?? []).map((tool) => (
                              <span key={c.id + tool} className={s.writeQuery}>
                                <span className={s.writeLabel}>Writes · {c.id}.{tool} on MCP server {c.server}</span>
                                <code>tool {tool}</code>
                              </span>
                            ))
                            : c.kind === 'files' && c.operations?.includes('write') ? [(
                              <span key={c.id + ':write'} className={s.writeQuery}>
                                <span className={s.writeLabel}>Writes · {c.id} replaces existing files in the {c.root}</span>
                                <code>{(c.paths ?? []).join('\n')}</code>
                              </span>
                            )]
                            : [],
                          )}
                          {/* every write query's exact SQL: the approval covers it, and each call is confirmed */}
                          {(m.connections ?? []).flatMap((c) =>
                            Object.entries(c.kind === 'db' ? c.queries ?? {} : {})
                              .filter(([, q]) => q?.write === true)
                              .map(([name, q]) => (
                                <span key={c.id + name} className={s.writeQuery}>
                                  <span className={s.writeLabel}>Writes · {c.id}.{name} on {c.service}</span>
                                  <code>{String(q.sql)}</code>
                                </span>
                              )),
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {[...p.problems, ...invalid].map((x) => (
                    <p key={x} className={s.pluginError}>{x}</p>
                  ))}
                  {hasExtensions && <Toggle
                    label={`Enabled in ${ws.name}`}
                    hint={p.approved ? 'Its widgets and tools appear in this workspace’s library.' : 'Approve it first.'}
                    checked={enabled}
                    disabled={!p.approved && !enabled}
                    onChange={(v) => void act(p.name, () => server.setPluginEnabled(ws.id, p.name, v))}
                  />}
                  <div className={s.pluginActions}>
                    {canApprove && (
                      <Button variant="primary" size="sm" icon="check" disabled={!!busy} onClick={() => void act(p.name, () => server.approvePlugin(p.name, p.digest))}>
                        Approve these declarations
                      </Button>
                    )}
                    <Button variant="danger" size="sm" disabled={!!busy} onClick={() => window.confirm(`Uninstall ${p.name} from Helm? It is removed from every workspace.`) && void act(p.name, () => server.removePlugin(p.name))}>
                      Uninstall
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Group>
    </>
  )
}

const ENGINE_LABEL: Record<DbEngine, string> = { sqlite: 'SQLite', postgres: 'Postgres', mysql: 'MySQL' }
const DEFAULT_PORT: Record<DbEngine, string> = { sqlite: '', postgres: '5432', mysql: '3306' }
type DbForm = { name: string; engine: DbEngine; path: string; host: string; port: string; database: string; user: string; password: string }
const emptyForm = (engine: DbEngine = 'postgres'): DbForm => ({ name: '', engine, path: '', host: '127.0.0.1', port: DEFAULT_PORT[engine], database: '', user: '', password: '' })

const loadDb = () => server.dbProfiles()

/**
 * Database profiles for `db` connections: plugins name a profile, never a host or password.
 * The password goes to the local server once and is never sent back.
 */
function ConnectionsSection() {
  const { online, data, error, busy, act } = useConnectionList(loadDb)
  const [form, setForm] = useState<DbForm>()
  const [editing, setEditing] = useState<string>()
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string }>>({})

  const test = (name: string) =>
    act(`test:${name}`, async () => {
      const r = await server.testDbProfile(name)
      setTests((t) => ({ ...t, [name]: r.ok ? { ok: true, text: 'Connected; a read-only query ran.' } : { ok: false, text: r.error?.message ?? 'Failed' } }))
    })
  const edit = (p: DbProfileView) => {
    setEditing(p.name)
    setForm({ ...emptyForm(p.engine), name: p.name, path: p.path ?? '', host: p.host ?? '', port: p.port ? String(p.port) : DEFAULT_PORT[p.engine], database: p.database ?? '', user: p.user ?? '' })
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    const body: DbProfileInput =
      form.engine === 'sqlite'
        ? { name: form.name.trim(), engine: 'sqlite', path: form.path.trim() }
        : { name: form.name.trim(), engine: form.engine, host: form.host.trim(), port: Number(form.port), database: form.database.trim(), user: form.user.trim(),
            // editing with the field left empty keeps the stored password
            ...(form.password || !editing ? { password: form.password } : {}) }
    void act('save', async () => {
      await server.saveDbProfile(body)
      setForm(undefined)
      setEditing(undefined)
      await test(body.name)
    })
  }
  const set = (k: keyof DbForm) => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value })

  if (!online) return <Group label="Connections" hint="Start the Helm server to manage database connections." />
  return (
    <>
      <Group
        label="Databases"
        hint={`Plugins with a db connection run their own named, read-only queries against a profile you set up here; they name the profile, never see the host or password. Passwords are kept in ${data?.store ?? 'the system keychain'}. Use a database user that can only read.`}
      >
        {error && <p className={s.pluginError} role="alert">{error}</p>}
        {!data ? (
          <p className={s.toggleHint}>Loading…</p>
        ) : !data.profiles.length && !form ? (
          <p className={s.toggleHint}>No database profiles yet.</p>
        ) : (
          <ul className={s.plugins}>
            {data.profiles.map((p) => (
              <li key={p.name} className={s.plugin}>
                <div className={s.pluginHead}>
                  <span className={s.toggleLabel}>{p.name}</span>
                  <Badge tone="violet">{ENGINE_LABEL[p.engine]}</Badge>
                </div>
                <p className={s.toggleHint}>{p.engine === 'sqlite' ? `${p.path} (opened read-only)` : `${p.user}@${p.host}:${p.port}/${p.database}${p.hasPassword ? '' : ' · no password stored'}`}</p>
                {tests[p.name] && (
                  <p className={tests[p.name].ok ? s.toggleHint : s.pluginError} role="status">{tests[p.name].text}</p>
                )}
                <div className={s.pluginActions}>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void test(p.name)}>{busy === `test:${p.name}` ? 'Testing…' : 'Test'}</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => edit(p)}>Edit</Button>
                  <Button size="sm" variant="danger" disabled={!!busy} onClick={() => window.confirm(`Remove the database profile ${p.name}? Plugins that use it stop working until you add it again.`) && void act(`rm:${p.name}`, () => server.removeDbProfile(p.name))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!form && (
          <div className={cx(s.pluginActions, s.dbAdd)}>
            <Button size="sm" variant="primary" icon="plus" onClick={() => (setEditing(undefined), setForm(emptyForm()))}>Add database</Button>
          </div>
        )}
      </Group>

      {form && (
        <Group label={editing ? `Edit ${editing}` : 'Add a database'} hint="The name is what a plugin's manifest asks for as its service, for example local-app.">
          <form className={s.dbForm} onSubmit={save}>
            <div className={s.dbEngines} role="radiogroup" aria-label="Engine">
              {DB_ENGINES.map((e) => (
                <Button key={e} type="button" size="sm" role="radio" aria-checked={form.engine === e} variant={form.engine === e ? 'primary' : 'ghost'}
                  onClick={() => setForm((f) => f && { ...f, engine: e, port: f.port === DEFAULT_PORT[f.engine] ? DEFAULT_PORT[e] : f.port })}>
                  {ENGINE_LABEL[e]}
                </Button>
              ))}
            </div>
            <Field label="Name"><Input aria-label="Name" value={form.name} onChange={set('name')} disabled={!!editing} required pattern="[a-z0-9][a-z0-9_\-]{0,63}" placeholder="local-app" /></Field>
            {form.engine === 'sqlite' ? (
              <Field label="File path" wide><Input aria-label="File path" value={form.path} onChange={set('path')} required placeholder="/home/me/data/app.db" /></Field>
            ) : (
              <>
                <Field label="Host"><Input aria-label="Host" value={form.host} onChange={set('host')} required /></Field>
                <Field label="Port"><Input aria-label="Port" value={form.port} onChange={set('port')} required inputMode="numeric" pattern="[0-9]{1,5}" /></Field>
                <Field label="Database"><Input aria-label="Database" value={form.database} onChange={set('database')} required /></Field>
                <Field label="User"><Input aria-label="User" value={form.user} onChange={set('user')} required autoComplete="off" /></Field>
                <Field label="Password" wide>
                  <Input aria-label="Password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder={editing ? 'Leave empty to keep the stored password' : ''} />
                </Field>
              </>
            )}
            <div className={cx(s.pluginActions, s.dbWide)}>
              <Button type="button" size="sm" variant="ghost" onClick={() => (setForm(undefined), setEditing(undefined))}>Cancel</Button>
              <Button type="submit" size="sm" variant="primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save and test'}</Button>
            </div>
          </form>
        </Group>
      )}
    </>
  )
}

/** Load a list from the server and run actions on it, reloading after each; shared by the connection groups. */
function useConnectionList<T>(load: () => Promise<T>) {
  const { online } = useHelm()
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const reload = useCallback(() => load().then((r) => (setData(r), setError(undefined)), (e: Error) => setError(e.message)), [load])
  useEffect(() => void (online && reload()), [online, reload])
  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key)
    setError(undefined)
    try {
      await run()
      await reload()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(undefined)
    }
  }
  return { online, data, error, busy, act, reload }
}

type HttpForm = { name: string; baseUrl: string; header: string; scheme: 'bearer' | 'raw'; token: string; auth: 'token' | 'oauth2'; clientId: string; clientSecret: string }
const emptyHttp = (): HttpForm => ({ name: '', baseUrl: 'https://', header: 'Authorization', scheme: 'bearer', token: '', auth: 'token', clientId: '', clientSecret: '' })
/** One line about how a profile authenticates; never a secret. */
const describeAuth = (p: HttpProfileView) =>
  p.auth === 'oauth2'
    ? `OAuth2 · ${p.oauth?.connected ? `connected${p.oauth.scopes.length ? ` (${p.oauth.scopes.join(' ')})` : ''}` : 'not connected'}`
    : p.hasToken ? `token in ${p.header}${p.scheme === 'bearer' ? ' (Bearer)' : ''}` : 'no token stored'
const loadHttp = () => server.httpProfiles()

/** Service profiles for `http` connections: a base URL and a token; plugins name the profile only. */
function ServicesSection() {
  const { ws } = useHelm()
  const { online, data, error, busy, act, reload } = useConnectionList(loadHttp)
  const [form, setForm] = useState<HttpForm>()
  // sign-in finishes in the provider's window: reload when the user comes back
  useEffect(() => {
    const back = () => void reload()
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  }, [reload])
  const connect = (name: string) => {
    // open the window inside the click (popup blockers), then point it at the provider
    const w = window.open('', '_blank')
    void act(`connect:${name}`, () =>
      server.connectHttpProfile(ws.id, name).then(
        (r) => {
          if (!w) throw new Error('The browser blocked the sign-in window; allow pop-ups for Helm and try again')
          w.opener = null
          w.location.href = r.url
        },
        (e) => (w?.close(), Promise.reject(e)),
      ))
  }
  const [editing, setEditing] = useState<string>()
  const set = (k: keyof HttpForm) => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value })
  const close = () => (setForm(undefined), setEditing(undefined))
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    const { token, clientSecret, clientId, ...rest } = form
    // editing with a secret left empty keeps the stored one
    const secret = rest.auth === 'oauth2' ? (clientSecret || !editing ? { clientSecret, clientId: clientId.trim() } : { clientId: clientId.trim() }) : token || !editing ? { token } : {}
    void act('save', () => server.saveHttpProfile({ ...rest, name: rest.name.trim(), baseUrl: rest.baseUrl.trim(), ...secret })).then((ok) => ok && close())
  }
  if (!online) return null
  return (
    <>
      <Group
        label="Services"
        hint={`Plugins with an http connection send their own declared calls to a service you set up here. Helm sends each call; plugins never see the URL, token or sign-in. Tokens and OAuth2 secrets are kept in ${data?.store ?? 'the system keychain'}. Use a token that can only read.`}
      >
        {error && <p className={s.pluginError} role="alert">{error}</p>}
        {!data ? (
          <p className={s.toggleHint}>Loading…</p>
        ) : !data.profiles.length && !form ? (
          <p className={s.toggleHint}>No services yet.</p>
        ) : (
          <ul className={s.plugins}>
            {data.profiles.map((p: HttpProfileView) => (
              <li key={p.name} className={s.plugin}>
                <div className={s.pluginHead}>
                  <span className={s.toggleLabel}>{p.name}</span>
                  <Badge tone="violet">HTTP</Badge>
                </div>
                <p className={s.toggleHint}>{p.baseUrl} · {describeAuth(p)}</p>
                <div className={s.pluginActions}>
                  {p.auth === 'oauth2' && (
                    <Button size="sm" variant={p.oauth?.connected ? 'ghost' : 'primary'} disabled={!!busy} onClick={() => connect(p.name)}>
                      {busy === `connect:${p.name}` ? 'Opening…' : p.oauth?.connected ? 'Reconnect' : 'Connect'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => (setEditing(p.name), setForm({ ...emptyHttp(), name: p.name, baseUrl: p.baseUrl, header: p.header, scheme: p.scheme, auth: p.auth, clientId: p.clientId ?? '' }))}>Edit</Button>
                  <Button size="sm" variant="danger" disabled={!!busy} onClick={() => window.confirm(`Remove the service ${p.name} and its token? Plugins that use it stop working until you add it again.`) && void act(`rm:${p.name}`, () => server.removeHttpProfile(p.name))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!form && (
          <div className={cx(s.pluginActions, s.dbAdd)}>
            <Button size="sm" variant="primary" icon="plus" onClick={() => (setEditing(undefined), setForm(emptyHttp()))}>Add service</Button>
          </div>
        )}
      </Group>
      {form && (
        <Group label={editing ? `Edit ${editing}` : 'Add a service'} hint="The name is what a plugin's manifest asks for as its service, for example github. Use https; http works only for this machine.">
          <form className={s.dbForm} onSubmit={save}>
            <Field label="Name"><Input aria-label="Name" value={form.name} onChange={set('name')} disabled={!!editing} required pattern="[a-z0-9][a-z0-9_\-]{0,63}" placeholder="github" /></Field>
            <Field label="Base URL"><Input aria-label="Base URL" value={form.baseUrl} onChange={set('baseUrl')} required placeholder="https://api.github.com" /></Field>
            <div className={s.dbField}>
              <span className={s.toggleHint}>Sign-in</span>
              <div className={s.dbEngines} role="radiogroup" aria-label="Sign-in">
                {(['token', 'oauth2'] as const).map((k) => (
                  <Button key={k} type="button" size="sm" role="radio" aria-checked={form.auth === k} variant={form.auth === k ? 'primary' : 'ghost'} onClick={() => setForm((f) => f && { ...f, auth: k })}>
                    {k === 'token' ? 'Token' : 'OAuth2'}
                  </Button>
                ))}
              </div>
            </div>
            {form.auth === 'oauth2' ? (
              <>
                <Field label="Client ID"><Input aria-label="Client ID" value={form.clientId} onChange={set('clientId')} required pattern="[!-~]{1,512}" /></Field>
                <Field label="Client secret" wide>
                  <Input aria-label="Client secret" type="password" value={form.clientSecret} onChange={set('clientSecret')} autoComplete="new-password" placeholder={editing ? 'Leave empty to keep the stored secret' : 'Optional for public clients'} />
                </Field>
                <p className={cx(s.toggleHint, s.dbWide)}>
                  Create an OAuth client with the service and register this redirect URI: <code>{data?.redirectUri}</code>. After saving, Connect signs in with the URLs and scopes the plugin declares.
                </p>
              </>
            ) : (<>
            <Field label="Header"><Input aria-label="Header" value={form.header} onChange={set('header')} required pattern="[A-Za-z0-9\-]{1,64}" /></Field>
            <div className={s.dbField}>
              <span className={s.toggleHint}>Token format</span>
              <div className={s.dbEngines} role="radiogroup" aria-label="Token format">
                {(['bearer', 'raw'] as const).map((k) => (
                  <Button key={k} type="button" size="sm" role="radio" aria-checked={form.scheme === k} variant={form.scheme === k ? 'primary' : 'ghost'} onClick={() => setForm((f) => f && { ...f, scheme: k })}>
                    {k === 'bearer' ? 'Bearer token' : 'Token as is'}
                  </Button>
                ))}
              </div>
            </div>
            <Field label="Token" wide>
              <Input aria-label="Token" type="password" value={form.token} onChange={set('token')} autoComplete="new-password" placeholder={editing ? 'Leave empty to keep the stored token' : 'Optional for public APIs'} />
            </Field>
            </>)}
            <div className={cx(s.pluginActions, s.dbWide)}>
              <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" size="sm" variant="primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        </Group>
      )}
    </>
  )
}

type McpForm = { name: string; transport: 'stdio' | 'http'; command: string; args: string; tokenEnv: string; url: string; token: string }
const emptyMcp = (): McpForm => ({ name: '', transport: 'stdio', command: '', args: '', tokenEnv: '', url: 'https://', token: '' })
const loadMcp = () => server.mcpServers()

/** MCP servers for `mcp` connections: a command Helm starts, or an HTTP URL; plugins call only their declared tools. */
function McpServersSection() {
  const { online, data, error, busy, act } = useConnectionList(loadMcp)
  const [form, setForm] = useState<McpForm>()
  const [editing, setEditing] = useState<string>()
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string }>>({})
  const set = (k: keyof McpForm) => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value })
  const close = () => (setForm(undefined), setEditing(undefined))
  const test = (name: string) =>
    act(`test:${name}`, async () => {
      const r = await server.testMcpServer(name)
      setTests((t) => ({ ...t, [name]: r.ok ? { ok: true, text: `Connected; tools: ${r.data!.tools.join(', ') || 'none'}` } : { ok: false, text: r.error?.message ?? 'Failed' } }))
    })
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    const name = form.name.trim()
    const token = form.token || !editing ? { token: form.token } : {}
    // one argument per line, so arguments can contain spaces
    const body = form.transport === 'http' ? { name, url: form.url.trim(), ...token } : { name, command: form.command.trim(), args: form.args.split('\n').map((a) => a.trim()).filter(Boolean), tokenEnv: form.tokenEnv.trim() || undefined, ...token }
    void act('save', () => server.saveMcpServer(body)).then((ok) => ok && (close(), void test(name)))
  }
  if (!online) return null
  return (
    <>
      <Group
        label="MCP servers"
        hint={`Plugins with an mcp connection call only the tools they declare on a server you set up here. Helm starts or connects to the server; plugins never see its command, URL or token. Tokens are kept in ${data?.store ?? 'the system keychain'}.`}
      >
        {error && <p className={s.pluginError} role="alert">{error}</p>}
        {!data ? (
          <p className={s.toggleHint}>Loading…</p>
        ) : !data.servers.length && !form ? (
          <p className={s.toggleHint}>No MCP servers yet.</p>
        ) : (
          <ul className={s.plugins}>
            {data.servers.map((m: McpServerView) => (
              <li key={m.name} className={s.plugin}>
                <div className={s.pluginHead}>
                  <span className={s.toggleLabel}>{m.name}</span>
                  <Badge tone="violet">{m.url ? 'HTTP' : 'Command'}</Badge>
                </div>
                <p className={s.toggleHint}>
                  {m.url ?? [m.command, ...(m.args ?? [])].join(' ')}
                  {m.hasToken ? ` · token${m.tokenEnv ? ` in ${m.tokenEnv}` : ''}` : m.tokenEnv ? ` · no token stored for ${m.tokenEnv}` : ''}
                </p>
                {tests[m.name] && <p className={tests[m.name].ok ? s.toggleHint : s.pluginError} role="status">{tests[m.name].text}</p>}
                <div className={s.pluginActions}>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void test(m.name)}>{busy === `test:${m.name}` ? 'Testing…' : 'Test'}</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => (setEditing(m.name), setForm({ ...emptyMcp(), name: m.name, transport: m.url ? 'http' : 'stdio', command: m.command ?? '', args: (m.args ?? []).join('\n'), tokenEnv: m.tokenEnv ?? '', url: m.url ?? 'https://' }))}>Edit</Button>
                  <Button size="sm" variant="danger" disabled={!!busy} onClick={() => window.confirm(`Remove the MCP server ${m.name} and its token? Plugins that use it stop working until you add it again.`) && void act(`rm:${m.name}`, () => server.removeMcpServer(m.name))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!form && (
          <div className={cx(s.pluginActions, s.dbAdd)}>
            <Button size="sm" variant="primary" icon="plus" onClick={() => (setEditing(undefined), setForm(emptyMcp()))}>Add MCP server</Button>
          </div>
        )}
      </Group>
      {form && (
        <Group label={editing ? `Edit ${editing}` : 'Add an MCP server'} hint="The name is what a plugin's manifest asks for as its server. A command runs on this machine with your permissions; add only servers you trust.">
          <form className={s.dbForm} onSubmit={save}>
            <div className={s.dbEngines} role="radiogroup" aria-label="Transport">
              {(['stdio', 'http'] as const).map((k) => (
                <Button key={k} type="button" size="sm" role="radio" aria-checked={form.transport === k} variant={form.transport === k ? 'primary' : 'ghost'} onClick={() => setForm((f) => f && { ...f, transport: k })}>
                  {k === 'stdio' ? 'Command' : 'HTTP URL'}
                </Button>
              ))}
            </div>
            <Field label="Name"><Input aria-label="Name" value={form.name} onChange={set('name')} disabled={!!editing} required pattern="[a-z0-9][a-z0-9_\-]{0,63}" placeholder="github" /></Field>
            {form.transport === 'http' ? (
              <Field label="URL"><Input aria-label="URL" value={form.url} onChange={set('url')} required placeholder="https://mcp.example.com/mcp" /></Field>
            ) : (
              <>
                <Field label="Command"><Input aria-label="Command" value={form.command} onChange={set('command')} required placeholder="npx" /></Field>
                <Field label="Token variable"><Input aria-label="Token variable" value={form.tokenEnv} onChange={set('tokenEnv')} pattern="[A-Z_][A-Z0-9_]{0,63}" placeholder="GITHUB_TOKEN (optional)" /></Field>
                <div className={cx(s.dbField, s.dbWide)}>
                  <span className={s.toggleHint}>Arguments, one per line</span>
                  <textarea className={s.argsInput} aria-label="Arguments, one per line" value={form.args} onChange={set('args')} rows={3} spellCheck={false} />
                </div>
              </>
            )}
            <Field label="Token" wide>
              <Input aria-label="Token" type="password" value={form.token} onChange={set('token')} autoComplete="new-password" placeholder={editing ? 'Leave empty to keep the stored token' : 'Optional'} />
            </Field>
            <div className={cx(s.pluginActions, s.dbWide)}>
              <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" size="sm" variant="primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save and test'}</Button>
            </div>
          </form>
        </Group>
      )}
    </>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx(s.dbField, wide && s.dbWide)}>
      <span className={s.toggleHint}>{label}</span>
      {children}
    </div>
  )
}

/** A tiny dashboard rendered under its own data-theme, so it shows the real tokens. */
function ThemePreview({ id, chrome }: { id: string; chrome?: string }) {
  return (
    <span data-theme={id} className={s.preview} aria-hidden="true">
      <span className={s.pvRail} data-theme={chrome}>
        <i />
        <i />
        <i />
      </span>
      <span className={s.pvMain}>
        <span className={s.pvPanel}>
          <span className={s.pvHead}>
            <b />
            <em />
          </span>
          <span className={s.pvMeter}>
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} className={i < 7 ? s.pvOn : undefined} />
            ))}
          </span>
          <span className={s.pvLines}>
            <i />
            <i />
          </span>
        </span>
        <span className={cx(s.pvPanel, s.pvGaugePanel)}>
          <span className={s.pvGauge} />
        </span>
        <span className={s.pvButton}>ENGAGE</span>
      </span>
    </span>
  )
}
