import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const T = <N extends string>(name: N) => `mcp__orchestrated-build-flow__${name}` as const
export const REVIEW_START = 'mcp__third-party-reviewers__review_start'
export const TOP = 'C:/repo'
export const KEY = 'C:/repo/.git'
export const BASE = 'b'.repeat(40)
export const SPEC = 'C:/repo/docs/superpowers/specs/s.md'
export const PLAN = 'C:/repo/docs/superpowers/plans/p.md'

const DIFF = ['--binary', '--no-textconv', '--no-ext-diff']
// The git argument vectors the mod runs (without `git`), keyed exactly, so one argument
// containing a space and two arguments never answer alike.
const argv = (...args: string[]) => JSON.stringify(args)
export const GIT = {
  top: argv('rev-parse', '--show-toplevel'),
  key: argv('rev-parse', '--path-format=absolute', '--git-common-dir'),
  base: (name: string) => argv('rev-parse', '--verify', '--end-of-options', `${name}^{commit}`),
  head: argv('rev-parse', 'HEAD'),
  log: argv('log', '--format=%H %s', `${BASE}..HEAD`),
  cached: argv('diff', '--cached', ...DIFF, '--ignore-submodules=none', BASE),
  worktree: argv('diff', ...DIFF, '--ignore-submodules=none'),
  untracked: argv('ls-files', '-o', '--exclude-standard', '-z'),
  newFile: (path: string) => argv('diff', '--no-index', ...DIFF, '--', '/dev/null', path),
}

export type GitAnswer = { exitCode?: number; stdout?: string; stderr?: string; truncated?: boolean }

export function world(on: On) {
  const clock = mock.clock(on)
  const state = new Map<string, { value: unknown; version: number }>()
  const store = new Map<string, unknown>()
  const w = {
    clock,
    store,
    cwd: TOP,
    files: new Map<string, string>(),
    // Edit an answer to move the repository: a commit changes `head`, staging `cached`, and so on.
    git: new Map<string, GitAnswer>([
      [GIT.top, { stdout: `${TOP}\n` }],
      [GIT.key, { stdout: `${KEY}\n` }],
      [GIT.base('main'), { stdout: `${BASE}\n` }],
      [GIT.head, { stdout: `${'c'.repeat(40)}\n` }],
      [GIT.log, { stdout: '' }],
      [GIT.cached, { stdout: '' }],
      [GIT.worktree, { stdout: '' }],
      [GIT.untracked, { stdout: '' }],
    ]),
    // review_start calls the mod made, and their run ids r-1, r-2, …
    reviews: [] as Record<string, any>[],
    failStore: false,
    // When set, review_start refuses with this text.
    startDeny: null as string | null,
    // With holdStart, review_start waits here until the test releases it.
    holdStart: false,
    held: [] as (() => void)[],
    runs(): any[] {
      return (state.get('third-party-reviewers/runs')?.value as any[] | undefined) ?? []
    },
    setRuns(runs: any[]) {
      state.set('third-party-reviewers/runs', { value: runs, version: (state.get('third-party-reviewers/runs')?.version ?? 0) + 1 })
    },
  }
  const top = () => (w.git.get(GIT.top)?.stdout ?? '').trim()

  on('session.cwd', () => ({ value: w.cwd }))
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    return w.files.has(path) ? { value: w.files.get(path) as string } : { deny: `ENOENT: ${e.path}` }
  })
  on('process.run', ($, e) => {
    const cmd = JSON.stringify(e.argv.slice(1))
    const fail = (stderr: string) => ({ value: { exitCode: 128, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] !== 'git') return { deny: `not installed: ${e.argv[0]}` }
    // Only the two lookups may run outside the top level; everything else must run there.
    if (cmd !== GIT.top && cmd !== GIT.key && e.init?.cwd !== top()) return fail(`fatal: ran in ${e.init?.cwd}, not the top level`)
    const a = w.git.get(cmd)
    if (!a) return fail(`fatal: unexpected git ${cmd}`)
    return { value: { exitCode: a.exitCode ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '', isStdoutTruncated: a.truncated ?? false, isStderrTruncated: false } }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    if (w.failStore) return { deny: 'EACCES: the store is not writable' }
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('state.get', ($, e: any) => {
    const s = state.get(`${e.plugin}/${e.key}`)
    return { value: { value: s?.value, version: s?.version ?? 0 } }
  })
  on('state.set', ($, e: any) => {
    const k = `${e.plugin}/${e.key}`
    const current = state.get(k)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== current) return { value: { isSet: false, version: current } }
    state.set(k, { value: JSON.parse(JSON.stringify(e.value)), version: current + 1 })
    return { value: { isSet: true, version: current + 1 } }
  })
  on('tool.call', { tool: REVIEW_START }, async ($, e: any) => {
    if (w.startDeny !== null) return { deny: w.startDeny }
    w.reviews.push(e)
    if (w.holdStart) await new Promise<void>(resolve => w.held.push(resolve))
    const id = `r-${w.reviews.length}`
    w.setRuns([...w.runs(), { id, status: 'running', verdict: null, findings: [] }])
    return { result: JSON.stringify({ runId: id }) }
  })
  on('tool.register', ($, e) => ({ value: { tool: T(e.name) } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  return w
}

export type World = ReturnType<typeof world>

let calls = 0
export const call = ($: any, name: string, args: Record<string, unknown> = {}) =>
  $.tool.call({ tool: T(name), tool_use_id: `tu${(calls += 1)}`, ...args })

export const resultOf = async ($: any, name: string, args: Record<string, unknown> = {}) => JSON.parse((await call($, name, args)).result)

export async function boot($: any, w: World) {
  await $.session.start({ cwd: TOP, surface: null, isInteractive: true })
  await w.clock.settle()
}

export const finding = (id: string, o: Record<string, unknown> = {}) => ({
  id, severity: 'breakage', title: 't', claim: 'c', file: null, line: null, symbol: null, citation: 'no-location', status: 'applied', evidence: 'e', overrule: null, ...o,
})

// Ends review `id` the way third-party-reviewers would.
export function finish(w: World, id: string, verdict: string, findings: unknown[] = [], status = 'complete') {
  w.setRuns(w.runs().map(r => (r.id === id ? { ...r, status, verdict, findings } : r)))
}

// One READY round and its receipt for `checkpoint`.
export async function converge($: any, w: World, checkpoint: 'spec' | 'plan' | 'diff') {
  const artifact = checkpoint === 'spec' ? SPEC : checkpoint === 'plan' ? PLAN : undefined
  const { runId } = await resultOf($, 'build_review', { checkpoint, artifact, question: 'Q', instructions: 'I' })
  finish(w, runId, 'READY')
  return call($, 'build_receipt', { checkpoint, ...(checkpoint === 'spec' ? { userApproved: true } : {}) })
}

// A world with a started run and both documents on disk.
export async function started($: any, on: On) {
  const w = world(on)
  w.files.set(SPEC, 'spec v1')
  w.files.set(PLAN, 'plan v1')
  await boot($, w)
  await call($, 'build_start', { base: 'main' })
  return w
}
