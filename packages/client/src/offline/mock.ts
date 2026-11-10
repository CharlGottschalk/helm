// Offline-mode sample data (constitution: offline mode and the brain graph only).
import type { Tone } from '@usetdt/helm-sdk'

export interface Workspace {
  id: string
  name: string
  code: string
  kind: string
  tone: Tone
}

export type ProjectStatus = 'active' | 'shipping' | 'paused' | 'at-risk'

export interface Project {
  id: string
  wsId: string
  name: string
  code: string
  status: ProjectStatus
  health: number
  progress: number
  description: string
  ownerId: string
  teamIds: string[]
  stack: string[]
  /** live projects only: registered source path and TDT availability */
  path?: string
  availability?: 'available' | 'missing or moved' | 'archived'
  /** ISO time of registration */
  created?: string
}

export interface Task {
  id: string
  wsId: string
  projectId: string
  title: string
  priority: 'P0' | 'P1' | 'P2'
  estimate: string
}

export interface Note {
  id: string
  wsId: string
  kind: 'note' | 'doc'
  title: string
  excerpt: string
  projectIds: string[]
  conceptIds: string[]
  personIds: string[]
  updated: number
}

export interface Person {
  id: string
  wsId: string
  name: string
  role: string
}

export interface Concept {
  id: string
  wsId: string
  name: string
}

export interface AgentRun {
  id: string
  wsId: string
  title: string
  progress: number
  status: 'running' | 'queued'
}

const H = 3_600_000
const now = Date.now()

export const workspaces: Workspace[] = [
  { id: 'ws-labs', name: 'Helm Labs', code: 'HL', kind: 'Team · 7 operators', tone: 'cyan' },
  { id: 'ws-orbital', name: 'Orbital Studio', code: 'OS', kind: 'Studio · 3 operators', tone: 'violet' },
  { id: 'ws-personal', name: 'Personal', code: 'PX', kind: 'Solo', tone: 'amber' },
]

export const people: Person[] = [
  { id: 'p-ava', wsId: 'ws-labs', name: 'Ava Moreau', role: 'Engineering lead' },
  { id: 'p-kenji', wsId: 'ws-labs', name: 'Kenji Sato', role: 'ML engineer' },
  { id: 'p-priya', wsId: 'ws-labs', name: 'Priya Nair', role: 'Product design' },
  { id: 'p-tomas', wsId: 'ws-labs', name: 'Tomás Reyes', role: 'Platform' },
  { id: 'p-lena', wsId: 'ws-labs', name: 'Lena Fischer', role: 'Mobile' },
  { id: 'p-dev', wsId: 'ws-labs', name: 'Dev Okafor', role: 'Backend' },
  { id: 'p-mira', wsId: 'ws-labs', name: 'Mira Chen', role: 'Research' },
  { id: 'p-juno', wsId: 'ws-orbital', name: 'Juno Park', role: 'Creative director' },
  { id: 'p-sami', wsId: 'ws-orbital', name: 'Sami Haddad', role: 'Developer' },
  { id: 'p-rhea', wsId: 'ws-orbital', name: 'Rhea Lind', role: 'Game designer' },
  { id: 'p-me', wsId: 'ws-personal', name: 'Operator', role: 'You' },
  { id: 'p-advisor', wsId: 'ws-personal', name: 'Dr. Imani Cole', role: 'Thesis advisor' },
]

