// Sample project graph for offline mode; online, it comes from tdt_project_graph.
import type { TdtProjectGraph } from '../tdt'

const files: [string, 'code' | 'instruction' | 'doc', string[]][] = [
  ['CLAUDE.md', 'instruction', []],
  ['README.md', 'doc', []],
  ['docs/architecture.md', 'doc', []],
  ['src/index.ts', 'code', ['main()', 'start()']],
  ['src/server.ts', 'code', ['createServer()', 'route()', 'Server']],
  ['src/db.ts', 'code', ['connect()', 'query()', 'Pool']],
  ['src/auth.ts', 'code', ['verifyToken()', 'Session']],
  ['src/routes/tasks.ts', 'code', ['listTasks()', 'getTask()']],
  ['src/routes/users.ts', 'code', ['getUser()']],
  ['src/lib/log.ts', 'code', ['log()', 'Level']],
  ['test/tasks.test.ts', 'code', ['tasks list']],
]
const links: [string, string, string][] = [
  ['src/index.ts', 'src/server.ts', 'imports_from'],
  ['src/index.ts', 'src/db.ts', 'imports_from'],
  ['src/server.ts', 'src/auth.ts', 'imports_from'],
  ['src/server.ts', 'src/routes/tasks.ts', 'imports_from'],
  ['src/server.ts', 'src/routes/users.ts', 'dynamic_import'],
  ['src/routes/tasks.ts', 'src/db.ts', 'calls'],
  ['src/routes/users.ts', 'src/db.ts', 'calls'],
  ['src/routes/tasks.ts', 'src/auth.ts', 'calls'],
  ['src/server.ts', 'src/lib/log.ts', 'imports'],
  ['src/db.ts', 'src/lib/log.ts', 'imports'],
  ['test/tasks.test.ts', 'src/routes/tasks.ts', 'imports_from'],
  ['CLAUDE.md', 'README.md', 'references'],
  ['CLAUDE.md', 'docs/architecture.md', 'references'],
  ['docs/architecture.md', 'src/server.ts', 'references'],
]

export const sampleProjectGraph: TdtProjectGraph = {
  status: 'graph',
  revision: 'sample',
  schema_version: 1,
  graphify_version: '0.9.107',
  built_at: '2026-11-12T09:00:00+00:00',
  built_at_commit: null,
  code_only: false,
  hook_installed: true,
  nodes: files.map(([id, kind, symbols]) => ({ id, kind, symbols, symbols_total: symbols.length })),
  links: links.map(([source, target, relation]) => ({ source, target, relation, confidence: 'EXTRACTED' })),
  nodes_total: files.length,
  links_total: links.length,
}
