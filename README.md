# orchestrated-build-flow

A [Claude Code](https://claude.ai/code) plugin that runs a non-trivial build all the way from brainstorming through spec, plan, and subagent-driven implementation as one coordinated pipeline with three Codex review checkpoints.

## What it does

One orchestrator owns the whole [superpowers](https://github.com/pcvelz/superpowers) pipeline (prior-art grounding, brainstorm, spec, plan, execute) and inserts three independent Codex convergence checkpoints: the spec (red-team), the plan (plan-review), and the implementation diff (diff-review).

Each checkpoint writes a receipt through the plugin's mod. Codex reviews exactly the material the receipt hashes, and the receipt is written only once the review has converged and nothing changed since. While the flow runs, a superpowers skill that would hand off past a missing or stale receipt opens with a note to run that checkpoint first. Receipts outlive the session, which is what makes the flow resumable: a dropped session continues at the first checkpoint whose receipt no longer holds.

It uses the superpowers sub-skill files unmodified (brainstorming, writing-plans, subagent-driven-development, finishing-a-development-branch), owning the transitions between them and the Codex gates, and overriding two of their routing questions: brainstorming's user-review gate and writing-plans' execution-method question. The skill documents the mechanics.

## The pipeline

The phases, with what each needs before it starts, are in the skill's [pipeline table](skills/orchestrated-build-flow/SKILL.md#the-pipeline).

## Prerequisites

- Claude Code v2.1.287 or later, with mods on.
- The `third-party-reviewers` plugin, 0.4.0 or later: installed automatically as a dependency from the `agent-tools` marketplace. It runs the [Codex CLI](https://github.com/openai/codex), which must be installed and signed in.
- The `superpowers-extended-cc` skills (brainstorming, writing-plans, subagent-driven-development, finishing-a-development-branch). Install the plugin that provides them, then reload:
  ```text
  /plugin marketplace add pcvelz/superpowers
  /plugin install superpowers-extended-cc@superpowers-extended-cc-marketplace
  /reload-plugins
  ```
  The Phase 0 preflight stops early and names any of these that are missing. Install this specific fork, because the skill uses the `superpowers-extended-cc:` namespace, which the upstream [obra/superpowers](https://github.com/obra/superpowers) (namespace `superpowers:`) does not provide.
- git 2.31 or later.

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
