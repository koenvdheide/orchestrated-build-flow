import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checkpoint } from '../types'
import { ABSOLUTE, CHECKPOINTS, GATED, MODE, READY_LINE, UPSTREAM, convergenceRefusal, describe, drift, section, sha256, snapshot, stopNote } from './receipts'
import type { BuildRun, Receipt, ReviewerRun, Validity } from './receipts'

// Everything that calls the engine lives in this file: the mod loader follows `$` only into
// functions declared here, never across an import. receipts.ts holds the pure parts.

type Engine = EngineInterface
type Checkout = { top: string; key: string }
type Answer = { result: string } | { deny: string }

const T = <N extends string>(name: N) => `mcp__orchestrated-build-flow__${name}` as const
const REVIEW_START = 'mcp__third-party-reviewers__review_start'
const ORCHESTRATOR = 'orchestrated-build-flow:orchestrated-build-flow'
const DIFF = ['--binary', '--no-textconv', '--no-ext-diff']

const armed = atom({ plugin: 'orchestrated-build-flow', key: 'armed' } as const, false)
const rounds = atom({ plugin: 'orchestrated-build-flow', key: 'rounds' } as const, {})
const reviewerRuns = { plugin: 'third-party-reviewers', key: 'runs' } as const

// One build tool or gate check at a time in this session, so a receipt is never written or
// trusted while a parallel call is withdrawing it.
let busy = false

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function exclusive(fn: () => Promise<Answer>): Promise<Answer> {
  if (busy) return { deny: 'Another build tool is running; try again when it returns.' }
  busy = true
  try {
    return await fn()
  } catch (err) {
    return { deny: message(err) }
  } finally {
    busy = false
  }
}

async function git($: Engine, cwd: string, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { cwd })
  if (r.isStdoutTruncated) throw new Error(`git ${args[0]} printed more than 4 MiB`)
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return r.stdout
}

