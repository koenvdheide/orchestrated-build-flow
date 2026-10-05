import type { Checkpoint } from '../types'

export const CHECKPOINTS: readonly Checkpoint[] = ['spec', 'plan', 'diff']
export const MODE: Record<Checkpoint, string> = { spec: 'red-team', plan: 'plan-review', diff: 'diff-review' }
export const UPSTREAM: Record<Checkpoint, Checkpoint | null> = { spec: null, plan: 'spec', diff: 'plan' }
export const NUMBER: Record<Checkpoint, number> = { spec: 1, plan: 2, diff: 3 }

// Each hand-off checks one receipt; validity is recursive, so it stands for the chain above it.
export const GATED: Readonly<Record<string, Checkpoint>> = {
  'superpowers-extended-cc:writing-plans': 'spec',
  'superpowers-extended-cc:subagent-driven-development': 'plan',
  'superpowers-extended-cc:executing-plans': 'plan',
  'superpowers-extended-cc:finishing-a-development-branch': 'diff',
}

export const READY_LINE = 'Begin your verdict with READY when nothing blocks this checkpoint, otherwise NOT READY.'
export const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/])/

// The parts of third-party-reviewers' records this mod reads; that plugin's contract owns them.
export type ReviewerFinding = {
  id: string
  file: string | null
  status: 'applied' | 'rejected' | 'unresolved'
  overrule: 'apply' | 'reject' | null
}
export type ReviewerRun = {
  id: string
  status: 'running' | 'complete' | 'failed' | 'cancelled'
  verdict: string | null
  findings: ReviewerFinding[]
}

export type Receipt = { artifact: string | null; dir: string | null; fingerprint: string; findings: ReviewerFinding[] }
export type BuildRun = { id: string; base: string; receipts: Partial<Record<Checkpoint, Receipt>> }

export type Validity =
  | { state: 'valid' }
  | { state: 'missing' }
  | { state: 'stale'; reason: string }
  | { state: 'unverifiable'; reason: string }

export function describe(v: Validity): string {
  return v.state === 'valid' || v.state === 'missing' ? v.state : `${v.state}: ${v.reason}`
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const section = (label: string, body: string): string => `=== ${label} ===\n${body}\n`

export const snapshot = (rounds: readonly ReviewerRun[]): ReviewerFinding[] =>
  rounds.filter(r => r.status === 'complete').flatMap(r => r.findings)

// Why a checkpoint's rounds cannot carry a receipt yet, or null when they can.
export function convergenceRefusal(runs: readonly ReviewerRun[], ids: readonly string[]): string | null {
  const rounds: ReviewerRun[] = []
  for (const id of ids) {
    const run = runs.find(r => r.id === id)
    if (!run) return `review ${id} is not in this session`
    rounds.push(run)
  }
  const last = rounds.at(-1)
  if (!last) return 'this checkpoint has no rounds in this session'
  const running = rounds.find(r => r.status === 'running')
  if (running) return `review ${running.id} is still running`
  if (last.status !== 'complete') return `the last review, ${last.id}, ${last.status === 'failed' ? 'failed' : 'was cancelled'}; start another round`
  if (!last.verdict?.startsWith('READY')) return `the last review's verdict does not begin with READY: ${last.verdict ?? 'none'}`
  for (const f of snapshot(rounds)) {
    if (f.status === 'unresolved') return `finding ${f.id} is unresolved`
    if (f.overrule === 'apply' && f.status !== 'applied') return `the user asked for finding ${f.id} to be applied; record it applied once the fix is made`
    if (f.overrule === 'reject' && f.status !== 'rejected') return `the user rejected finding ${f.id}; undo any fix and record it rejected`
    if (f.file !== null && !ABSOLUTE.test(f.file)) return `finding ${f.id} cites a relative path; update third-party-reviewers to 0.3.1 or later`
  }
  return null
}

// A snapshot finding whose status or overrule has changed while its run is still in the session.
export function drift(findings: readonly ReviewerFinding[], runs: readonly ReviewerRun[]): string | null {
  const live = new Map(runs.flatMap(r => r.findings).map(f => [f.id, f] as const))
  for (const f of findings) {
    const now = live.get(f.id)
    if (now && (now.status !== f.status || now.overrule !== f.overrule)) return `finding ${f.id} changed since the receipt was written`
  }
  return null
}

export function stopNote(checkpoint: Checkpoint, v: Validity, checkout: string): string {
  return `orchestrated-build-flow: the ${checkpoint} receipt is ${describe(v)} (checked in ${checkout}). Run checkpoint ${NUMBER[checkpoint]} (${MODE[checkpoint]}) first, and do not follow the skill below until build_status shows it valid, unless the user has explicitly chosen to skip that checkpoint.`
}