export const concepts: Concept[] = [
  { id: 'c-embed', wsId: 'ws-labs', name: 'Embeddings' },
  { id: 'c-vector', wsId: 'ws-labs', name: 'Vector index' },
  { id: 'c-memory', wsId: 'ws-labs', name: 'Agent memory' },
  { id: 'c-tokens', wsId: 'ws-labs', name: 'Design tokens' },
  { id: 'c-latency', wsId: 'ws-labs', name: 'Latency budget' },
  { id: 'c-auth', wsId: 'ws-labs', name: 'Auth' },
  { id: 'c-onboard', wsId: 'ws-labs', name: 'Onboarding' },
  { id: 'c-retrieval', wsId: 'ws-labs', name: 'Retrieval' },
  { id: 'c-telemetry', wsId: 'ws-labs', name: 'Telemetry' },
  { id: 'c-offline', wsId: 'ws-labs', name: 'Offline sync' },
  { id: 'c-brand', wsId: 'ws-orbital', name: 'Brand system' },
  { id: 'c-motion', wsId: 'ws-orbital', name: 'Motion' },
  { id: 'c-procgen', wsId: 'ws-orbital', name: 'Procedural gen' },
  { id: 'c-seo', wsId: 'ws-orbital', name: 'SEO' },
  { id: 'c-graphs', wsId: 'ws-personal', name: 'Knowledge graphs' },
  { id: 'c-k8s', wsId: 'ws-personal', name: 'Kubernetes' },
  { id: 'c-writing', wsId: 'ws-personal', name: 'Writing' },
  { id: 'c-cogsci', wsId: 'ws-personal', name: 'Cognitive science' },
]

export const projects: Project[] = [
  { id: 'pr-orion', wsId: 'ws-labs', name: 'Orion', code: 'ORN', status: 'active', health: 92, progress: 68, description: 'Agent runtime: tool orchestration, memory and sandboxed execution.', ownerId: 'p-ava', teamIds: ['p-ava', 'p-kenji', 'p-tomas'], stack: ['Rust', 'gRPC', 'Postgres'] },
  { id: 'pr-lumen', wsId: 'ws-labs', name: 'Lumen', code: 'LMN', status: 'shipping', health: 97, progress: 91, description: 'The Helm design system: tokens, HUD primitives and patterns.', ownerId: 'p-priya', teamIds: ['p-priya', 'p-lena'], stack: ['React', 'CSS Modules'] },
  { id: 'pr-atlas', wsId: 'ws-labs', name: 'Atlas', code: 'ATL', status: 'at-risk', health: 61, progress: 44, description: 'Knowledge ingestion pipeline feeding the workspace brain.', ownerId: 'p-kenji', teamIds: ['p-kenji', 'p-mira', 'p-dev'], stack: ['Python', 'Kafka', 'pgvector'] },
  { id: 'pr-vega', wsId: 'ws-labs', name: 'Vega', code: 'VGA', status: 'active', health: 84, progress: 37, description: 'Mobile companion with offline-first notes and voice capture.', ownerId: 'p-lena', teamIds: ['p-lena', 'p-priya'], stack: ['Swift', 'Kotlin'] },
  { id: 'pr-kestrel', wsId: 'ws-labs', name: 'Kestrel', code: 'KST', status: 'paused', health: 73, progress: 22, description: 'Usage metering and billing service.', ownerId: 'p-dev', teamIds: ['p-dev', 'p-tomas'], stack: ['Go', 'Stripe'] },
  { id: 'pr-echo', wsId: 'ws-labs', name: 'Echo', code: 'ECH', status: 'active', health: 88, progress: 55, description: 'Real-time voice interface for hands-free sessions.', ownerId: 'p-mira', teamIds: ['p-mira', 'p-kenji'], stack: ['WebRTC', 'TypeScript'] },
  { id: 'pr-nebula', wsId: 'ws-orbital', name: 'Nebula Site', code: 'NEB', status: 'shipping', health: 94, progress: 86, description: 'Marketing site rebuild with 3D hero.', ownerId: 'p-sami', teamIds: ['p-sami', 'p-juno'], stack: ['Astro', 'Three.js'] },
  { id: 'pr-halo', wsId: 'ws-orbital', name: 'Halo Brand', code: 'HAL', status: 'active', health: 81, progress: 52, description: 'Brand refresh for a client launch.', ownerId: 'p-juno', teamIds: ['p-juno'], stack: ['Figma'] },
  { id: 'pr-drift', wsId: 'ws-orbital', name: 'Drift', code: 'DRF', status: 'at-risk', health: 58, progress: 30, description: 'Procedural space exploration game prototype.', ownerId: 'p-rhea', teamIds: ['p-rhea', 'p-sami'], stack: ['Godot'] },
  { id: 'pr-thesis', wsId: 'ws-personal', name: 'Thesis', code: 'THS', status: 'active', health: 76, progress: 48, description: 'Memory consolidation in artificial agents.', ownerId: 'p-me', teamIds: ['p-me', 'p-advisor'], stack: ['LaTeX', 'Python'] },
  { id: 'pr-homelab', wsId: 'ws-personal', name: 'Homelab', code: 'HLB', status: 'active', health: 89, progress: 64, description: 'Three-node cluster running self-hosted services.', ownerId: 'p-me', teamIds: ['p-me'], stack: ['k3s', 'Proxmox'] },
  { id: 'pr-garden', wsId: 'ws-personal', name: 'Digital Garden', code: 'GRD', status: 'paused', health: 70, progress: 25, description: 'Public notes site.', ownerId: 'p-me', teamIds: ['p-me'], stack: ['Eleventy'] },
]

