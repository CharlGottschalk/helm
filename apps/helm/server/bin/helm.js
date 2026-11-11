#!/usr/bin/env node
// `helm` CLI entry: `helm --version`/`-v` prints the version, `helm plugin …` manages plugins,
// `helm db …` database profiles, `helm workspace …` workspaces; anything else starts the
// local Command Deck server (built output in server/dist).
import { readFileSync } from 'node:fs'

const arg = process.argv[2]
if (arg === '--version' || arg === '-v') {
  console.log(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version)
} else if (arg === 'plugin') import('../dist/cli.js')
else if (arg === 'db') import('../dist/db-cli.js')
else if (arg === 'workspace') import('../dist/workspace-cli.js')
else import('../dist/index.js')
