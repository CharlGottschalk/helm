// Helm's single server-side confirmation flow (constitution "Writes"). The shell asks for a
// confirmation of one exact action; the server builds the summary the dialog shows itself and
// issues a one-time, short-lived token bound to that action. The shell spends the token only
// when the user clicks Run in Helm's own dialog. Sandboxed frames can't reach the API (no
// bearer token), so extensions can neither open nor answer it. TDT writes reuse this later.
import { createHash, randomBytes } from 'node:crypto'

export const TOKEN_TTL_MS = 5 * 60_000 // long enough to read the SQL; still one-time and bound to the exact action
const pending = new Map<string, { binding: string; expires: number }>()

export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** A token for exactly `binding` (e.g. workspace, extension, connection, operation, args). */
export function issue(binding: unknown) {
  const now = Date.now()
  for (const [t, p] of pending) if (p.expires <= now) pending.delete(t)
  const token = randomBytes(24).toString('hex')
  pending.set(token, { binding: digest(binding), expires: now + TOKEN_TTL_MS })
  return token
}

/** Spend `token` on `binding`. A token is gone after any attempt, so a mismatch can't be retried. */
export function spend(token: unknown, binding: unknown) {
  if (typeof token !== 'string') return false
  const p = pending.get(token)
  if (!p) return false
  pending.delete(token)
  return p.expires > Date.now() && p.binding === digest(binding)
}
