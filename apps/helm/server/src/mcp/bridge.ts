// One `tdt --workspace <path> mcp serve --profile <p>` child per workspace,
// spoken to over MCP stdio. Tool results are TDT's Result envelope, returned
// untouched as structuredContent so widgets see ok/error.retry/coverage as-is.
//
// Requires TDT installed with the mcp extra (pydantic): pipx install 'thisdamnthing[mcp]'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { HELM_VERSION, type HelmConfig, type WorkspaceEntry } from '../config.js'
import { ApiError } from '../errors.js'

/** TDT's response envelope (src/thisdamnthing/mcp_tools/models.py: Result). */
export interface TdtResult<T = unknown> {
  api_version: 1
  ok: boolean
  data: T | null
  coverage: { truncated: boolean; omissions: string[] }
  warnings: string[]
  error: { code: string; message: string; retry: 'safe' | 'reread' | 'inspect_outcome' } | null
}

class WorkspaceBridge {
  private client: Client | null = null
  private connecting: Promise<Client> | null = null
  private stderrTail = ''

  constructor(private ws: WorkspaceEntry, private tdtCommand: string) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client
    this.connecting ??= (async () => {
      const transport = new StdioClientTransport({
        command: this.tdtCommand,
        args: ['--workspace', this.ws.path, 'mcp', 'serve', '--profile', this.ws.profile],
        stderr: 'pipe',
      })
      // Keep tdt's last words so a failed start says why (and drain the pipe so it never fills).
      this.stderrTail = ''
      transport.stderr?.on('data', (chunk: Buffer) => (this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000)))
      const client = new Client({ name: 'helm', version: HELM_VERSION })
      transport.onclose = () => {
        // Child exited (crash, idle, profile change). Reconnect lazily on next call.
        this.client = null
        this.connecting = null
      }
      await client.connect(transport)
      this.client = client
      return client
    })()
    try {
      return await this.connecting
    } catch (error) {
      this.connecting = null
      const said = this.stderrTail.trim()
      console.warn(`[helm] tdt mcp for ${this.ws.id} failed: ${(error as Error).message}${said ? `\n[helm] tdt said: ${said}` : ''}`)
      throw new ApiError(502, said
        ? `TDT could not start for this workspace: ${said}`
        : `TDT is unavailable for this workspace. Check that \`${this.tdtCommand}\` is on PATH and installed with the mcp extra: pipx install 'thisdamnthing[mcp]'`)
    }
  }

  async listTools() {
    const client = await this.connect()
    const { tools } = await client.listTools()
    return tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.annotations?.readOnlyHint ?? true }))
  }

  async call(name: string, args: Record<string, unknown>): Promise<TdtResult> {
    const client = await this.connect()
    const result = await client.callTool({ name, arguments: args })
    if (result.structuredContent) return result.structuredContent as unknown as TdtResult
    // Fallback for servers that only send text content.
    const text = Array.isArray(result.content) ? result.content.find((c) => c.type === 'text') : undefined
    if (text && 'text' in text && typeof text.text === 'string') return JSON.parse(text.text) as TdtResult
    throw new Error(`Tool ${name} returned no readable result`)
  }

  async close() {
    await this.client?.close()
    this.client = null
    this.connecting = null
  }
}

export class BridgePool {
  private bridges = new Map<string, WorkspaceBridge>()

  constructor(private config: HelmConfig) {}

  get(ws: WorkspaceEntry) {
    // Key includes profile so switching read-only <-> everyday starts a fresh child.
    const key = `${ws.id}:${ws.profile}`
    let bridge = this.bridges.get(key)
    if (!bridge) {
      bridge = new WorkspaceBridge(ws, this.config.tdtCommand)
      this.bridges.set(key, bridge)
    }
    return bridge
  }

  async closeAll() {
    await Promise.allSettled([...this.bridges.values()].map((b) => b.close()))
    this.bridges.clear()
  }
}
