// Credentials: the OS keychain when Helm can reach it, else ~/.helm/credentials.json
// (0600). Never sent to the browser, an extension or a workspace.
// Keychain: Linux `secret-tool` (libsecret). Secrets go over stdin, never argv.
// ponytail: macOS/Windows use the 0600 file; their CLIs take secrets on argv, add a native route when needed.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELM_HOME } from './config.js'

const FILE = () => join(HELM_HOME, 'credentials.json')
const ATTRS = (account: string) => ['service', 'helm', 'account', account]

let keychainAvailable: boolean | undefined
function keychain() {
  if (keychainAvailable === undefined)
    keychainAvailable = process.platform === 'linux' && process.env.HELM_KEYCHAIN !== 'off' && spawnSync('secret-tool', ['--version'], { stdio: 'ignore' }).status === 0
  return keychainAvailable
}

function readFile(): Record<string, string> {
  if (!existsSync(FILE())) return {}
  try {
    return JSON.parse(readFileSync(FILE(), 'utf8'))
  } catch {
    throw new Error(`${FILE()} is unreadable; fix or remove it`)
  }
}

function writeFile(all: Record<string, string>) {
  mkdirSync(HELM_HOME, { recursive: true, mode: 0o700 })
  const tmp = `${FILE()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, FILE())
}

/** Where secrets are kept on this machine, for setup text. */
export const secretStore = () => (keychain() ? 'the system keychain' : `${FILE()} (0600)`)

export function setSecret(account: string, secret: string) {
  if (keychain()) {
    const r = spawnSync('secret-tool', ['store', '--label', `Helm ${account}`, ...ATTRS(account)], { input: secret, stdio: ['pipe', 'ignore', 'pipe'] })
    if (r.status === 0) return deleteFromFile(account)
  }
  writeFile({ ...readFile(), [account]: secret })
}

export function getSecret(account: string): string | undefined {
  if (keychain()) {
    const r = spawnSync('secret-tool', ['lookup', ...ATTRS(account)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (r.status === 0 && r.stdout) return r.stdout
  }
  return readFile()[account]
}

export function deleteSecret(account: string) {
  if (keychain()) spawnSync('secret-tool', ['clear', ...ATTRS(account)], { stdio: 'ignore' })
  deleteFromFile(account)
}

function deleteFromFile(account: string) {
  const all = readFile()
  if (account in all) {
    delete all[account]
    writeFile(all)
  }
}
