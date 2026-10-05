import { describe, expect, test } from 'claude-code/testing'

import { convergenceRefusal, describe as said, drift, section, sha256, snapshot, stopNote } from '../hooks/receipts'
import type { ReviewerFinding, ReviewerRun } from '../hooks/receipts'

const f = (id: string, o: Partial<ReviewerFinding> = {}): ReviewerFinding => ({ id, file: null, status: 'applied', overrule: null, ...o })
const run = (id: string, o: Partial<ReviewerRun> = {}): ReviewerRun => ({ id, status: 'complete', verdict: 'READY', findings: [], ...o })

describe('hashing and framing', () => {
  test('sha256 is the standard digest', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  test('section frames a body under its label', () => {
    expect(section('a.md', 'x')).toBe('=== a.md ===\nx\n')
  })
})

describe('convergenceRefusal', () => {
  test('converged rounds pass, and an earlier failed round does not block', () => {
    expect(convergenceRefusal([run('r1', { status: 'failed', verdict: null }), run('r2', { findings: [f('r2.1')] })], ['r1', 'r2'])).toBe(null)
  })
  test('each reason', () => {
    expect(convergenceRefusal([], ['r1'])).toBe('review r1 is not in this session')
    expect(convergenceRefusal([], [])).toBe('this checkpoint has no rounds in this session')
    expect(convergenceRefusal([run('r1', { status: 'running' }), run('r2')], ['r1', 'r2'])).toBe('review r1 is still running')
    expect(convergenceRefusal([run('r1', { status: 'failed' })], ['r1'])).toBe('the last review, r1, failed; start another round')
    expect(convergenceRefusal([run('r1', { status: 'cancelled' })], ['r1'])).toBe('the last review, r1, was cancelled; start another round')
    expect(convergenceRefusal([run('r1', { verdict: 'NOT READY: x' })], ['r1'])).toBe("the last review's verdict does not begin with READY: NOT READY: x")
    expect(convergenceRefusal([run('r1', { findings: [f('r1.1', { status: 'unresolved' })] })], ['r1'])).toBe('finding r1.1 is unresolved')
    expect(convergenceRefusal([run('r1', { findings: [f('r1.1', { status: 'rejected', overrule: 'apply' })] })], ['r1'])).toBe('the user asked for finding r1.1 to be applied; record it applied once the fix is made')
    expect(convergenceRefusal([run('r1', { findings: [f('r1.1', { status: 'applied', overrule: 'reject' })] })], ['r1'])).toBe('the user rejected finding r1.1; undo any fix and record it rejected')
    expect(convergenceRefusal([run('r1', { findings: [f('r1.1', { file: 'a.ts' })] })], ['r1'])).toBe('finding r1.1 cites a relative path; update third-party-reviewers to 0.3.1 or later')
  })
  test('findings of an earlier complete round still count', () => {
    expect(convergenceRefusal([run('r1', { findings: [f('r1.1', { status: 'unresolved' })] }), run('r2')], ['r1', 'r2'])).toBe('finding r1.1 is unresolved')
  })
  test('findings of runs outside the checkpoint rounds do not count', () => {
    expect(convergenceRefusal([run('r1', { findings: [f('r1.1', { status: 'unresolved' })] }), run('r2')], ['r2'])).toBe(null)
  })
})

describe('snapshot and drift', () => {
  test('snapshot takes the findings of complete rounds only', () => {
    expect(snapshot([run('r1', { status: 'failed', findings: [f('r1.1')] }), run('r2', { findings: [f('r2.1')] })]).map(x => x.id)).toEqual(['r2.1'])
  })
  test('drift names a changed finding and ignores ones no longer in the session', () => {
    expect(drift([f('r1.1')], [run('r1', { findings: [f('r1.1')] })])).toBe(null)
    expect(drift([f('r1.1')], [run('r1', { findings: [f('r1.1', { overrule: 'reject' })] })])).toBe('finding r1.1 changed since the receipt was written')
    expect(drift([f('r1.1')], [run('r1', { findings: [f('r1.1', { status: 'rejected' })] })])).toBe('finding r1.1 changed since the receipt was written')
    expect(drift([f('r1.1')], [])).toBe(null)
  })
})

describe('notes', () => {
  test('describe and stopNote', () => {
    expect(said({ state: 'missing' })).toBe('missing')
    expect(said({ state: 'stale', reason: 'x' })).toBe('stale: x')
    expect(stopNote('plan', { state: 'missing' }, 'C:/repo')).toBe(
      'orchestrated-build-flow: the plan receipt is missing (checked in C:/repo). Run checkpoint 2 (plan-review) first, and do not follow the skill below until build_status shows it valid, unless the user has explicitly chosen to skip that checkpoint.',
    )
  })
})
