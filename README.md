# orchestrated-build-flow

A [Claude Code](https://claude.ai/code) plugin that runs a non-trivial build all the way from brainstorming through spec, plan, and subagent-driven implementation as one coordinated pipeline with three Codex review checkpoints.

## What it does

One orchestrator owns the whole [superpowers](https://github.com/pcvelz/superpowers) pipeline (prior-art grounding, brainstorm, spec, plan, execute) and inserts three independent Codex convergence checkpoints: the spec (red-team), the plan (plan-review), and the implementation diff (diff-review).

Each checkpoint writes a durable receipt into a run state file. A phase that depends on an earlier checkpoint asserts its receipt before starting, so a skipped review is caught at that next check and re-run. It cannot stop a sub-skill handing off early, since skill loading has no call/return stack; it makes the skip self-correcting instead. That is also what makes the flow resumable: a dropped session continues at the first phase whose assertion fails.

It uses the superpowers sub-skill files unmodified (brainstorming, writing-plans, subagent-driven-development, finishing-a-development-branch), owning the transitions between them and the Codex gates, and overriding two of their routing questions: brainstorming's user-review gate and writing-plans' execution-method question. The skill documents the mechanics.

## The pipeline

- 0 Preflight: check Codex and the required superpowers skills are reachable; load or start the run state.
- 1 Prior art: a lightweight scan (web, GitHub, docs, and literature where it fits) to ground the design. Unless the work is clearly public or non-sensitive, it confirms before searching and honours an opt-out.
- 2 Brainstorm: the brainstorming skill, starting from the prior-art brief. Its design document is the spec.
- 3 Checkpoint (spec): Codex red-team to convergence, then one user approval.
- 4 Plan: the writing-plans skill.
- 5 Checkpoint (plan): Codex plan-review to convergence.
- 6 Execute: subagent-driven implementation.
- 7 Checkpoint (diff): Codex diff-review over the full change surface.
- 8 Finish: the merge, PR, and cleanup decision (stops before opening or commenting on any PR).

## Prerequisites

- Claude Code v2.1.287 or later, with mods on.
- The `third-party-reviewers` plugin: installed automatically as a dependency from the `agent-tools` marketplace. It runs the [Codex CLI](https://github.com/openai/codex), which must be installed and signed in. Up to 1.1.0 this plugin depended on `codex`; once you have updated, you can uninstall that.
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
/orchestrated-build-flow add CSV export to the reports module
```

For design-only or exploratory work you are not committing to build, use the brainstorming skill on its own.

## License

MIT
