import { describe, expect, test } from 'claude-code/testing'

import { READY_LINE, stopNote } from '../hooks/receipts'
import { BASE, GIT, KEY, PLAN, SPEC, TOP, boot, call, converge, finding, finish, resultOf, started, world } from './world'

describe('build_start', () => {
  test('resolves the base to a commit and starts a run with no receipts', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect(await resultOf($, 'build_start', { base: 'main' })).toEqual({ checkout: TOP, base: BASE })
    const run = w.store.get(`run:${KEY}`) as any
    expect(run.base).toBe(BASE)
    expect(run.receipts).toEqual({})
    expect(typeof run.id).toBe('string')
    expect((await resultOf($, 'build_status')).receipts).toEqual({ spec: 'missing', plan: 'missing', diff: 'missing' })
  })

  test('refuses a base that names no commit', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect((await call($, 'build_start', { base: 'nope' })).deny).toBe('nope does not name a commit')
  })

})

describe('build_status', () => {
  test('reports no run', async ($, on) => {
    const w = world(on)
    await boot($, w)
    expect(await resultOf($, 'build_status')).toEqual({ checkout: TOP, run: null })
  })

  test('is refused outside a git repository', async ($, on) => {
    const w = world(on)
    w.git.set(GIT.top, { exitCode: 128, stderr: 'fatal: not a git repository' })
    await boot($, w)
    expect((await call($, 'build_status')).deny).toBe('git rev-parse --show-toplevel failed: fatal: not a git repository')
  })

  test('is refused by a git too old for --path-format', async ($, on) => {
    const w = world(on)
    w.git.set(GIT.key, { stdout: '--path-format=absolute\n.git\n' })
    await boot($, w)
    expect((await call($, 'build_status')).deny).toBe('git 2.31 or later is required')
  })
})

describe('build_review', () => {
  test('sends codex the mode, the READY line and the captured material, records the round, and returns the review', async ($, on) => {
    const w = await started($, on)
    expect(await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I', files: ['C:/repo/a.ts'] })).toEqual({ id: 'r-1', status: 'running', verdict: null, findings: [] })
    const sent = w.reviews[0] as any
    expect(sent.reviewer).toBe('codex')
    expect(sent.mode).toBe('red-team')
    expect(sent.question).toBe('Q')
    expect(sent.instructions).toBe(`I\n\n${READY_LINE}`)
    expect(sent.artifact).toEqual({ text: `=== ${SPEC} ===\nspec v1\n`, files: ['C:/repo/a.ts'] })
    expect((await resultOf($, 'build_status')).rounds).toEqual({ spec: ['r-1'] })
  })

  test('refusals', async ($, on) => {
    const w = world(on)
    w.files.set(SPEC, 'spec v1')
    await boot($, w)
    expect((await call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })).deny).toBe(`No build run in ${TOP}; call build_start first.`)
    await call($, 'build_start', { base: 'main' })
    expect((await call($, 'build_review', { checkpoint: 'plan', artifact: PLAN, question: 'Q', instructions: 'I' })).deny).toBe('The spec receipt is missing; checkpoint plan reviews against it.')
    expect((await call($, 'build_review', { checkpoint: 'spec', artifact: 'docs/s.md', question: 'Q', instructions: 'I' })).deny).toBe("build_review for spec needs artifact, the spec file's absolute path.")
    expect((await call($, 'build_review', { checkpoint: 'spec', artifact: 'C:/repo/none.md', question: 'Q', instructions: 'I' })).deny).toContain('ENOENT')
    expect(w.reviews).toEqual([])
  })

  test('a refused review_start records no round', async ($, on) => {
    const w = await started($, on)
    w.startDeny = 'Codex is not installed here.'
    expect((await call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })).deny).toBe('review_start refused: Codex is not installed here.')
    expect((await resultOf($, 'build_status')).rounds).toEqual({})
  })

  test('a restart while review_start is pending records nothing, and parallel build tools are refused', async ($, on) => {
    const w = await started($, on)
    w.holdStart = true
    const pending = call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    // settle() would wait for the held review_start; one step at a time lets it reach the hold.
    for (let i = 0; i < 50 && w.held.length === 0; i++) await w.clock.advance(0)
    expect((await call($, 'build_start', { base: 'main' })).deny).toBe('Another build tool is running; try again when it returns.')
    expect((await call($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).deny).toBe('Another build tool is running; try again when it returns.')
    // Another session restarts the run.
    w.store.set(`run:${KEY}`, { ...(w.store.get(`run:${KEY}`) as any), id: 'other' })
    w.held[0]?.()
    expect((await pending).deny).toBe('The build run was restarted while this review ran; its round is not recorded.')
    expect((await resultOf($, 'build_status')).rounds).toEqual({})
  })
})

