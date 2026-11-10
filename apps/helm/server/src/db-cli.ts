// `helm db add|remove|list|test`: database profiles for `db` connections, without the UI
// (Settings → Connections does the same). Passwords are prompted without echo, or read
// from stdin when it is not a terminal; they are never accepted as arguments.
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { listProfiles, removeProfile, saveProfile, testProfile } from './db.js'

const usage = `Usage:
  helm db list                                     show database profiles (never passwords)
  helm db add <name> --sqlite <file>               a SQLite file, opened read-only
  helm db add <name> --postgres|--mysql --host <h> [--port <p>] --database <d> --user <u> [--no-password]
                                                   prompts for the password (or reads it from stdin)
  helm db remove <name>                            remove a profile and its stored password
  helm db test <name>                              connect and run a read-only SELECT 1

Use a database user that can only read: Helm runs queries read-only, and a read-only user
keeps it that way even for functions with side effects.`

function readPassword(): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) return new Promise((res) => {
    let data = ''
    input.setEncoding('utf8').on('data', (c) => (data += c)).on('end', () => res(data.replace(/\r?\n$/, '')))
  })
  return new Promise((res) => {
    const rl = createInterface({ input, output: process.stdout, terminal: true })
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream }
    rl.question('Password: ', (pw) => (rl.close(), process.stdout.write('\n'), res(pw)))
    out._writeToOutput = (s: string) => void (s.startsWith('Password: ') && out.output.write(s)) // no echo
  })
}

async function main() {
  const [, , , command, ...rest] = process.argv
  switch (command) {
    case 'list': {
      const { store, profiles } = listProfiles()
      if (!profiles.length) console.log('No database profiles.')
      for (const p of profiles)
        console.log(p.engine === 'sqlite' ? `${p.name}: sqlite ${p.path}` : `${p.name}: ${p.engine} ${p.user}@${p.host}:${p.port}/${p.database}${p.hasPassword ? '' : ' (no password)'}`)
      console.log(`Passwords are kept in ${store}.`)
      return
    }
    case 'add': {
      const { values: o, positionals } = parseArgs({
        args: rest, allowPositionals: true,
        options: { sqlite: { type: 'string' }, postgres: { type: 'boolean' }, mysql: { type: 'boolean' }, host: { type: 'string' }, port: { type: 'string' }, database: { type: 'string' }, user: { type: 'string' }, 'no-password': { type: 'boolean' } },
      })
      const [name] = positionals
      const engine = o.sqlite !== undefined ? 'sqlite' : o.postgres ? 'postgres' : o.mysql ? 'mysql' : undefined
      if (!name || !engine || [o.sqlite !== undefined, o.postgres, o.mysql].filter(Boolean).length > 1) throw new Error(usage)
      const password = engine === 'sqlite' ? undefined : o['no-password'] ? '' : await readPassword()
      const p = saveProfile({ name, engine, path: o.sqlite, host: o.host, port: o.port, database: o.database, user: o.user, password })
      console.log(`Saved ${p.name} (${p.engine}). Test it with: helm db test ${p.name}`)
      return
    }
    case 'remove':
      if (!rest[0]) throw new Error(usage)
      removeProfile(rest[0])
      console.log(`Removed ${rest[0]}.`)
      return
    case 'test': {
      if (!rest[0]) throw new Error(usage)
      const r = await testProfile(rest[0])
      console.log(r.ok ? `${rest[0]}: connected, read-only query ok.` : `${rest[0]}: ${r.error!.message}`)
      if (!r.ok) process.exitCode = 1
      return
    }
    default:
      console.log(usage)
      if (command && command !== 'help') process.exitCode = 1
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
