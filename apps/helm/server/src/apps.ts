// Local apps (task 045): an allowlist of applications the user sets up in Helm Settings.
// Quick actions buttons name an entry by id only; the server looks up the command and its
// arguments here and starts it without a shell. A widget setting never carries a command line,
// so a tampered setting can at most name an id that is not on the list, which is refused.
import { spawn } from 'node:child_process'
import { SERVICE_NAME } from '@usetdt/helm-sdk'
import { readHelmFile, writeHelmFile } from './config.js'
import { ApiError } from './errors.js'

export interface LocalApp {
  name: string
  command: string
  args: string[]
}

const FILE = 'apps.json'
const readApps = () => readHelmFile<LocalApp>(FILE, 'apps')
const oneLine = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !/[\0\r\n]/.test(v)

export function listApps() {
  return {
    apps: Object.entries(readApps())
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([id, a]) => ({ id, ...a })),
  }
}

/** Add or replace an entry. */
export function saveApp(input: Record<string, unknown>) {
  const id = String(input.id ?? '')
  if (!SERVICE_NAME.test(id)) throw new ApiError(400, `Id must match ${SERVICE_NAME.source} (lowercase, digits, - and _)`)
  const name = String(input.name ?? '').trim() || id
  if (!oneLine(name, 60)) throw new ApiError(400, 'Name must be one line, up to 60 characters')
  const command = String(input.command ?? '').trim()
  if (!command || !oneLine(command, 1024)) throw new ApiError(400, 'Give the program to start, for example code or /usr/bin/gimp')
  const args = input.args === undefined ? [] : input.args
  if (!Array.isArray(args) || args.length > 64 || !args.every((a) => oneLine(a, 4096))) throw new ApiError(400, 'Arguments must be a list of up to 64 one-line strings')
  const apps = readApps()
  apps[id] = { name, command, args: args as string[] }
  writeHelmFile(FILE, 'apps', apps)
  return { id, ...apps[id] }
}

export function removeApp(id: string) {
  const apps = readApps()
  if (!Object.hasOwn(apps, id)) throw new ApiError(404, `No local app "${id}"`)
  delete apps[id]
  writeHelmFile(FILE, 'apps', apps)
  return { ok: true }
}

/** Start an allowlisted app, detached from Helm; resolves once it has spawned. */
export function launchApp(id: string): Promise<{ ok: true; name: string }> {
  const apps = readApps()
  const app = SERVICE_NAME.test(id) && Object.hasOwn(apps, id) ? apps[id] : undefined
  if (!app) return Promise.reject(new ApiError(404, `"${id}" is not in Helm's local apps. Add it in Settings → Local apps.`))
  return new Promise((resolve, reject) => {
    const child = spawn(app.command, app.args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    child.once('error', (e: NodeJS.ErrnoException) =>
      reject(new ApiError(502, e.code === 'ENOENT' ? `${app.name}: program not found (${app.command})` : `${app.name} did not start: ${e.message}`)),
    )
    child.once('spawn', () => (child.unref(), resolve({ ok: true, name: app.name })))
  })
}
