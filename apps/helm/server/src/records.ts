// Record edits through the operations TDT sanctions (see src/services/records.ts):
//   knowledge / index → tdt_brain_repair_preview → tdt_brain_repair_apply
//   candidate         → tdt_candidate_review { decision: { action: 'edit', summary } }
// The server, not the browser, writes `user_instruction`, from the confirmation the
// user gave in Helm's preview dialog. TDT still can't authenticate a human; this
// records what the user actually did in Helm, never something an extension supplied.
import { CONFIG_PATH, type WorkspaceEntry } from './config.js'
import { ApiError } from './errors.js'
import { readContained } from './files.js'
import type { BridgePool, TdtResult } from './mcp/bridge.js'

const HASH = /^[a-f0-9]{64}$/
const KNOWLEDGE = /^brain\/knowledge\/[^/\\]+\.md$/

/**
 * The TDT id of an approved knowledge note, from its frontmatter. Search, graph and wikilinks give
 * only paths, yet the one full-file read (tdt_candidate_review_status) needs the id. TDT's own
 * tdt_brain_read decides eligibility first; the browser then reads the file through TDT by id.
 * TODO: drop this once TDT returns ids from tdt_brain_search / tdt_brain_graph.
 */
export async function knowledgeId(bridges: BridgePool, ws: WorkspaceEntry, raw: Record<string, unknown>) {
  const path = String(raw.path ?? '')
  if (!KNOWLEDGE.test(path)) throw new ApiError(400, 'path must be brain/knowledge/<note>.md')
  const read = await bridges.get(ws).call('tdt_brain_read', { reference: path })
  if (!read.ok) throw new ApiError(404, read.error?.message ?? 'TDT refused the read')
  const frontmatter = readContained(ws.path, path)?.split('\n---\n')[0] ?? ''
  const id = /^id:\s*["']?([a-f0-9]{64})["']?\s*$/m.exec(frontmatter)?.[1]
  if (!id) throw new ApiError(404, 'This note has no TDT id')
  return { id }
}

export interface RecordEditRequest {
  stage: 'preview' | 'apply'
  kind: 'knowledge' | 'index' | 'candidate' | string
  path: string
  id?: string
  expectedSha256: string
  body: string
  links: string[]
  summary?: Record<string, unknown>
  proposalSha256?: string | null
  confirmed?: boolean
}

function ok<T>(result: TdtResult<T>): T {
  if (result.ok && result.data) return result.data
  const status = result.error?.code === 'invalid_input' ? 400 : 409
  throw new ApiError(status, result.error?.message ?? 'TDT refused the edit')
}

function instruction(req: RecordEditRequest) {
  const at = new Date().toISOString()
  const what = req.kind === 'candidate' ? 'edited proposal' : 'replacement'
  return `In Helm's record editor the user reviewed the displayed ${what} for ${req.path} and clicked "Apply edit" (${at}).`.slice(0, 500)
}

export async function editRecord(bridges: BridgePool, ws: WorkspaceEntry, raw: Record<string, unknown>) {
  const req = raw as unknown as RecordEditRequest
  if (ws.profile !== 'everyday') {
    throw new ApiError(409, `Editing needs the everyday TDT profile. Set "profile": "everyday" on this workspace's entry in ${CONFIG_PATH}, then restart Helm.`)
  }
  if (req.stage !== 'preview' && req.stage !== 'apply') throw new ApiError(400, 'stage must be preview or apply')
  if (typeof req.path !== 'string' || !req.path || typeof req.body !== 'string') throw new ApiError(400, 'path and body are required')
  if (!HASH.test(String(req.expectedSha256))) throw new ApiError(400, 'expectedSha256 must be the record revision')
  if (!Array.isArray(req.links) || req.links.some((l) => typeof l !== 'string')) throw new ApiError(400, 'links must be strings')
  if (req.stage === 'apply' && req.confirmed !== true) throw new ApiError(400, 'Apply requires the user confirmation from the preview dialog')
  const bridge = bridges.get(ws)

  if (req.kind === 'knowledge' || req.kind === 'index') {
    const changes = [{ path: req.path, expected_sha256: req.expectedSha256, body: req.body, links: req.kind === 'index' ? [] : req.links }]
    if (req.stage === 'preview') {
      const data = ok(await bridge.call('tdt_brain_repair_preview', { changes, budget_bytes: 262144 })) as {
        proposal_sha256: string
        replacements: Record<string, string>
      }
      return { before: null, after: data.replacements[req.path] ?? null, proposalSha256: data.proposal_sha256 }
    }
    if (!HASH.test(String(req.proposalSha256))) throw new ApiError(400, 'Apply needs the proposal hash from preview')
    // Identical changes + the preview hash; TDT rechecks and refuses if anything moved.
    const data = ok(await bridge.call('tdt_brain_repair_apply', {
      changes, expected_sha256: req.proposalSha256, user_instruction: instruction(req), budget_bytes: 262144,
    }))
    return { applied: true, outcome: data }
  }

  if (req.kind === 'candidate') {
    if (!HASH.test(String(req.id))) throw new ApiError(400, 'Candidate edits need the candidate id')
    if (!req.summary || typeof req.summary !== 'object') throw new ApiError(400, 'Candidate edits need a summary')
    // TDT has no preview step for candidate edits; the browser shows its own projection.
    if (req.stage === 'preview') return { before: null, after: null, proposalSha256: null }
    const data = ok(await bridge.call('tdt_candidate_review', {
      id: req.id,
      expected_sha256: req.expectedSha256,
      user_instruction: instruction(req),
      decision: { action: 'edit', summary: req.summary },
      budget_bytes: 65536,
    }))
    return { applied: true, outcome: data }
  }

  throw new ApiError(400, `${req.kind} records can't be edited through TDT yet`)
}
