import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checkpoint } from '../types'
import { CHECKPOINTS, UPSTREAM, describe, drift, section, sha256 } from './receipts'
import type { BuildRun, ReviewerRun, Validity } from './receipts'

// Everything that calls the engine lives in this file: the mod loader follows `$` only into
// functions declared here, never across an import. receipts.ts holds the pure parts.

type Engine = EngineInterface
type Checkout = { top: string; key: string }
type Answer = { result: string } | { deny: string }

const T = <N extends string>(name: N) => `mcp__orchestrated-build-flow__${name}` as const
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

async function registerTools($: Engine): Promise<void> {
  await $.tool.register({
    name: 'build_start',
    description: "Start or restart this repository's orchestrated build run: resolves base to a commit and drops earlier receipts. Follow the orchestrated-build-flow skill.",
    inputSchema: { type: 'object', required: ['base'], properties: { base: { type: 'string', description: 'the branch or commit the change is measured against' } } },
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

  on('tool.call', { tool: T('build_start') }, async ($, e) =>
    exclusive(async () => {
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

  on('tool.call', { tool: T('build_status') }, async $ => {
    try {
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
