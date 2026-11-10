// `helm plugin add|link|remove|list`: manage plugins without the UI. Installing never
// runs install scripts and never approves: review and enable each plugin in Helm
// (Settings → Plugins), where you see exactly what it declares.
import { isAbsolute } from 'node:path'
import { addPlugin, listPlugins, removePlugin, type PluginInfo } from './plugins.js'

const usage = `Usage:
  helm plugin add <npm-name | git-url | folder>   install a plugin (scripts are never run)
  helm plugin link <folder>                       install a local plugin folder for development
  helm plugin remove <name>                       uninstall a plugin
  helm plugin list                                show installed plugins`

function describe(p: PluginInfo) {
  const state = !p.supported ? 'needs a newer Helm' : p.approved ? `approved, enabled in ${p.enabledIn.length ? p.enabledIn.join(', ') : 'no workspace'}` : 'not reviewed yet'
  const lines = [`${p.name}@${p.version || '?'}${p.linked ? ' (linked)' : ''}: ${state}`]
  for (const b of p.bundles) {
    const m = (b.manifest ?? {}) as { name?: string; connections?: { id: string; kind: string; operations?: string[]; calls?: Record<string, { method?: string; path?: string; query?: Record<string, string>; body?: unknown; write?: boolean }>; writes?: string[]; server?: string; queries?: Record<string, { sql?: string; write?: boolean }>; root?: string; paths?: string[]; engine?: string; service?: string; oauth2?: { authorizeUrl?: string; tokenUrl?: string; scopes?: string[] } }[]; permissions?: { write?: boolean }; capabilities?: string[] }
    if (b.error) {
      lines.push(`  ${b.kind} ${b.dir}: ${b.error}`)
      continue
    }
    if (b.theme) {
      lines.push(`  theme ${m.name ?? b.id}: ${Object.keys(b.theme.tokens).length} tokens${b.theme.chrome ? ', rail sub-theme' : ''}; no calls or writes; every workspace once approved`)
      for (const w of b.theme.warnings) lines.push(`    BELOW AA ${w}`)
      continue
    }
    const reads = (q: Record<string, { write?: boolean }>) => Object.keys(q).filter((k) => q[k]?.write !== true)
    // reads only here: every write gets its own WRITE line below
    const conns = (m.connections ?? []).map((c) => `${c.id} (${c.kind}: ${(c.operations ?? (c.queries ? reads(c.queries) : reads(c.calls ?? {}))).filter((o) => o !== 'write').join(', ')}${c.kind === 'files' ? ` of ${(c.paths ?? []).join(', ')} in the ${c.root}` : c.kind === 'db' ? ` (read-only ${c.engine} queries) on database profile ${c.service}` : c.kind === 'http' ? ` (read calls) on service profile ${c.service}` : c.kind === 'mcp' ? ` (read tools) on MCP server ${c.server}` : ''})`).join('; ')
    lines.push(`  ${b.kind} ${m.name ?? b.id}: ${conns || 'no connections'}${m.permissions?.write ? '; WRITES' : ''}${m.capabilities?.length ? `; capabilities ${m.capabilities.join(', ')}` : ''}`)
    // every http call's method, path, query and body: the approval covers exactly these
    for (const c of m.connections ?? [])
      for (const [name, x] of Object.entries(c.kind === 'http' ? c.calls ?? {} : {}))
        lines.push(`    ${x.write === true ? 'WRITE CALL' : 'CALL'} ${c.id}.${name} on service profile ${c.service}: ${x.method} ${x.path}${x.query ? '?' + new URLSearchParams(x.query).toString().replace(/%7B/g, '{').replace(/%7D/g, '}') : ''}${x.body !== undefined ? ' ' + JSON.stringify(x.body) : ''}`)
    // OAuth2 sign-in: the approval covers these exact URLs and scopes
    for (const c of m.connections ?? [])
      if (c.kind === 'http' && c.oauth2) lines.push(`    SIGN-IN ${c.id} on service profile ${c.service} (OAuth2): authorize ${c.oauth2.authorizeUrl}; token ${c.oauth2.tokenUrl}; scopes ${(c.oauth2.scopes ?? []).join(' ') || '(none)'}`)
    // every write query's exact SQL: the approval covers it, and each call is confirmed in Helm
    for (const c of m.connections ?? [])
      for (const [name, q] of Object.entries(c.kind === 'db' ? c.queries ?? {} : {}))
        if (q?.write === true) lines.push(`    WRITE ${c.id}.${name} on database profile ${c.service}: ${String(q.sql).replace(/\s+/g, ' ')}`)
    for (const c of m.connections ?? []) {
      if (c.kind === 'mcp') for (const tool of c.writes ?? []) lines.push(`    WRITE ${c.id}.${tool} (tool) on MCP server ${c.server}`)
      if (c.kind === 'files' && c.operations?.includes('write')) lines.push(`    WRITE ${c.id} replaces existing files matching ${(c.paths ?? []).join(', ')} in the ${c.root}`)
    }
  }
  for (const problem of p.problems) lines.push(`  ! ${problem}`)
  return lines.join('\n')
}

async function main() {
  const [, , , command, arg] = process.argv
  switch (command) {
    case 'add':
    case 'link': {
      if (!arg) throw new Error(usage)
      const p = await addPlugin(command === 'link' && !isAbsolute(arg) && !/^[.~]/.test(arg) ? `./${arg}` : arg)
      console.log(describe(p))
      console.log(p.bundles.every((b) => b.kind === 'theme')
        ? '\nReview and approve it in Helm: Settings → Plugins. Its themes then appear under Appearance → Theme.'
        : '\nReview and enable it in Helm: Settings → Plugins.')
      return
    }
    case 'remove':
      if (!arg) throw new Error(usage)
      await removePlugin(arg)
      console.log(`Removed ${arg}.`)
      return
    case 'list': {
      const all = listPlugins()
      console.log(all.length ? all.map(describe).join('\n\n') : 'No plugins installed.')
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