describe('build_receipt', () => {
  test('writes a receipt with the findings snapshot', async ($, on) => {
    const w = await started($, on)
    const { id: runId } = await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, runId, 'READY', [finding('r-1.1', { file: 'C:/repo/a.ts' })])
    expect(await resultOf($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).toEqual({ checkpoint: 'spec', receipt: 'written' })
    const receipt = (w.store.get(`run:${KEY}`) as any).receipts.spec
    expect(receipt.artifact).toBe(SPEC)
    expect(receipt.dir).toBe(null)
    expect(receipt.findings.map((f: any) => [f.id, f.claim])).toEqual([['r-1.1', 'c']])
    expect((await resultOf($, 'build_status')).receipts.spec).toBe('valid')
    expect((await resultOf($, 'build_status')).rounds).toEqual({})
  })

  test('refusals', async ($, on) => {
    const w = await started($, on)
    const receipt = (o: Record<string, unknown> = {}) => call($, 'build_receipt', { checkpoint: 'spec', userApproved: true, ...o })
    expect((await call($, 'build_receipt', { checkpoint: 'spec' })).deny).toBe('A spec receipt needs userApproved: true, after the user approved the converged spec.')
    expect((await receipt()).deny).toBe('Checkpoint spec has no rounds in this session for this build run.')
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    expect((await receipt()).deny).toBe('Not converged: review r-1 is still running.')
    finish(w, 'r-1', 'NOT READY: two gaps')
    expect((await receipt()).deny).toBe("Not converged: the last review's verdict does not begin with READY: NOT READY: two gaps.")
    finish(w, 'r-1', 'READY', [finding('r-1.1', { status: 'unresolved' })])
    expect((await receipt()).deny).toBe('Not converged: finding r-1.1 is unresolved.')
    finish(w, 'r-1', 'READY')
    w.files.set(SPEC, 'spec v2')
    expect((await receipt()).deny).toBe('What this checkpoint certifies changed after its last round was sent; start another round.')
    expect((await call($, 'build_receipt', { checkpoint: 'plan' })).deny).toBe('Checkpoint plan has no rounds in this session for this build run.')
  })

  test('failed and cancelled rounds followed by a READY round still yield a receipt', async ($, on) => {
    const w = await started($, on)
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-1', null as unknown as string, [], 'failed')
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-2', null as unknown as string, [], 'cancelled')
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-3', 'READY')
    expect((await call($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).deny).toBe(undefined)
  })

  test('a later receipt still answers for an earlier round overruled after the first', async ($, on) => {
    const w = await started($, on)
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-1', 'READY', [finding('r-1.1')])
    await call($, 'build_receipt', { checkpoint: 'spec', userApproved: true })
    finish(w, 'r-1', 'READY', [finding('r-1.1', { overrule: 'reject' })])
    expect((await resultOf($, 'build_status')).receipts.spec).toBe('stale: finding r-1.1 changed since the receipt was written')
    expect((await resultOf($, 'build_status')).rounds).toEqual({ spec: ['r-1'] })
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-2', 'READY')
    expect((await call($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).deny).toBe('Not converged: the user rejected finding r-1.1; undo any fix and record it rejected.')
  })

  test('refused while the upstream receipt does not hold', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    await resultOf($, 'build_review', { checkpoint: 'plan', artifact: PLAN, question: 'Q', instructions: 'I' })
    finish(w, 'r-2', 'READY')
    w.files.set(SPEC, 'spec v2')
    expect((await call($, 'build_receipt', { checkpoint: 'plan' })).deny).toBe('The spec receipt is stale: what it certifies changed after it was written.')
  })
})

describe('build_review with receipts', () => {
  test('the plan round carries the plan and the spec; the diff round the plan and the surface', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    await resultOf($, 'build_review', { checkpoint: 'plan', artifact: PLAN, question: 'Q', instructions: 'I' })
    expect((w.reviews[1] as any).mode).toBe('plan-review')
    expect((w.reviews[1] as any).artifact.text).toBe(`=== ${PLAN} ===\nplan v1\n=== ${SPEC} ===\nspec v1\n`)
    finish(w, 'r-2', 'READY')
    await call($, 'build_receipt', { checkpoint: 'plan' })
    w.git.set(GIT.worktree, { stdout: '+edit\n' })
    w.git.set(GIT.untracked, { stdout: 'new.ts\0' })
    w.git.set(GIT.newFile('new.ts'), { exitCode: 1, stdout: '+new\n' })
    await resultOf($, 'build_review', { checkpoint: 'diff', question: 'Q', instructions: 'I' })
    const text = (w.reviews[2] as any).artifact.text as string
    expect((w.reviews[2] as any).mode).toBe('diff-review')
    expect((w.reviews[2] as any).instructions).toBe(`I\n\nPaths in the diffs are relative to ${TOP}; give each finding's file as an absolute path.\n\n${READY_LINE}`)
    expect(text.startsWith(`=== ${PLAN} ===\nplan v1\n=== checkout ===\n${TOP}\n=== git rev-parse HEAD ===\n`)).toBe(true)
    expect(text).toContain(`=== git log ${BASE}..HEAD ===`)
    expect(text).toContain('=== git diff ===\n+edit\n')
    expect(text).toContain('=== untracked new.ts ===\n+new\n')
  })

  test('refuses a surface it cannot capture whole, and keeps the receipt in place', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    await converge($, w, 'plan')
    await converge($, w, 'diff')
    w.git.set(GIT.untracked, { stdout: 'nested/\0' })
    w.git.set(GIT.newFile('nested/'), { exitCode: 1, stdout: '', stderr: "error: Could not access 'nested/'" })
    expect((await call($, 'build_review', { checkpoint: 'diff', question: 'Q', instructions: 'I' })).deny).toBe("cannot diff untracked nested/: error: Could not access 'nested/'; add it to .gitignore or make it a submodule")
    expect((w.store.get(`run:${KEY}`) as any).receipts.diff).not.toBe(undefined)
    expect((await resultOf($, 'build_status')).receipts.diff).not.toBe('missing')
    w.git.set(GIT.untracked, { stdout: '' })
    w.git.set(GIT.worktree, { stdout: 'x', truncated: true })
    expect((await call($, 'build_review', { checkpoint: 'diff', question: 'Q', instructions: 'I' })).deny).toBe('git diff printed more than 4 MiB')
  })

  test('withdraws the receipt before the reviewer starts, and starts nothing when it cannot', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    w.failStore = true
    expect((await call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })).deny).toContain('EACCES')
    expect(w.reviews.length).toBe(1)
    w.failStore = false
    w.holdStart = true
    const pending = call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    // settle() would wait for the held review_start; one step at a time lets it reach the hold.
    for (let i = 0; i < 50 && w.held.length === 0; i++) await w.clock.advance(0)
    expect((w.store.get(`run:${KEY}`) as any).receipts.spec).toBe(undefined)
    w.held[0]?.()
    await pending
    expect(w.reviews.length).toBe(2)
    expect((await resultOf($, 'build_status')).receipts.spec).toBe('missing')
  })

  test('a new run drops the earlier receipts and rounds', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    expect((await resultOf($, 'build_status')).receipts.spec).toBe('valid')
    await call($, 'build_start', { base: 'main' })
    expect((await resultOf($, 'build_status')).receipts.spec).toBe('missing')
    expect((await call($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).deny).toBe('Checkpoint spec has no rounds in this session for this build run.')
  })
})

