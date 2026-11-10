// Tasks 028, 026: after the move dialog, do exactly one thing. Only `write` spends the write token;
// `build` starts a session and writes nothing; `cancel` does neither. Checked by test/move-check.mjs.
import { allowed, isWrite, type ConnectionDecl, type FilesResult, type HttpResult } from '@usetdt/helm-sdk'
import type { BuildResult } from '@usetdt/helm-sdk/frame'

export async function settleMove(choice: 'cancel' | 'write' | 'build', write: () => Promise<FilesResult | HttpResult>, build: () => Promise<void>): Promise<BuildResult> {
  if (choice === 'cancel') return { ok: false, choice, error: 'Declined by the user' }
  if (choice === 'build') {
    try {
      await build()
      return { ok: true, choice }
    } catch (e) {
      return { ok: false, choice, error: (e as Error).message }
    }
  }
  const r = await write()
  return { ok: r.ok, choice, write: r, ...(r.ok ? {} : { error: r.error?.message ?? 'The write failed' }) }
}

/** The kind of a declared files/http/mcp write that orWrite may use, or null (undeclared, a read, or another kind). */
export function orWriteKind(connections: ConnectionDecl[] | undefined, connection: string, operation: string): 'files' | 'http' | 'mcp' | null {
  const kind = connections?.find((c) => c.id === connection)?.kind
  if (kind !== 'files' && kind !== 'http' && kind !== 'mcp') return null
  return allowed(connections, connection, operation) && isWrite(connections, connection, operation) ? kind : null
}
