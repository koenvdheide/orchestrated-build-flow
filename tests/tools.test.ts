import { describe, expect, test } from 'claude-code/testing'

import { BASE, GIT, KEY, TOP, boot, call, resultOf, world } from './world'

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
