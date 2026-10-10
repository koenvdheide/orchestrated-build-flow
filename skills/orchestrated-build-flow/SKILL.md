---
name: orchestrated-build-flow
description: Use when you want to take a non-trivial idea all the way from brainstorming through spec, plan, and subagent-driven implementation as one guided pipeline — for features, new tooling, refactors, or multi-file changes you intend to build, not just design. Use instead of invoking brainstorming, writing-plans, and execution separately when you want the whole design-to-shipped flow coordinated end to end.
---

# Orchestrated Build Flow

## Overview

One orchestrator owns the whole superpowers pipeline (prior-art grounding → brainstorm → spec → plan → execute) and inserts three independent Codex convergence checkpoints: spec (`red-team`), plan (`plan-review`), implementation diff (`diff-review`). The sub-skills run unchanged — `superpowers-extended-cc:brainstorming`, `superpowers-extended-cc:writing-plans`, `superpowers-extended-cc:subagent-driven-development` (SDD), `superpowers-extended-cc:finishing-a-development-branch`. This skill owns only the transitions between them and the Codex gates, and overrides two of their routing questions (see the pipeline table).

**Invocation:** a heavyweight coordinator for non-trivial build work — invoke it explicitly, or wire it as your default for build work via your planning preferences (e.g. a CLAUDE.md rule). For design-only or exploratory work, use `superpowers-extended-cc:brainstorming` instead.

This plugin's tools keep the checkpoints in code. `build_review` runs each round of a checkpoint's review and sends Codex exactly the material the receipt will certify; `build_receipt` writes the receipt once the rounds have converged and nothing changed since the last was sent; `build_status` reports each receipt as valid, stale, missing or unverifiable. While this skill is loaded, a sub-skill that would hand off past a checkpoint whose receipt does not hold opens with a stop note naming that checkpoint. Run the checkpoint; go past the note only when the user has explicitly chosen to skip it.

Announce at start: that you are coordinating the full flow and that each checkpoint is receipt-gated.

Never treat an artifact's *presence* as proof its checkpoint ran. Only a valid receipt proves it.

## The pipeline

One table owns the phase order, the hand-off intercepts, the checkpoint modes and the entry prerequisites. Nothing else restates them.

