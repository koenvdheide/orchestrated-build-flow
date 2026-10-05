export type Checkpoint = 'spec' | 'plan' | 'diff'

// One checkpoint's rounds in this session: the build run they belong to, its review run ids
// in order, and what the latest one was sent.
export type Rounds = {
  build: string
  reviews: string[]
  artifact: string | null
  fingerprint: string
}

declare module 'claude-code' {
  interface PluginState {
    'orchestrated-build-flow': { armed: boolean; rounds: Partial<Record<Checkpoint, Rounds>> }
  }
}
