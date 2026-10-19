---
name: orchestrated-build-flow
description: Use when you want to take a non-trivial idea all the way from brainstorming through spec, plan, and subagent-driven implementation as one guided pipeline — for features, new tooling, refactors, or multi-file changes you intend to build, not just design. Use instead of invoking brainstorming, writing-plans, and execution separately when you want the whole design-to-shipped flow coordinated end to end.
---

# Orchestrated Build Flow

## Overview

This skill owns the transitions between unchanged superpowers sub-skills and three Codex convergence checkpoints: spec (`red-team`), plan (`plan-review`) and implementation diff (`diff-review`). It overrides two of the sub-skills' routing questions (see the pipeline table).

Invoke explicitly or configure as your default for non-trivial build work (e.g. in CLAUDE.md). For design-only or exploratory work, use `superpowers-extended-cc:brainstorming`.

A gated sub-skill opens with a stop note when its prerequisite receipt is not valid. Run that checkpoint before continuing unless the user explicitly skips it.

Announce at start: that you are coordinating the full flow and that each checkpoint is receipt-gated.

Never treat an artifact's *presence* as proof its checkpoint ran. Only a valid receipt proves it.

## The pipeline

| Phase | What happens | Entry requires |
| --- | --- | --- |
| **0 Preflight** | Before brainstorming, verify that `build_start`, `build_review`, `build_receipt` and `build_status` are available (they come with this plugin's mod, which needs the plugin enabled, mods on and Claude Code v2.1.287 or later), third-party-reviewers' `review_start` accepts `codex`, and `superpowers-extended-cc` provides `brainstorming`, `writing-plans`, `subagent-driven-development` (SDD) and `finishing-a-development-branch`. STOP and name any missing prerequisite. Call `build_status`; if a run exists, ask the user resume-vs-start-over. For a new run or start-over, call `build_start` with the base branch. The design is the spec: there are three Codex loops. | — |
| **1 Prior art** | Scan relevant prior art with a few targeted searches: web posts (WebSearch), implementations (GitHub), library docs (Context7), and academic literature (lit-search MCPs, Consensus) where warranted. Summarise closest prior work, what to borrow and how this should differ in a short **Prior-art brief**; use it for brainstorming and include it as the spec's `Prior art` section for red-team review. Use `deep-research` only for a rich or unfamiliar space or at the user's request. **Privacy gate:** networked searches can disclose the idea and repository context: unless work is clearly public or non-sensitive, confirm before any networked search. Honour opt-outs by skipping external searches and relying on local knowledge. State a reason whenever skipping the scan. | — |
| **2 Brainstorm** | Invoke brainstorming from the Prior-art brief. Its hand-off to writing-plans is the trigger for checkpoint 1: run that first. | — |
| **3 Checkpoint 1: spec** | Convergence loop with `build_review` checkpoint `spec`, artifact the spec. On convergence, present the converged spec for a **single user approval**. This approval replaces routing through brainstorming's own user-review gate — do not also run that gate. Then `build_receipt` with `userApproved: true`. | brainstorming reported a spec it considers finished |
| **4 Plan** | Invoke writing-plans. Its execution-method question is the trigger for checkpoint 2: run that first. | `build_status`: spec receipt valid |
| **5 Checkpoint 2: plan** | Convergence loop with `build_review` checkpoint `plan`, artifact the plan; the spec goes with it. Then `build_receipt`. | writing-plans reported a plan it considers finished |
| **6 Execute (SDD)** | Pin SDD: skip writing-plans' execution-method question (no parallel-session offer, no manual execution). Worktree handling is inherited from using-git-worktrees / SDD; do not re-invent it. | `build_status`: plan receipt valid |
| **7 Checkpoint 3: diff** | Convergence loop with `build_review` checkpoint `diff`: the tool collects the change surface (commits since the base, staged and unstaged changes, untracked files) in the current checkout, with the plan. Supplements SDD's own final reviewer; does not replace it. Then `build_receipt`. | SDD reported its tasks complete **and** its final reviewer ran. Without that, re-enter phase 6 rather than reviewing partial work |
| **8 Finish** | `finishing-a-development-branch` for the merge, PR and cleanup decision. Stop before any public publish step — the final click is the user's. | `build_status`: diff receipt valid |

Phase 6 always uses a subagent. Multi-task or non-trivial plans use SDD's full per-task cycle (implementer → spec reviewer → quality reviewer). A genuinely trivial single-task plan may use one implementer and checkpoint 3. The three Codex checkpoints never scale away.

## Checkpoints

- Each checkpoint is a convergence loop the user asked for. Follow third-party-reviewers' review guide, including Convergence and its rule that subagents or teammates hand pending runs back to the main conversation. Start every round with `build_review` instead of `review_start`, retaining the same question and instructions and including `Previously identified findings:` from round 2. Read completed reviews with `review_results` as the guide directs.
- Record every finding with `review_record` as that guide directs; no separate ledger is needed.
- When a round returns READY with no open findings, call `build_receipt`. If refused, address the named cause and retry or run another round.
- Before each checkpoint, verify its producer met the table's entry requirement; otherwise re-enter the producer phase. A receipt proves review, not producer completion: a dropped session can leave a half-written artifact.
- For checkpoint 3, route non-trivial findings to a fresh fix-subagent with a narrow patch brief and required validation, following SDD. Apply and re-verify only trivial fixes directly (e.g. a one-word doc typo).
- Work from inside the build's repository: the tools and the gate use the git checkout of the session's current directory; `build_status` and the stop note name the checkout they checked.

## Failure & resume

- **Codex unavailable** (`build_review` refused by `review_start`, or a round that comes back `failed`: 429, timeout, auth) → STOP and ask the user before proceeding unreviewed. **No Gemini fallback.**
- Resume at the first receipt `build_status` reports non-valid, after verifying producer completion. Receipts persist across sessions. Rounds survive quitting and resuming the same conversation; after /clear, a new or forked conversation, or round pruning, restart any unfinished checkpoint loop.
