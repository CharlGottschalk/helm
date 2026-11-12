// First-run onboarding and "Add workspace" (task 042): check TDT (offer pipx install or a
// guide), pick a folder anywhere, then connect an existing workspace or create one there.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Icon, Input, useModal } from '@helm/ui'
import { server, type FolderListing, type TdtStatus } from '@helm/client'
import { cx } from '../../lib/util'
import { useHelm } from '../../state/store'
import s from './Onboarding.module.css'

const INSTALL = "pipx install 'thisdamnthing[mcp]'"

/** Full screen when no workspace is configured. */
export function Onboarding() {
  return (
    <div className={s.screen}>
      <div className={s.card}>
        <Flow />
      </div>
    </div>
  )
}

/** The same flow as a dialog, from the workspace switcher. */
export function AddWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const modal = useModal(onClose)
  return (
    <dialog className={cx('hud-modal', s.overlay)} aria-labelledby="onboarding-title" {...modal}>
      <div className={s.card}>
        <button className={s.close} onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
        <Flow onDone={onClose} />
      </div>
    </dialog>
  )
}

function Flow({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<TdtStatus | null>(null)
  const [error, setError] = useState('')
  const check = useCallback(() => {
    setStatus(null)
    setError('')
    server.tdtStatus().then(setStatus, (e: Error) => setError(e.message))
  }, [])
  useEffect(check, [check])

  return (
    <>
      <header className={s.header}>
        <span className="hud-label">Helm · set up a workspace</span>
        <h1 id="onboarding-title" className={s.title}>{onDone ? 'Add a workspace' : 'Welcome to Helm'}</h1>
        <p className={s.lede}>Helm works on ThisDamnThing (TDT) workspaces: folders that hold your brain, notes and projects.</p>
      </header>
      {error && <p className={s.error} role="alert">{error}</p>}
      {!status && !error && <p className={s.muted}>Checking for TDT…</p>}
      {status && !status.tdt.ok && <InstallTdt status={status} onCheck={check} />}
      {status?.tdt.ok && (
        <>
          {!onDone && (
            <p className={s.stepTitle}>
              <span className={s.num}><Icon name="check" size={12} /></span> TDT is installed
              <Badge tone="green" className={s.found}>{status.tdt.version}</Badge>
            </p>
          )}
          <FolderStep onDone={onDone} />
        </>
      )}
    </>
  )
}

/* ── step 1: TDT ──────────────────────────────────────────────────────────── */
function InstallTdt({ status, onCheck }: { status: TdtStatus; onCheck: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; output: string; pathChanged: boolean; tdtCommand?: string } | null>(null)
  const install = async () => {
    setRunning(true)
    setResult(await server.installTdt().catch((e: Error) => ({ ok: false, output: e.message, pathChanged: false })))
    setRunning(false)
    setConfirming(false)
  }

  return (
    <section className={s.step} aria-labelledby="tdt-step">
      <h2 id="tdt-step" className={s.stepTitle}><span className={s.num}>1</span> Install TDT</h2>
      <p>Helm couldn't run <code>{status.tdt.command}</code>, so TDT doesn't seem to be installed yet.</p>
      {status.tdt.error && <pre className={s.output}>{status.tdt.error}</pre>}

      {result ? (
        result.ok ? (
          <div className={s.note} role="status">
            <p><Icon name="check" size={14} /> TDT is installed.</p>
            {result.pathChanged && <p>pipx added its folder to your PATH. Open a new terminal (or restart your shell) before you run <code>tdt</code> yourself.</p>}
            {result.tdtCommand && result.tdtCommand !== 'tdt' && <p>Helm will use <code>{result.tdtCommand}</code> until then, so you can carry on now.</p>}
          </div>
        ) : (
          <p className={s.error} role="alert">The install didn't finish. The output below says why; the guide has the manual steps.</p>
        )
      ) : status.pipx.ok ? (
        confirming ? (
          <div className={s.confirm}>
            <p>Helm will run this command and show you its output. It can take a few minutes.</p>
            <pre className={s.command}>{INSTALL}</pre>
            <div className={s.row}>
              <Button variant="primary" icon="bolt" onClick={install} disabled={running}>{running ? 'Installing…' : 'Run install'}</Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={running}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className={s.row}>
            <Button variant="primary" icon="bolt" onClick={() => setConfirming(true)}>Install automatically</Button>
            <span className={s.muted}>pipx {status.pipx.version} found</span>
          </div>
        )
      ) : (
        <p>pipx isn't installed either, so follow the guide below. Helm doesn't install Python or pipx.</p>
      )}
      {result?.output && <pre className={s.output}>{result.output}</pre>}

      <details className={s.guide} open={!status.pipx.ok}>
        <summary>Install it yourself</summary>
        <Guide platform={status.platform} />
      </details>
      <div className={s.row}>
        <Button icon="reset" onClick={onCheck} disabled={running}>Check again</Button>
      </div>
    </section>
  )
}

function Guide({ platform }: { platform: string }) {
  const steps =
    platform === 'win32'
      ? [
          <>Install Python 3.11 or newer from python.org. Tick <b>Add python.exe to PATH</b> in the installer.</>,
          <>In a new terminal: <code>py -m pip install --user pipx</code>, then <code>py -m pipx ensurepath</code>.</>,
          <>Close and reopen the terminal, then run <code>{INSTALL}</code>.</>,
        ]
      : platform === 'darwin'
        ? [
            <>Install Python 3.11 or newer and pipx, for example with Homebrew: <code>brew install python pipx</code>.</>,
            <>Run <code>pipx ensurepath</code>, then close and reopen the terminal.</>,
            <>Run <code>{INSTALL}</code>.</>,
          ]
        : [
            <>Install Python 3.11 or newer and pipx with your package manager, for example <code>sudo apt install pipx</code>.</>,
            <>Run <code>pipx ensurepath</code>, then close and reopen the terminal.</>,
            <>Run <code>{INSTALL}</code>.</>,
          ]
  return (
    <ol className={s.steps}>
      {steps.map((x, i) => <li key={i}>{x}</li>)}
      <li>Come back here and choose <b>Check again</b>.</li>
    </ol>
  )
}

/* ── step 2+3: folder, then connect or create ─────────────────────────────── */
function FolderStep({ onDone }: { onDone?: () => void }) {
  const { actions } = useHelm()
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmNonEmpty, setConfirmNonEmpty] = useState(false)

  const open = useCallback((path?: string) => {
    setError('')
    setConfirmNonEmpty(false)
    server.listFolder(path).then((l) => {
      setListing(l)
      setName(l.crumbs[l.crumbs.length - 1]?.name ?? '')
    }, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => open(), [open])

  const mkdir = async (e: FormEvent) => {
    e.preventDefault()
    if (!listing || !newName.trim()) return
    try {
      const { path } = await server.createFolder(listing.path, newName.trim())
      setNewName('')
      open(path)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const add = async (init: boolean) => {
    if (!listing) return
    if (init && !listing.empty && !confirmNonEmpty) return setConfirmNonEmpty(true)
    setBusy(init ? 'Creating the workspace (tdt init, then tdt doctor)…' : 'Connecting…')
    setError('')
    try {
      const r = await server.addWorkspace({ path: listing.path, name: name.trim() || undefined, init })
      actions.setWorkspace(r.workspace.id)
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className={s.step} aria-labelledby="folder-step">
      <h2 id="folder-step" className={s.stepTitle}>
        {!onDone && <span className={s.num}>2</span>} Choose a folder
      </h2>
      <p className={s.muted}>Pick an existing workspace, or an empty folder for a new one. Keep new workspaces outside your code projects.</p>

      {listing && (
        <>
          <FolderBrowser listing={listing} open={open} />
          <form className={s.row} onSubmit={mkdir}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New folder name" aria-label="New folder name" icon="plus" />
            <Button type="submit" disabled={!newName.trim()}>New folder</Button>
          </form>

          <div className={s.selected}>
            <div className={s.row}>
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" placeholder="Workspace name" />
              {listing.workspace ? (
                <Button variant="primary" icon="link" onClick={() => add(false)} disabled={!!busy}>Connect this workspace</Button>
              ) : (
                <Button variant="primary" icon="plus" onClick={() => add(true)} disabled={!!busy}>{confirmNonEmpty ? 'Yes, create it here' : 'Create a TDT workspace here'}</Button>
              )}
            </div>
            <p className={s.muted}>{listing.workspace ? <>This folder is a TDT workspace.</> : <>This creates a TDT workspace in <code>{listing.path}</code>.</>}</p>
            {confirmNonEmpty && (
              <p className={s.warn} role="alert">This folder already has files in it and isn't a TDT workspace. TDT works best in its own folder, outside your projects. Create it here anyway?</p>
            )}
          </div>
        </>
      )}
      {busy && <p className={s.muted} role="status">{busy}</p>}
      {error && <pre className={cx(s.output, s.errorOut)} role="alert">{error}</pre>}
    </section>
  )
}

/** Breadcrumbs and subfolders of one listing: the workspace step and the project picker share it. */
function FolderBrowser({ listing, open }: { listing: FolderListing; open: (path: string) => void }) {
  return (
    <>
      <nav className={s.crumbs} aria-label="Folder path">
        {listing.crumbs.map((c, i) => (
          <span key={c.path} className={s.crumb}>
            {i > 0 && <Icon name="chevR" size={12} />}
            <button onClick={() => open(c.path)} aria-current={i === listing.crumbs.length - 1 ? 'location' : undefined}>{c.name}</button>
          </span>
        ))}
        <button className={s.home} onClick={() => open(listing.home)} title="Home folder">~</button>
      </nav>
      <ul className={s.folders} aria-label="Folders">
        {listing.parent && (
          <li><button onClick={() => open(listing.parent!)}><Icon name="chevL" size={14} /> ..</button></li>
        )}
        {listing.folders.map((f) => (
          <li key={f.path}>
            <button onClick={() => open(f.path)}>
              <Icon name="folder" size={14} /> <span className={s.fname}>{f.name}</span>
              {f.workspace && <Badge tone="cyan">Workspace</Badge>}
            </button>
          </li>
        ))}
        {!listing.folders.length && <li className={s.muted}>No folders here.</li>}
      </ul>
    </>
  )
}

/** Projects "+" (task 047): pick a project folder, then hand off /tdt-add-project with it. Helm registers nothing itself. */
export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const modal = useModal(onClose)
  const { actions, state } = useHelm()
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [error, setError] = useState('')
  const open = useCallback((path?: string) => {
    setError('')
    server.listFolder(path).then(setListing, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => open(), [open])

  const choose = () => {
    if (!listing) return
    // The path is data in the prompt, quoted so spaces survive; JSON only when it holds a quote (keeps Windows backslashes single).
    const quoted = listing.path.includes('"') ? JSON.stringify(listing.path) : `"${listing.path}"`
    const sigil = state.settings.host === 'codex' ? '$' : '/' // Codex invokes skills as $skill
    actions.handoff(`${sigil}tdt-add-project ${quoted}`)
    onClose()
  }

  return (
    <dialog className={cx('hud-modal', s.overlay)} aria-labelledby="add-project-title" {...modal}>
      <div className={s.card}>
        <button className={s.close} onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
        <header className={s.header}>
          <span className="hud-label">Helm · add a project</span>
          <h1 id="add-project-title" className={s.title}>Add a project</h1>
          <p className={s.lede}>Pick the project's folder. Helm starts a session that runs <code>/tdt-add-project</code> on it, and TDT registers the project.</p>
        </header>
        <section className={s.step} aria-label="Project folder">
          {listing && (
            <>
              <FolderBrowser listing={listing} open={open} />
              <div className={s.selected}>
                <div className={s.row}>
                  <Button variant="primary" icon="arrow" onClick={choose}>Add this folder</Button>
                  <Button variant="ghost" onClick={onClose}>Cancel</Button>
                </div>
                <p className={s.muted}><code>{listing.path}</code></p>
              </div>
            </>
          )}
          {error && <pre className={cx(s.output, s.errorOut)} role="alert">{error}</pre>}
        </section>
      </div>
    </dialog>
  )
}
