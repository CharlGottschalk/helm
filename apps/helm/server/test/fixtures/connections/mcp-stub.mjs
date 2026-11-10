// A stdio MCP server for connections-check: `echo`, `token_seen` (declared), `hidden` (not declared) and `bump`
// (a write tool: a counter that shows how many times it really ran).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'stub', version: '1.0.0' })
server.tool('echo', { text: z.string() }, async ({ text }) => ({ content: [{ type: 'text', text }], structuredContent: { echoed: text } }))
// reports only whether the token arrived in its variable, never the token
server.tool('token_seen', {}, async () => ({ content: [{ type: 'text', text: String(!!process.env.STUB_TOKEN) }], structuredContent: { length: (process.env.STUB_TOKEN ?? '').length, home: !!process.env.HOME, leaked: !!process.env.HELM_CHECK_SENTINEL } }))
let count = 0
server.tool('bump', { by: z.number() }, async ({ by }) => ((count += by), { content: [{ type: 'text', text: String(count) }], structuredContent: { count } }))
server.tool('hidden', {}, async () => ({ content: [{ type: 'text', text: 'should not be reachable' }] }))
await server.connect(new StdioServerTransport())
