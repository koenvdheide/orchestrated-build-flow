# orchestrated-build-flow

A [Claude Code](https://claude.ai/code) plugin that runs a non-trivial build all the way from brainstorming through spec, plan, and subagent-driven implementation as one coordinated pipeline with three Codex review checkpoints.

## What it does

One orchestrator owns the whole [superpowers](https://github.com/pcvelz/superpowers) pipeline (prior-art grounding, brainstorm, spec, plan, execute) and inserts three independent Codex convergence checkpoints: the spec (red-team), the plan (plan-review), and the implementation diff (diff-review).

Each checkpoint writes a durable receipt into a run state file in the repository, and every phase transition is gated on the prior checkpoint's receipt, so the orchestrator catches a skipped or stale review and re-runs it. That also makes the flow resumable. If a session drops mid-build, it continues at the first phase whose receipt is missing or stale.

It runs the superpowers sub-skills unchanged (brainstorming, writing-plans, subagent-driven-development, finishing-a-development-branch) and owns only the transitions between them and the Codex gates.

## The pipeline

- 0 Preflight: check Codex and the required superpowers skills are reachable; load or start the run state.
- 1 Prior art: a lightweight scan (web, GitHub, docs, and literature where it fits) to ground the design, after confirming any networked search with you.
- 2 Brainstorm: the brainstorming skill, starting from the prior-art brief. Its design document is the spec.
- 3 Checkpoint (spec): Codex red-team to convergence, then one user approval.
- 4 Plan: the writing-plans skill.
- 5 Checkpoint (plan): Codex plan-review to convergence.
- 6 Execute: subagent-driven implementation.
- 7 Checkpoint (diff): Codex diff-review over the full change surface.
- 8 Finish: the merge, PR, and cleanup decision (stops before opening or commenting on any PR).

## Prerequisites

- Claude Code.
- The `codex` plugin: installed automatically as a dependency from the `agent-tools` marketplace. It wraps the [Codex CLI](https://github.com/openai/codex), which must be installed and on PATH.
- The `superpowers-extended-cc` skills (brainstorming, writing-plans, subagent-driven-development, finishing-a-development-branch). Install the plugin that provides them, then reload:
  ```text
  /plugin marketplace add pcvelz/superpowers
  /plugin install superpowers-extended-cc@superpowers-extended-cc-marketplace
  /reload-plugins
  ```
  The Phase 0 preflight stops early and names any of these that are missing. Install this specific fork, because the skill uses the `superpowers-extended-cc:` namespace, which the upstream [obra/superpowers](https://github.com/obra/superpowers) (namespace `superpowers:`) does not provide.
- git and bash (Git Bash on Windows).

## Installation

Via the `agent-tools` marketplace:

```text
/plugin marketplace add koenvdheide/agent-tools
/plugin install orchestrated-build-flow@agent-tools
/reload-plugins
```

Refresh later with `/plugin marketplace update agent-tools`, then `/plugin update orchestrated-build-flow@agent-tools` and `/reload-plugins`.

## Usage

Claude invokes the skill when a build task matches, or you can invoke it directly:

```text
/orchestrated-build-flow:orchestrated-build-flow add CSV export to the reports module
```

For design-only or exploratory work you are not committing to build, use the brainstorming skill on its own.

## License

MIT
