import { describe, expect, test } from 'claude-code/testing'

import { stopNote } from '../hooks/receipts'
import { BASE, GIT, KEY, SPEC, TOP, boot, call, converge, started, world } from './world'

const ORCHESTRATOR = 'orchestrated-build-flow:orchestrated-build-flow'
const sp = (name: string) => `superpowers-extended-cc:${name}`
const load = async ($: any, skill: string) => (await $.skill.prompt({ skill, text: 'original' })).text as string

describe('gate', () => {
  test('an unarmed session is never gated', async ($, on) => {
    await boot($, world(on))
    expect(await load($, sp('writing-plans'))).toBe('original')
  })

  // A resumed conversation has lost the skill load; its first build tool call, even a refused one, arms the gate.
  for (const [name, args] of [
    ['build_start', { base: 'main' }],
    ['build_review', { checkpoint: 'diff', question: 'Q', instructions: 'I' }],
    ['build_receipt', { checkpoint: 'diff' }],
    ['build_status', {}],
  ] as const) {
    test(`${name} arms the session without the orchestrator skill`, async ($, on) => {
      const w = world(on)
      await boot($, w)
      w.store.set(`run:${KEY}`, { id: 'run', base: BASE, receipts: {} })
      await call($, name, args)
      expect(await load($, sp('writing-plans'))).toBe(`${stopNote('spec', { state: 'missing' }, TOP)}\n\noriginal`)
    })
  }

  test('armed, each hand-off checks its receipt', async ($, on) => {
    const w = await started($, on)
    await load($, ORCHESTRATOR)
    expect(await load($, sp('writing-plans'))).toBe(`${stopNote('spec', { state: 'missing' }, TOP)}\n\noriginal`)
    await converge($, w, 'spec')
    expect(await load($, sp('writing-plans'))).toBe('original')
    expect(await load($, sp('subagent-driven-development'))).toBe(`${stopNote('plan', { state: 'missing' }, TOP)}\n\noriginal`)
    expect(await load($, sp('executing-plans'))).toBe(`${stopNote('plan', { state: 'missing' }, TOP)}\n\noriginal`)
    await converge($, w, 'plan')
    expect(await load($, sp('executing-plans'))).toBe('original')
    expect(await load($, sp('finishing-a-development-branch'))).toBe(`${stopNote('diff', { state: 'missing' }, TOP)}\n\noriginal`)
    await converge($, w, 'diff')
    expect(await load($, sp('finishing-a-development-branch'))).toBe('original')
    w.files.set(SPEC, 'spec v2')
    expect(await load($, sp('finishing-a-development-branch'))).toContain('the diff receipt is stale: the plan receipt is stale: the spec receipt is stale')
  })

  test('a check that throws, or runs during a build tool, gives an unverifiable note', async ($, on) => {
    const w = await started($, on)
    await load($, ORCHESTRATOR)
    w.git.set(GIT.top, { exitCode: 128, stderr: 'fatal: not a git repository' })
    expect(await load($, sp('writing-plans'))).toBe(
      `${stopNote('spec', { state: 'unverifiable', reason: 'git rev-parse --show-toplevel failed: fatal: not a git repository' }, 'this session')}\n\noriginal`,
    )
    w.git.set(GIT.top, { stdout: `${TOP}\n` })
    w.holdStart = true
    const pending = call($, 'build_review', { checkpoint: 'spec', artifact: SPEC, question: 'Q', instructions: 'I' })
    for (let i = 0; i < 50 && w.held.length === 0; i++) await w.clock.advance(0)
    expect(await load($, sp('writing-plans'))).toBe(`${stopNote('spec', { state: 'unverifiable', reason: 'a build tool is running' }, 'this session')}\n\noriginal`)
    w.held[0]?.()
    await pending
  })

  test('a call that outlives its conversation does not arm the next one', async ($, on) => {
    const w = world(on)
    await boot($, w)
    w.holdArm = true
    const pending = load($, ORCHESTRATOR)
    await w.clock.settle()
    w.holdArm = false
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.sessionId = 's2'
    w.heldArm.forEach(release => release())
    await pending
    expect(await load($, sp('writing-plans'))).toBe('original')
  })

  test('other skills pass untouched, and session end disarms', async ($, on) => {
    await started($, on)
    await load($, ORCHESTRATOR)
    expect(await load($, 'third-party-reviewers:codex')).toBe('original')
    expect(await load($, 'constructor')).toBe('original')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(await load($, sp('writing-plans'))).toBe('original')
  })
})
