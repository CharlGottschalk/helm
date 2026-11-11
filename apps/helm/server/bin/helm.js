#!/usr/bin/env node
// `helm` CLI entry: `helm plugin …` manages plugins, `helm db …` database profiles,
// `helm workspace …` workspaces; anything else starts the local Command Deck server (built output in server/dist).
if (process.argv[2] === 'plugin') import('../dist/cli.js')
else if (process.argv[2] === 'db') import('../dist/db-cli.js')
else if (process.argv[2] === 'workspace') import('../dist/workspace-cli.js')
else import('../dist/index.js')