export const tasks: Task[] = [
  { id: 't1', wsId: 'ws-labs', projectId: 'pr-atlas', title: 'Fix duplicate chunks in the PDF ingest path', priority: 'P0', estimate: '3h' },
  { id: 't2', wsId: 'ws-labs', projectId: 'pr-orion', title: 'Add timeout budget to tool calls', priority: 'P1', estimate: '2h' },
  { id: 't3', wsId: 'ws-labs', projectId: 'pr-lumen', title: 'Document the Meter and Gauge components', priority: 'P2', estimate: '1h' },
  { id: 't4', wsId: 'ws-labs', projectId: 'pr-vega', title: 'Conflict resolution for offline note edits', priority: 'P1', estimate: '5h' },
  { id: 't5', wsId: 'ws-labs', projectId: 'pr-echo', title: 'Reduce first-token latency below 400ms', priority: 'P0', estimate: '1d' },
  { id: 't6', wsId: 'ws-labs', projectId: 'pr-orion', title: 'Review memory eviction policy RFC', priority: 'P1', estimate: '45m' },
  { id: 't7', wsId: 'ws-labs', projectId: 'pr-atlas', title: 'Backfill embeddings for Q3 docs', priority: 'P2', estimate: '4h' },
  { id: 't8', wsId: 'ws-labs', projectId: 'pr-kestrel', title: 'Decide on metering granularity', priority: 'P2', estimate: '30m' },
  { id: 't9', wsId: 'ws-orbital', projectId: 'pr-nebula', title: 'Compress hero textures for mobile', priority: 'P1', estimate: '2h' },
  { id: 't10', wsId: 'ws-orbital', projectId: 'pr-halo', title: 'Present logo directions to client', priority: 'P0', estimate: '1h' },
  { id: 't11', wsId: 'ws-orbital', projectId: 'pr-drift', title: 'Prototype asteroid field generator', priority: 'P1', estimate: '6h' },
  { id: 't12', wsId: 'ws-personal', projectId: 'pr-thesis', title: 'Draft chapter 3 outline', priority: 'P0', estimate: '2h' },
  { id: 't13', wsId: 'ws-personal', projectId: 'pr-homelab', title: 'Rotate backup encryption keys', priority: 'P1', estimate: '30m' },
  { id: 't14', wsId: 'ws-personal', projectId: 'pr-thesis', title: 'Read three papers on replay buffers', priority: 'P2', estimate: '3h' },
]