| Phase | What happens | Entry requires |
| --- | --- | --- |
| **0 Preflight** | Reachability NOW, before brainstorming: (1) `build_start`, `build_review`, `build_receipt` and `build_status` are available (they come with this plugin's mod; missing means mods are off or Claude Code is older than v2.1.287), and third-party-reviewers' `review_start` accepts `codex`; (2) the required `superpowers-extended-cc` skills are available — `brainstorming`, `writing-plans`, `subagent-driven-development`, `finishing-a-development-branch`. If any is missing, STOP and name it as an unmet prerequisite rather than failing mid-flow. Then call `build_status`: if this repository has a run, reconcile resume-vs-start-over with the user; for a new run or a start-over, call `build_start` with the base branch. In superpowers the design *is* the spec (one artifact), so there are exactly three Codex loops. | — |
| **1 Prior art** | Ground the design in what exists. **Lightweight scan** — a few targeted searches across the sources that fit the domain: web posts (WebSearch), existing implementations (GitHub), library docs (Context7), academic literature (the lit-search MCPs, Consensus) where the topic warrants. Synthesise a short **Prior-art brief**: closest prior work, what to borrow, how this should differ. Write it into the spec as a `Prior art` section so it grounds both brainstorming and the spec red-team. Escalate to `deep-research` only when the space is rich or unfamiliar, or the user asks. **Privacy gate:** the scan can send the idea and repo context to external services, so unless the work is clearly public or non-sensitive, confirm before any networked search and always honour an opt-out (skip the external scan, rely on local knowledge). Skippable with a stated reason, never silently. | — |
| **2 Brainstorm** | Invoke brainstorming from the Prior-art brief. Its hand-off to writing-plans is the trigger for checkpoint 1: run that first. | — |
| **3 Checkpoint 1: spec** | Convergence loop with `build_review` checkpoint `spec`, artifact the spec. On convergence, present the converged spec for a **single user approval**. This approval replaces routing through brainstorming's own user-review gate — do not also run that gate. Then `build_receipt` with `userApproved: true`. | brainstorming reported a spec it considers finished |
| **4 Plan** | Invoke writing-plans. Its execution-method question is the trigger for checkpoint 2: run that first. | `build_status`: spec receipt valid |
| **5 Checkpoint 2: plan** | Convergence loop with `build_review` checkpoint `plan`, artifact the plan; the spec goes with it. Then `build_receipt`. | writing-plans reported a plan it considers finished |
| **6 Execute (SDD)** | Pin SDD: skip writing-plans' execution-method question (no parallel-session offer, no manual execution). Worktree handling is inherited from using-git-worktrees / SDD; do not re-invent it. | `build_status`: plan receipt valid |
| **7 Checkpoint 3: diff** | Convergence loop with `build_review` checkpoint `diff`: the tool collects the change surface (commits since the base, staged and unstaged changes, untracked files) in the current checkout, with the plan. Supplements SDD's own final reviewer; does not replace it. Then `build_receipt`. | SDD reported its tasks complete **and** its final reviewer ran. Without that, re-enter phase 6 rather than reviewing partial work |
| **8 Finish** | `finishing-a-development-branch` for the merge, PR and cleanup decision. Stop before any public publish step — the final click is the user's. | `build_status`: diff receipt valid |

**Execution depth scales to the work.** Phase 6 always runs *through* a subagent. What scales is the review depth on top: a multi-task or non-trivial plan gets SDD's full per-task cycle (implementer → spec reviewer → quality reviewer); a genuinely trivial single-task plan can run one implementer and lean on checkpoint 3. The three Codex checkpoints never scale away.

## Checkpoints

- Each checkpoint is a convergence loop the user asked for: run it as the `third-party-reviewers:codex` skill's **Convergence Mode** describes, starting every round with `build_review` instead of `review_start`, with the same question and instructions (the `Previously identified findings:` block from round 2 on). `build_review` sets the mode, sends the material and asks for a verdict that begins `READY` or `NOT READY`.
- Record every finding with `review_record` as that skill says. The receipt snapshots what you recorded, so there is no separate ledger.
- When a round comes back READY with nothing open, call `build_receipt`. A refusal names what is missing — an open finding, an overrule not yet acted on, a change since the last round was sent, an upstream receipt that no longer holds. Fix it and run another round, or call it again.
- **Before running any checkpoint, establish that its producer phase finished** — the `Entry requires` column says what counts. A receipt records that a review happened, not that the work under review was complete, so a dropped session can leave a half-written artifact. When you cannot establish completion, re-enter the producer phase instead of reviewing its output.
- **Fix routing for checkpoint 3.** A non-trivial finding gets a fresh fix-subagent with a narrow patch brief and required validation, consistent with SDD's "don't fix manually". Only a trivial finding (a one-word doc typo) is applied directly and re-verified; a subagent for a one-liner is ceremony.
- Work from inside the build's repository: the tools and the gate use the git checkout of the session's current directory; `build_status` and the stop note name the checkout they checked.

## Failure & resume

- **Codex unavailable** (`build_review` refused by `review_start`, or a round that comes back `failed`: 429, timeout, auth) → STOP and ask the user before proceeding unreviewed. **No Gemini fallback.** This is why phase 0 preflights reachability, rather than failing three phases in.
- **Superpowers skills missing** → caught at preflight. STOP and name the missing prerequisite.
- **Skipped checkpoint** → the gate's stop note, or `build_status`, names it. Go back and run it.
- **Resume off `build_status`, not artifact presence.** Resume at the first receipt that is not valid, then establish that phase's producer finished before running its checkpoint. Receipts outlive the session, and rounds outlive quitting and resuming the same conversation; after a /clear, in a new or forked conversation, or once its rounds were pruned, a checkpoint left mid-loop starts its loop again.
- **Fresh invocation finding an existing run** → ask the user resume-vs-start-over. Do not blindly continue, and do not blindly start over; `build_start` is the start-over.
