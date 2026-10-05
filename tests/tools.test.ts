import { describe, expect, test } from 'claude-code/testing'

import { READY_LINE, sha256 } from '../hooks/receipts'
import { BASE, GIT, KEY, PLAN, SPEC, TOP, boot, call, resultOf, started, world } from './world'

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
  test('sends codex the mode, the READY line and the captured material, and records the round', async ($, on) => {
    const w = await started($, on)
    const { runId } = await resultOf($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I', files: ['C:/repo/a.ts'] })
    expect(runId).toBe('r-1')
    const sent = w.reviews[0] as any
    expect(sent.reviewer).toBe('codex')
    expect(sent.mode).toBe('red-team')
    expect(sent.question).toBe('Q')
    expect(sent.instructions).toBe(`I\n\n${READY_LINE}`)
    expect(sent.artifact).toEqual({ text: `=== ${SPEC} ===\nspec v1\n`, files: ['C:/repo/a.ts'] })
    expect((await resultOf($, 'build_status')).rounds).toEqual({ spec: ['r-1'] })
  })

  test('a diff round withdraws its own receipt, keeps the upstream ones and names the top level', async ($, on) => {
    const w = await started($, on)
    const spec = `=== ${SPEC} ===\nspec v1\n`
    const plan = `=== ${PLAN} ===\nplan v1\n`
    const receipt = async (artifact: string, text: string) => ({ artifact, dir: TOP, fingerprint: await sha256(text), findings: [] })
    const run = w.store.get(`run:${KEY}`) as any
    w.store.set(`run:${KEY}`, { ...run, receipts: { spec: await receipt(SPEC, spec), plan: await receipt(PLAN, plan + spec), diff: await receipt(PLAN, 'old') } })
    await resultOf($, 'build_review', { checkpoint: 'diff', question: 'Q', instructions: 'I' })
    const sent = w.reviews[0] as any
    expect(sent.mode).toBe('diff-review')
    expect(sent.instructions).toBe(`I\n\nPaths in the diffs are relative to ${TOP}; give each finding's file as an absolute path.\n\n${READY_LINE}`)
    expect(sent.artifact.text.startsWith(`${plan}=== checkout ===\n${TOP}\n`)).toBe(true)
    expect(Object.keys((w.store.get(`run:${KEY}`) as any).receipts)).toEqual(['spec', 'plan'])
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

  test('a restart while review_start is pending records nothing, and a parallel build tool is refused', async ($, on) => {
    const w = await started($, on)
    w.holdStart = true
    const pending = call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    // settle() would wait for the held review_start; one step at a time lets it reach the hold.
    for (let i = 0; i < 50 && w.held.length === 0; i++) await w.clock.advance(0)
    expect((await call($, 'build_start', { base: 'main' })).deny).toBe('Another build tool is running; try again when it returns.')
    // Another session restarts the run.
    w.store.set(`run:${KEY}`, { ...(w.store.get(`run:${KEY}`) as any), id: 'other' })
    w.held[0]?.()
    expect((await pending).deny).toBe('The build run was restarted while this review started; its round is not recorded.')
    expect((await resultOf($, 'build_status')).rounds).toEqual({})
  })
})
