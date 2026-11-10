import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { HelmConfig, WorkspaceEntry } from './config.js'
import { ApiError } from './errors.js'

export function getWorkspace(config: HelmConfig, id: string): WorkspaceEntry {
  const ws = config.workspaces.find((w) => w.id === id)
  if (!ws) throw new ApiError(404, `Unknown workspace "${id}"`)
  return ws
}

/** True when `candidate` is the root itself or inside it (both already real paths). */
export function isInside(root: string, candidate: string) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(sep))
}

/**
 * Resolve a directory the user asked for (absolute or relative to the workspace)
 * and refuse anything outside the workspace after following symlinks/junctions.
 * Used for terminal cwd and any file access Helm performs on a workspace's behalf.
 */
export function confineDirectory(workspaceRoot: string, requested?: string): string {
  const root = realpathSync(workspaceRoot)
  let target: string
  try {
    target = realpathSync(requested ? resolve(root, requested) : root)
  } catch {
    throw new ApiError(400, 'Directory does not exist')
  }
  if (!isInside(root, target)) throw new ApiError(403, 'Path is outside the workspace')
  if (!statSync(target).isDirectory()) throw new ApiError(400, 'Not a directory')
  return target
}

/** A workspace is a TDT workspace when it has the .tdt harness. */
export function looksLikeTdtWorkspace(path: string) {
  try {
    return statSync(resolve(path, '.tdt', 'config.json')).isFile()
  } catch {
    return false
  }
}