describe('validity', () => {
  async function chain($: any, on: any) {
    const w = await started($, on)
    await converge($, w, 'spec')
    await converge($, w, 'plan')
    await converge($, w, 'diff')
    expect((await resultOf($, 'build_status')).receipts).toEqual({ spec: 'valid', plan: 'valid', diff: 'valid' })
    return w
  }

  test('a spec edit stales the whole chain, a plan edit the plan and the diff', async ($, on) => {
    const w = await chain($, on)
    w.files.set(PLAN, 'plan v2')
    expect((await resultOf($, 'build_status')).receipts).toEqual({
      spec: 'valid',
      plan: 'stale: what it certifies changed after it was written',
      diff: 'stale: the plan receipt is stale: what it certifies changed after it was written',
    })
    w.files.set(PLAN, 'plan v1')
    w.files.set(SPEC, 'spec v2')
    const r = (await resultOf($, 'build_status')).receipts
    expect(r.spec).toBe('stale: what it certifies changed after it was written')
    expect(r.plan).toBe('stale: the spec receipt is stale: what it certifies changed after it was written')
    expect(r.diff.startsWith('stale: the plan receipt is stale: the spec receipt')).toBe(true)
  })

  test('every surface change stales the diff receipt', async ($, on) => {
    const w = await chain($, on)
    for (const cmd of [GIT.head, GIT.log, GIT.cached, GIT.worktree]) {
      const before = w.git.get(cmd)!
      w.git.set(cmd, { stdout: 'changed\n' })
      expect((await resultOf($, 'build_status')).receipts.diff).toBe('stale: what it certifies changed after it was written')
      w.git.set(cmd, before)
    }
    w.git.set(GIT.untracked, { stdout: 'n.ts\0' })
    w.git.set(GIT.newFile('n.ts'), { exitCode: 1, stdout: '+n\n' })
    expect((await resultOf($, 'build_status')).receipts.diff).toBe('stale: what it certifies changed after it was written')
  })

  test('a diff round or receipt from one checkout does not hold in another', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    await converge($, w, 'plan')
    const { id: runId } = await resultOf($, 'build_review', { checkpoint: 'diff', question: 'Q', instructions: 'I' })
    finish(w, runId, 'READY')
    w.git.set(GIT.top, { stdout: 'C:/repo-wt\n' })
    expect((await call($, 'build_receipt', { checkpoint: 'diff' })).deny).toBe('What this checkpoint certifies changed after its last round was sent; start another round.')
    w.git.set(GIT.top, { stdout: `${TOP}\n` })
    expect((await call($, 'build_receipt', { checkpoint: 'diff' })).deny).toBe(undefined)
    w.git.set(GIT.top, { stdout: 'C:/repo-wt\n' })
    expect((await resultOf($, 'build_status')).receipts.diff).toBe(`stale: it was written in ${TOP}`)
  })

  test('a session in a subdirectory collects from the top level', async ($, on) => {
    const w = await started($, on)
    w.cwd = 'C:/repo/sub'
    w.git.set(GIT.untracked, { stdout: 'other/x.ts\0' })
    w.git.set(GIT.newFile('other/x.ts'), { exitCode: 1, stdout: '+x\n' })
    await converge($, w, 'spec')
    await converge($, w, 'plan')
    expect((await converge($, w, 'diff')).deny).toBe(undefined)
    expect((w.reviews[2] as any).artifact.text).toContain('=== untracked other/x.ts ===\n+x\n')
  })

  test('a new round holds the later receipts, and an unchanged reissue restores them', async ($, on) => {
    const w = await chain($, on)
    const { id: runId } = await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    expect((await resultOf($, 'build_status')).receipts).toEqual({ spec: 'missing', plan: 'stale: the spec receipt is missing', diff: 'stale: the plan receipt is stale: the spec receipt is missing' })
    finish(w, runId, 'READY')
    await call($, 'build_receipt', { checkpoint: 'spec', userApproved: true })
    expect((await resultOf($, 'build_status')).receipts).toEqual({ spec: 'valid', plan: 'valid', diff: 'valid' })
  })

  test('a receipted document that cannot be read is reported unverifiable', async ($, on) => {
    const w = await started($, on)
    await converge($, w, 'spec')
    w.files.delete(SPEC)
    expect((await resultOf($, 'build_status')).receipts.spec.startsWith('unverifiable: ')).toBe(true)
  })

  test('rounds and the armed gate come back when the conversation is resumed, and only then', async ($, on) => {
    const w = await started($, on)
    const plans = async () => (await $.skill.prompt({ skill: 'superpowers-extended-cc:writing-plans', text: 'original' })).text
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-1', 'READY')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.sessionId = 's2'
    expect(await plans()).toBe('original')
    expect((await resultOf($, 'build_status')).rounds).toEqual({})
    await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's2' } })
    w.sessionId = 's1'
    await $.classic.SessionStart({ source: 'resume', session_id: 's1' })
    expect(await plans()).toBe(`${stopNote('spec', { state: 'missing' }, TOP)}\n\noriginal`)
    // Compaction keeps the conversation, so the store is not read back.
    w.store.delete('rounds:s1')
    await $.classic.SessionStart({ source: 'compact', session_id: 's1' })
    expect(await resultOf($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).toEqual({ checkpoint: 'spec', receipt: 'written' })
  })

  test('a snapshot that cannot be saved is named in a toast and the tool still answers', async ($, on) => {
    const w = await started($, on)
    w.failStore = true
    expect((await resultOf($, 'build_status')).checkout).toBe(TOP)
    expect(w.toasts.some(t => t.startsWith('Could not save the build state'))).toBe(true)
  })

  test('session start drops the least recently saved conversations past the budget, both keys together, never the current one or a run', async ($, on) => {
    const w = world(on)
    const MiB = 1024 * 1024
    // Two UTF-8 bytes a character, so a budget counted in characters would keep them all.
    const saved = (savedAt: number, size: number) => ({ savedAt, rounds: { spec: { build: 'b', reviews: [], artifact: 'é'.repeat(size / 2), fingerprint: 'f' } } })
    w.store.set(`run:${KEY}`, { id: 'run', base: BASE, receipts: {} })
    w.store.set('rounds:s1', saved(0, 0.5 * MiB))
    // Ranked by each key alone, b would stay and a's armed and c's rounds would go.
    w.store.set('armed:a', { savedAt: 1 })
    w.store.set('rounds:a', saved(5, 0.5 * MiB))
    w.store.set('armed:b', { savedAt: 4 })
    w.store.set('rounds:b', saved(4, 0.5 * MiB))
    w.store.set('armed:c', { savedAt: 6 })
    w.store.set('rounds:c', saved(2, 0.75 * MiB))
    w.store.set('armed:d', { savedAt: 0.5 })
    await boot($, w)
    expect([...w.store.keys()].sort()).toEqual(['armed:a', 'armed:c', 'rounds:a', 'rounds:c', 'rounds:s1', `run:${KEY}`])
  })

  test('a round history holding a review third-party-reviewers no longer has starts over', async ($, on) => {
    const w = await started($, on)
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    w.setRuns([])
    await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    finish(w, 'r-2', 'READY')
    expect(await resultOf($, 'build_receipt', { checkpoint: 'spec', userApproved: true })).toEqual({ checkpoint: 'spec', receipt: 'written' })
  })

  test('a round whose conversation ended while it was prepared sends nothing', async ($, on) => {
    const w = await started($, on)
    w.holdRead = true
    const pending = call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    await w.clock.settle()
    w.holdRead = false
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.sessionId = 's2'
    w.heldRead.forEach(release => release())
    expect((await pending).deny).toBe('The conversation changed, so the round was not sent.')
    expect(w.reviews).toEqual([])
  })

  test('a review that returns after its conversation ended records no round', async ($, on) => {
    const w = await started($, on)
    w.holdStart = true
    const pending = call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    await w.clock.settle()
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.sessionId = 's2'
    w.held[0]?.()
    await pending
    expect((await resultOf($, 'build_status')).rounds).toEqual({})
  })
})
