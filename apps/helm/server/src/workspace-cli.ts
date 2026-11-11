// `helm workspace add|list`: register TDT workspaces without the UI (task 042). Shares
// addWorkspace with onboarding, so the rules are the same.
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { CONFIG_PATH, loadConfig } from './config.js'
import { addWorkspace } from './onboarding.js'
import { looksLikeTdtWorkspace } from './workspaces.js'

const usage = `Usage:
  helm workspace add <path> [--name <name>] [--init]   register a TDT workspace (--init creates one there first)
  helm workspace list                                   show registered workspaces`

async function main() {
  const [, , , command, ...rest] = process.argv
  const config = loadConfig()
  switch (command) {
    case 'list':
      if (!config.workspaces.length) console.log(`No workspaces in ${CONFIG_PATH}.`)
      for (const w of config.workspaces) console.log(`${w.id}: ${w.name} (${w.profile}) ${w.path}${looksLikeTdtWorkspace(w.path) ? '' : '  ! not a TDT workspace'}`)
      return
    case 'add': {
      const { values: o, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { name: { type: 'string' }, init: { type: 'boolean' } } })
      if (positionals.length !== 1) throw new Error(usage)
      const path = resolve(positionals[0])
      if (o.init && !looksLikeTdtWorkspace(path) && hasEntries(path))
        console.warn(`Warning: ${path} is not empty. TDT workspaces are best kept outside existing projects.`)
      if (o.init) console.log(`Creating a TDT workspace in ${path}…`)
      const r = await addWorkspace(config, { path, name: o.name, init: o.init === true })
      if (r.output) console.log(r.output)
      console.log(r.created ? `Registered ${r.workspace.name} (${r.workspace.id}) in ${CONFIG_PATH}.` : `${r.workspace.path} is already registered as ${r.workspace.id}.`)
      return
    }
    default:
      console.log(usage)
      if (command && command !== 'help') process.exitCode = 1
  }
}

function hasEntries(path: string) {
  try {
    return readdirSync(path).length > 0
  } catch {
    return false
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