// The checkout the session works in: cwd follows a Bash `cd`, the session root does not.
async function checkout($: Engine): Promise<Checkout> {
  const cwd = await $.session.cwd()
  const top = (await git($, cwd, ['rev-parse', '--show-toplevel'])).trim()
  const key = (await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  if (!ABSOLUTE.test(key)) throw new Error('git 2.31 or later is required')
  return { top, key }
}

const storeKey = (c: Checkout) => `run:${c.key}`

async function loadRun($: Engine, c: Checkout): Promise<BuildRun | null> {
  return ((await $.store.get(storeKey(c))) as BuildRun | undefined) ?? null
}

// Writes the repository's run only while it is still the run this call began with.
async function save($: Engine, c: Checkout, id: string, change: (run: BuildRun) => BuildRun): Promise<void> {
  const current = await loadRun($, c)
  if (current?.id !== id) throw new Error('The build run was restarted while this call ran; nothing was written.')
  await $.store.set(storeKey(c), change(current))
}

async function liveRuns($: Engine): Promise<readonly ReviewerRun[]> {
  return (await read($, reviewerRuns)) ?? []
}

const need = (value: string | null, what: string): string => {
  if (value === null) throw new Error(`${what} is missing`)
  return value
}

async function documentOf($: Engine, path: string): Promise<string> {
  return section(path, await $.fs.read(path))
}

async function surface($: Engine, top: string, base: string): Promise<string> {
  const parts = [
    // Names the checkout, so a round sent from one worktree cannot certify another with equal changes.
    section('checkout', top),
    section('git rev-parse HEAD', await git($, top, ['rev-parse', 'HEAD'])),
    section(`git log ${base}..HEAD`, await git($, top, ['log', '--format=%H %s', `${base}..HEAD`])),
    section(`git diff --cached ${base}`, await git($, top, ['diff', '--cached', ...DIFF, '--ignore-submodules=none', base])),
    section('git diff', await git($, top, ['diff', ...DIFF, '--ignore-submodules=none'])),
  ]
  const untracked = (await git($, top, ['ls-files', '-o', '--exclude-standard', '-z'])).split('\0').filter(p => p !== '')
  for (const path of untracked) {
    const r = await $.process.run(['git', 'diff', '--no-index', ...DIFF, '--', '/dev/null', path], { cwd: top })
    if (r.isStdoutTruncated) throw new Error(`the patch for untracked ${path} is more than 4 MiB`)
    // Exit 1 means "differs"; with no patch, git could not diff it (an untracked nested repository).
    if (r.exitCode !== 1 || r.stdout === '') {
      const why = r.stderr.trim()
      throw new Error(`cannot diff untracked ${path}${why ? `: ${why}` : ''}; add it to .gitignore or make it a submodule`)
    }
    parts.push(section(`untracked ${path}`, r.stdout))
  }
  return parts.join('')
}

// The material a checkpoint's review is sent; its fingerprint is this text's hash.
async function material($: Engine, c: Checkout, run: BuildRun, checkpoint: Checkpoint, artifact: string | null): Promise<string> {
  if (checkpoint === 'spec') return documentOf($, need(artifact, 'the spec path'))
  const up = checkpoint === 'plan' ? 'spec' : 'plan'
  const upstream = need(run.receipts[up]?.artifact ?? null, `the ${up} receipt's document`)
  if (checkpoint === 'plan') return (await documentOf($, need(artifact, 'the plan path'))) + (await documentOf($, upstream))
  return (await documentOf($, upstream)) + (await surface($, c.top, run.base))
}

async function validity($: Engine, c: Checkout, run: BuildRun, checkpoint: Checkpoint, live: readonly ReviewerRun[]): Promise<Validity> {
  const receipt = run.receipts[checkpoint]
  if (!receipt) return { state: 'missing' }
  const up = UPSTREAM[checkpoint]
  if (up !== null) {
    const u = await validity($, c, run, up, live)
    if (u.state !== 'valid') return { state: 'stale', reason: `the ${up} receipt is ${describe(u)}` }
  }
  if (receipt.dir !== null && receipt.dir !== c.top) return { state: 'stale', reason: `it was written in ${receipt.dir}` }
  if ((await sha256(await material($, c, run, checkpoint, receipt.artifact))) !== receipt.fingerprint) {
    return { state: 'stale', reason: 'what it certifies changed after it was written' }
  }
  const changed = drift(receipt.findings, live)
  return changed ? { state: 'stale', reason: changed } : { state: 'valid' }
}

async function checked($: Engine, c: Checkout, run: BuildRun, checkpoint: Checkpoint, live: readonly ReviewerRun[]): Promise<Validity> {
  return validity($, c, run, checkpoint, live).catch((err: unknown): Validity => ({ state: 'unverifiable', reason: message(err) }))
}

// The stop note for a hand-off whose receipt does not hold, or null when it holds.
async function gateNote($: Engine, cp: Checkpoint): Promise<string | null> {
  if (busy) return stopNote(cp, { state: 'unverifiable', reason: 'a build tool is running' }, 'this session')
  busy = true
  let where = 'this session'
  try {
    const c = await checkout($)
    where = c.top
    const run = await loadRun($, c)
    const v: Validity = run ? await validity($, c, run, cp, await liveRuns($)) : { state: 'missing' }
    return v.state === 'valid' ? null : stopNote(cp, v, where)
  } catch (err) {
    return stopNote(cp, { state: 'unverifiable', reason: message(err) }, where)
  } finally {
    busy = false
  }
}

async function registerTools($: Engine): Promise<void> {
  await $.tool.register({
    name: 'build_start',
    description: "Start or restart this repository's orchestrated build run: resolves base to a commit and drops earlier receipts. Follow the orchestrated-build-flow skill.",
    inputSchema: { type: 'object', required: ['base'], properties: { base: { type: 'string', description: 'the branch or commit the change is measured against' } } },
  })
  await $.tool.register({
    name: 'build_review',
    description: "Start one round of a checkpoint's Codex review (spec, plan or diff) through third-party-reviewers. Sends Codex exactly the material the receipt will certify and records the round. Follow the orchestrated-build-flow skill.",
    inputSchema: {
      type: 'object',
      required: ['checkpoint', 'question', 'instructions'],
      properties: {
        checkpoint: { enum: ['spec', 'plan', 'diff'] },
        artifact: { type: 'string', description: 'the spec or plan file, absolute; not for diff' },
        question: { type: 'string' },
        instructions: { type: 'string', description: "the codex skill's mode instructions, plus the Previously identified findings block from round 2 on" },
        files: { type: 'array', items: { type: 'string' }, description: 'absolute paths for context; not certified' },
      },
    },
  })
  await $.tool.register({
    name: 'build_receipt',
    description: "Write a checkpoint's receipt once its rounds have converged and nothing changed since the last was sent; refuses with the reason otherwise.",
    inputSchema: {
      type: 'object',
      required: ['checkpoint'],
      properties: { checkpoint: { enum: ['spec', 'plan', 'diff'] }, userApproved: { type: 'boolean', description: 'spec only: true once the user approved the converged spec' } },
    },
  })
  await $.tool.register({
    name: 'build_status',
    description: "This repository's build run: each checkpoint receipt valid, stale, missing or unverifiable, and this session's review rounds.",
    inputSchema: { type: 'object', properties: {} },
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerTools($)
    return started
  })

  on('session.end', async ($, e, next) => {
    await update($, armed, () => false)
    await update($, rounds, () => ({}))
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    // `skill.prompt` carries the plugin-qualified name.
    if (e.skill === ORCHESTRATOR) {
      await update($, armed, () => true)
      return next(e)
    }
    // Own keys only: `constructor` and its kin are inherited, never gated.
    const cp = Object.hasOwn(GATED, e.skill) ? GATED[e.skill] : undefined
    if (cp === undefined || !(await read($, armed))) return next(e)
    const note = await gateNote($, cp)
    if (note === null) return next(e)
    const loaded = await next(e)
    return { text: `${note}\n\n${loaded.text}` }
  })

  on('tool.call', { tool: T('build_start') }, async ($, e) =>
    exclusive(async () => {
      await update($, armed, () => true)
      const { base } = e as unknown as { base: string }
      const c = await checkout($)
      const commit = await git($, c.top, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).catch(() => {
        throw new Error(`${base} does not name a commit`)
      })
      const run: BuildRun = { id: crypto.randomUUID(), base: commit.trim(), receipts: {} }
      await $.store.set(storeKey(c), run)
      return { result: JSON.stringify({ checkout: c.top, base: run.base }) }
    }),
  )

  on('tool.call', { tool: T('build_review') }, async ($, e) =>
    exclusive(async () => {
      await update($, armed, () => true)
      const input = e as unknown as { checkpoint: Checkpoint; artifact?: string; question: string; instructions: string; files?: string[] }
      const cp = input.checkpoint
      const c = await checkout($)
      const run = await loadRun($, c)
      if (!run) throw new Error(`No build run in ${c.top}; call build_start first.`)
      const up = UPSTREAM[cp]
      if (up !== null) {
        const u = await checked($, c, run, up, await liveRuns($))
        if (u.state !== 'valid') throw new Error(`The ${up} receipt is ${describe(u)}; checkpoint ${cp} reviews against it.`)
      }
      const artifact = cp === 'diff' ? null : input.artifact ?? null
      if (cp !== 'diff' && (artifact === null || !ABSOLUTE.test(artifact))) throw new Error(`build_review for ${cp} needs artifact, the ${cp} file's absolute path.`)
      const text = await material($, c, run, cp, artifact)
      // Withdraw the receipt this round may overturn before the reviewer starts.
      if (run.receipts[cp]) await save($, c, run.id, r => ({ ...r, receipts: { ...r.receipts, [cp]: undefined } }))
      const fingerprint = await sha256(text)
      // Codex runs in the session's directory, which may be a subdirectory; the diffs are relative to the top level.
      const paths = cp === 'diff' ? `\n\nPaths in the diffs are relative to ${c.top}; give each finding's file as an absolute path.` : ''
      const started = await $.tool.call({
        tool: REVIEW_START,
        reviewer: 'codex',
        mode: MODE[cp],
        question: input.question,
        instructions: `${input.instructions}${paths}\n\n${READY_LINE}`,
        artifact: { text, files: input.files ?? [] },
      })
      if ('deny' in started && started.deny !== undefined) throw new Error(`review_start refused: ${started.deny}`)
      const runId = (JSON.parse(String(started.result)) as { runId: string }).runId
      if ((await loadRun($, c))?.id !== run.id) throw new Error('The build run was restarted while this review started; its round is not recorded.')
      await update($, rounds, all => {
        const prior = all[cp]
        const reviews = prior?.build === run.id ? [...prior.reviews, runId] : [runId]
        return { ...all, [cp]: { build: run.id, reviews, artifact, fingerprint } }
      })
      return { result: JSON.stringify({ runId, checkpoint: cp, note: 'The review arrives as a notification; read it with review_results and record each finding with review_record.' }) }
    }),
  )

  on('tool.call', { tool: T('build_receipt') }, async ($, e) =>
    exclusive(async () => {
      await update($, armed, () => true)
      const { checkpoint: cp, userApproved } = e as unknown as { checkpoint: Checkpoint; userApproved?: boolean }
      if (cp === 'spec' && userApproved !== true) throw new Error('A spec receipt needs userApproved: true, after the user approved the converged spec.')
      const c = await checkout($)
      const run = await loadRun($, c)
      if (!run) throw new Error(`No build run in ${c.top}; call build_start first.`)
      const r = (await read($, rounds))[cp]
      if (!r || r.build !== run.id) throw new Error(`Checkpoint ${cp} has no rounds in this session for this build run.`)
      const live = await liveRuns($)
      const up = UPSTREAM[cp]
      if (up !== null) {
        const u = await checked($, c, run, up, live)
        if (u.state !== 'valid') throw new Error(`The ${up} receipt is ${describe(u)}.`)
      }
      const refusal = convergenceRefusal(live, r.reviews)
      if (refusal) throw new Error(`Not converged: ${refusal}.`)
      if ((await sha256(await material($, c, run, cp, r.artifact))) !== r.fingerprint) {
        throw new Error('What this checkpoint certifies changed after its last round was sent; start another round.')
      }
      const reviewed = r.reviews.map(id => live.find(x => x.id === id)).filter((x): x is ReviewerRun => x !== undefined)
      const receipt: Receipt = { artifact: r.artifact, dir: cp === 'diff' ? c.top : null, fingerprint: r.fingerprint, findings: snapshot(reviewed) }
      await save($, c, run.id, b => ({ ...b, receipts: { ...b.receipts, [cp]: receipt } }))
      return { result: JSON.stringify({ checkpoint: cp, receipt: 'written' }) }
    }),
  )

  on('tool.call', { tool: T('build_status') }, async $ => {
    try {
      await update($, armed, () => true)
      const c = await checkout($)
      const run = await loadRun($, c)
      if (!run) return { result: JSON.stringify({ checkout: c.top, run: null }) }
      const live = await liveRuns($)
      const receipts: Record<string, string> = {}
      for (const cp of CHECKPOINTS) receipts[cp] = describe(await checked($, c, run, cp, live))
      const all = await read($, rounds)
      const inSession = Object.fromEntries(CHECKPOINTS.flatMap(cp => {
        const r = all[cp]
        // Rounds of a checkpoint whose receipt holds stay in state; only open checkpoints are reported.
        return r && r.build === run.id && receipts[cp] !== 'valid' ? [[cp, r.reviews]] : []
      }))
      return { result: JSON.stringify({ checkout: c.top, base: run.base, receipts, rounds: inSession }) }
    } catch (err) {
      return { deny: message(err) }
    }
  })
}