export const notes: Note[] = [
  { id: 'n1', wsId: 'ws-labs', kind: 'doc', title: 'Orion architecture overview', excerpt: 'Planner, executor and memory as separate services with a shared event log.', projectIds: ['pr-orion'], conceptIds: ['c-memory', 'c-latency'], personIds: ['p-ava'], updated: now - 2 * H },
  { id: 'n2', wsId: 'ws-labs', kind: 'note', title: 'Memory eviction ideas', excerpt: 'Score by recency × relevance; keep pinned facts forever.', projectIds: ['pr-orion', 'pr-atlas'], conceptIds: ['c-memory', 'c-vector'], personIds: ['p-kenji'], updated: now - 5 * H },
  { id: 'n3', wsId: 'ws-labs', kind: 'doc', title: 'Atlas ingest pipeline', excerpt: 'Sources → chunker → embedder → pgvector. Dedup happens too late.', projectIds: ['pr-atlas'], conceptIds: ['c-embed', 'c-vector', 'c-retrieval'], personIds: ['p-kenji', 'p-dev'], updated: now - 26 * H },
  { id: 'n4', wsId: 'ws-labs', kind: 'note', title: 'Retrieval eval results', excerpt: 'Hybrid search beats pure dense by 11% on our internal set.', projectIds: ['pr-atlas', 'pr-orion'], conceptIds: ['c-retrieval', 'c-embed'], personIds: ['p-mira'], updated: now - 30 * H },
  { id: 'n5', wsId: 'ws-labs', kind: 'doc', title: 'Lumen token spec', excerpt: 'Colour, type, space, motion. Cyan is primary, amber means attention.', projectIds: ['pr-lumen'], conceptIds: ['c-tokens'], personIds: ['p-priya'], updated: now - 8 * H },
  { id: 'n6', wsId: 'ws-labs', kind: 'note', title: 'HUD motion principles', excerpt: 'Motion confirms state; never decorates. 120 / 220 / 420ms.', projectIds: ['pr-lumen', 'pr-vega'], conceptIds: ['c-tokens'], personIds: ['p-priya', 'p-lena'], updated: now - 50 * H },
  { id: 'n7', wsId: 'ws-labs', kind: 'note', title: 'Offline sync strategy', excerpt: 'CRDT per note, server as relay. Merge on reconnect.', projectIds: ['pr-vega'], conceptIds: ['c-offline'], personIds: ['p-lena'], updated: now - 3 * H },
  { id: 'n8', wsId: 'ws-labs', kind: 'doc', title: 'Voice latency budget', excerpt: 'ASR 120ms, model 250ms, TTS 80ms. No slack left.', projectIds: ['pr-echo'], conceptIds: ['c-latency', 'c-telemetry'], personIds: ['p-mira', 'p-kenji'], updated: now - 12 * H },
  { id: 'n9', wsId: 'ws-labs', kind: 'note', title: 'Billing meter events', excerpt: 'Meter per tool call and per token. Aggregate hourly.', projectIds: ['pr-kestrel', 'pr-orion'], conceptIds: ['c-telemetry'], personIds: ['p-dev'], updated: now - 72 * H },
  { id: 'n10', wsId: 'ws-labs', kind: 'doc', title: 'SSO and workspace auth', excerpt: 'OIDC with per-workspace roles. Service tokens scoped to projects.', projectIds: ['pr-orion', 'pr-kestrel'], conceptIds: ['c-auth'], personIds: ['p-tomas'], updated: now - 96 * H },
  { id: 'n11', wsId: 'ws-labs', kind: 'note', title: 'First-run onboarding flow', excerpt: 'Register a project, connect a source, ask the first question.', projectIds: ['pr-lumen', 'pr-vega'], conceptIds: ['c-onboard'], personIds: ['p-priya'], updated: now - 20 * H },
  { id: 'n12', wsId: 'ws-labs', kind: 'note', title: 'Telemetry dashboard wishlist', excerpt: 'p95 per tool, error budget, cost per session.', projectIds: ['pr-orion', 'pr-echo'], conceptIds: ['c-telemetry', 'c-latency'], personIds: ['p-tomas'], updated: now - 44 * H },
  { id: 'n13', wsId: 'ws-labs', kind: 'doc', title: 'Embedding model comparison', excerpt: 'Smaller model is 3× cheaper and only 2% worse on recall.', projectIds: ['pr-atlas'], conceptIds: ['c-embed'], personIds: ['p-mira', 'p-kenji'], updated: now - 60 * H },
  { id: 'n14', wsId: 'ws-labs', kind: 'note', title: 'Weekly sync · decisions', excerpt: 'Pause Kestrel until Atlas is stable. Ship Lumen v1.', projectIds: ['pr-kestrel', 'pr-atlas', 'pr-lumen'], conceptIds: [], personIds: ['p-ava', 'p-dev', 'p-priya'], updated: now - 6 * H },
  { id: 'n20', wsId: 'ws-orbital', kind: 'doc', title: 'Halo brand guidelines v2', excerpt: 'Logo clearspace, palette, typography pairings.', projectIds: ['pr-halo'], conceptIds: ['c-brand'], personIds: ['p-juno'], updated: now - 4 * H },
  { id: 'n21', wsId: 'ws-orbital', kind: 'note', title: 'Hero scene performance', excerpt: 'Instanced meshes, bake lighting, cap DPR at 1.5.', projectIds: ['pr-nebula'], conceptIds: ['c-motion'], personIds: ['p-sami'], updated: now - 10 * H },
  { id: 'n22', wsId: 'ws-orbital', kind: 'note', title: 'Galaxy seed system', excerpt: 'One 64-bit seed per sector; deterministic everywhere.', projectIds: ['pr-drift'], conceptIds: ['c-procgen'], personIds: ['p-rhea'], updated: now - 30 * H },
  { id: 'n23', wsId: 'ws-orbital', kind: 'doc', title: 'Site IA and SEO plan', excerpt: 'Five top-level routes, case studies as long-form.', projectIds: ['pr-nebula'], conceptIds: ['c-seo', 'c-brand'], personIds: ['p-juno', 'p-sami'], updated: now - 50 * H },
  { id: 'n24', wsId: 'ws-orbital', kind: 'note', title: 'Motion language', excerpt: 'Slow drift, fast snaps. Everything eases out.', projectIds: ['pr-halo', 'pr-nebula', 'pr-drift'], conceptIds: ['c-motion', 'c-brand'], personIds: ['p-juno'], updated: now - 70 * H },
  { id: 'n30', wsId: 'ws-personal', kind: 'doc', title: 'Chapter 2 · related work', excerpt: 'Complementary learning systems and replay.', projectIds: ['pr-thesis'], conceptIds: ['c-cogsci', 'c-graphs'], personIds: ['p-advisor'], updated: now - 9 * H },
  { id: 'n31', wsId: 'ws-personal', kind: 'note', title: 'Cluster upgrade checklist', excerpt: 'Drain, upgrade, uncordon. One node at a time.', projectIds: ['pr-homelab'], conceptIds: ['c-k8s'], personIds: ['p-me'], updated: now - 30 * H },
  { id: 'n32', wsId: 'ws-personal', kind: 'note', title: 'Evergreen notes method', excerpt: 'Atomic, concept-oriented, densely linked.', projectIds: ['pr-garden', 'pr-thesis'], conceptIds: ['c-writing', 'c-graphs'], personIds: ['p-me'], updated: now - 80 * H },
  { id: 'n33', wsId: 'ws-personal', kind: 'note', title: 'Advisor meeting notes', excerpt: 'Narrow scope to episodic memory only.', projectIds: ['pr-thesis'], conceptIds: ['c-cogsci'], personIds: ['p-advisor', 'p-me'], updated: now - 50 * H },
]

export const agentRuns: AgentRun[] = [
  { id: 'r1', wsId: 'ws-labs', title: 'Re-indexing Atlas sources', progress: 62, status: 'running' },
  { id: 'r2', wsId: 'ws-labs', title: 'Summarising weekly decisions', progress: 18, status: 'running' },
  { id: 'r3', wsId: 'ws-labs', title: 'Nightly brain consolidation', progress: 0, status: 'queued' },
  { id: 'r20', wsId: 'ws-orbital', title: 'Generating Halo moodboard', progress: 40, status: 'running' },
  { id: 'r30', wsId: 'ws-personal', title: 'Citation check · chapter 2', progress: 75, status: 'running' },
]

export const statusTone: Record<ProjectStatus, Tone> = {
  active: 'cyan',
  shipping: 'green',
  paused: 'neutral',
  'at-risk': 'amber',
}

export const priorityTone: Record<Task['priority'], Tone> = { P0: 'red', P1: 'amber', P2: 'cyan' }

