---
name: orchestrated-build-flow
description: Use when you want to take a non-trivial idea all the way from brainstorming through spec, plan, and subagent-driven implementation as one guided pipeline — for features, new tooling, refactors, or multi-file changes you intend to build, not just design. Use instead of invoking brainstorming, writing-plans, and execution separately when you want the whole design-to-shipped flow coordinated end to end.
---

# Orchestrated Build Flow

## Overview

One orchestrator owns the whole superpowers pipeline (prior-art grounding → brainstorm → spec → plan → execute) and inserts three independent Codex convergence checkpoints: spec (`red-team`), plan (`plan-review`), implementation diff (`diff-review`). The sub-skills run unchanged — `superpowers-extended-cc:brainstorming`, `superpowers-extended-cc:writing-plans`, `superpowers-extended-cc:subagent-driven-development` (SDD), `superpowers-extended-cc:finishing-a-development-branch`. This skill owns only the transitions between them and the Codex gates, and overrides two of their routing questions (see the pipeline table).

**Invocation:** a heavyweight coordinator for non-trivial build work — invoke it explicitly, or wire it as your default for build work via your planning preferences (e.g. a CLAUDE.md rule). For design-only or exploratory work, use `superpowers-extended-cc:brainstorming` instead.

Core principle: this skill **cannot prevent** a sub-skill from handing off to the next phase. Skill loading has no call/return stack, so a loaded child's terminal HARD-GATE can still fire — "the user invoked the orchestrator" is a rationale, not an enforcement boundary. So it does not claim prevention. A skip is caught at the next orchestrator check, by a durable receipt the checkpoint wrote. Without receipts, a resuming agent guesses from weak evidence (grep for 'codex', git-log, file mtimes, "re-review everything"); the receipt replaces the guess.

Announce at start: that you are coordinating the full flow and that each checkpoint is receipt-gated.

Never treat an artifact's *presence* as proof its checkpoint ran. Presence cannot distinguish drafted from converged from already-used-downstream. Only a matching receipt proves it.

## The pipeline

One table owns the phase order, the hand-off intercepts, the checkpoint modes and the entry prerequisites. Nothing else restates them.

| Phase | What happens | Entry requires |
| --- | --- | --- |
| **0 Preflight** | Two reachability checks NOW, before brainstorming: (1) the `codex` plugin / Codex CLI is reachable; (2) the required `superpowers-extended-cc` skills are available — `brainstorming`, `writing-plans`, `subagent-driven-development`, `finishing-a-development-branch`. If any is missing, STOP and name it as an unmet prerequisite rather than failing mid-flow. Then initialise or load the state file; if one already exists, reconcile resume-vs-start-over with the user. In superpowers the design *is* the spec (one artifact), so there are exactly three Codex loops. | — |
| **1 Prior art** | Ground the design in what exists. **Lightweight scan** — a few targeted searches across the sources that fit the domain: web posts (WebSearch), existing implementations (GitHub), library docs (Context7), academic literature (the lit-search MCPs, Consensus) where the topic warrants. Synthesise a short **Prior-art brief**: closest prior work, what to borrow, how this should differ. Write it into the spec as a `Prior art` section so it grounds both brainstorming and the spec red-team. Escalate to `deep-research` only when the space is rich or unfamiliar, or the user asks. **Privacy gate:** the scan can send the idea and repo context to external services, so unless the work is clearly public or non-sensitive, confirm before any networked search and always honour an opt-out (skip the external scan, rely on local knowledge). Skippable with a stated reason, never silently. | — |
| **2 Brainstorm** | Invoke brainstorming from the Prior-art brief. Its hand-off to writing-plans is the trigger for checkpoint 1: run that first. | — |
| **3 Checkpoint: spec** | `red-team` convergence loop on the spec. On convergence, present the converged spec for a **single user approval**. This approval replaces routing through brainstorming's own user-review gate — do not also run that gate. Write the spec receipt with `userApproved: true`. | brainstorming reported a spec it considers finished |
| **4 Plan** | Invoke writing-plans. Its execution-method question is the trigger for checkpoint 2: run that first. | valid spec receipt with `userApproved: true` |
| **5 Checkpoint: plan** | `plan-review` convergence loop on the plan, spec supplied as reference for alignment. Write the plan receipt, recording the spec hash supplied to the converged round. | writing-plans reported a plan it considers finished |
| **6 Execute (SDD)** | Pin SDD: skip writing-plans' execution-method question (no parallel-session offer, no manual execution). Worktree handling is inherited from using-git-worktrees / SDD; do not re-invent it. | valid plan receipt |
| **7 Checkpoint: diff** | `diff-review` convergence loop on the change surface, plan supplied as reference for alignment so the receipt's `upstreamHash` records a plan the reviewer actually saw. Supplements SDD's own final reviewer; does not replace it. Write the diff receipt. | SDD reported its tasks complete **and** its final reviewer ran. Without that, re-enter phase 6 rather than reviewing partial work |
| **8 Finish** | `finishing-a-development-branch` for the merge, PR and cleanup decision. Stop before any public publish step — the final click is the user's. | valid diff receipt |

**Execution depth scales to the work.** Phase 6 always runs *through* a subagent. What scales is the review depth on top: a multi-task or non-trivial plan gets SDD's full per-task cycle (implementer → spec reviewer → quality reviewer); a genuinely trivial single-task plan can run one implementer and lean on checkpoint 3. The three Codex checkpoints never scale away.

## Receipt gating

Before entering a phase whose `Entry requires` column names a receipt, read the state file and assert that receipt **and every receipt before it in the pipeline**:

1. it exists, AND
2. its `artifactHash` matches the **current** hash of that artifact, AND
3. `userApproved` is true where the column says so, AND
4. for a downstream receipt, its `upstreamHash` matches the **current** hash of the upstream artifact.

A failed assertion sends you back to run that checkpoint. Assertion 4 is what makes an upstream edit bite: change the spec after the plan was reviewed and the plan receipt stops validating, so checkpoint 2 re-runs. Validating the whole chain is what stops that edit slipping through later — phase 8 names only the diff receipt, and the diff surface does not contain the spec, so a spec edit is invisible there unless the plan receipt is checked too. There is no separate stale flag; invalidity is derived from the hashes, so there is no second representation to keep in sync.

**Before running any checkpoint, establish that its producer phase finished** — the `Entry requires` column says what counts. Receipts record that a review happened, not that the work under review was complete, so a dropped session can leave a half-written artifact that satisfies every gate below it. When you cannot establish completion, re-enter the producer phase instead of reviewing its output.

## Convergence loop

Mechanics (round shape, gates, across-round prompt construction, the re-review block, drift detection) live in the `codex` skill's **Convergence Mode (iterative review)** section. Do not restate them here. This section pins only what the orchestrator adds:

- **Findings ledger.** The orchestrator keeps its own ledger so a resumed session knows what was decided: each finding carries `id`, `title`, `severity` (breakage / simplification — for `plan-review` and `diff-review`, read breakage as correctness or safety, simplification as over-engineering or redundancy) and `status`, one of **`open`**, **`addressed`** (fix made and re-verified) or **`skipped`** (decided not to act, with a recorded reason). Those are the status words the codex skill's re-review block already uses, so they go straight across with no translation. There is no silent "deferred": postponing a finding means `skipped` with a reason the user signed off on. Codex returns prose, so the ledger is yours to build from its output, not something it emits.
- **Apply gate, overriding the dependency's Gate 1.** Where the codex skill asks the user which fixes to apply each round, the orchestrator decides by class instead: a **clear win** (correctness or quality fix, no scope or behaviour change) is applied automatically. Anything that changes scope or behaviour — including a simplification that drops or merges functionality — is a **tradeoff**: pause and surface it to the user as an inline question. Never auto-apply a tradeoff.
- **Convergence, for receipt purposes,** also requires no finding left `open` in the ledger. The verdict and drift conditions are the dependency's.

**Fix routing for checkpoint 3.** A non-trivial finding gets a fresh fix-subagent with a narrow patch brief and required validation, consistent with SDD's "don't fix manually". Only a trivial finding (a one-word doc typo) is applied directly and re-verified; a subagent for a one-liner is ceremony.

## Change surface and hashing

The checkpoint 3 artifact is the whole change surface, not just `git diff <base>...HEAD`. One canonical definition, used for both the review and the hash so a later session recomputes the same value:

- **In a git repo:** one payload, concatenated in this order — `git log <base>..HEAD`, then `git diff <base>` (working tree against the base, so it carries committed, staged and unstaged changes, and represents deletions as diff text rather than as bytes that no longer exist), then for each path `git status --porcelain -uall` reports as untracked, that path followed by its contents, sorted by path. `-uall` matters: plain `--porcelain` collapses an untracked directory into a single entry, so its files would never be enumerated.
- **Outside a repo:** the created or changed files, each path followed by its contents, sorted by path.

**Exclude the run state file and anything else under `docs/superpowers/` from the surface.** The state file is run metadata, it usually sits in the untracked set, and the diff receipt is written into it — so including it would mean every receipt invalidated its own hash the moment it was saved.

Hash is SHA-256 over that payload. Reviewing and hashing the same payload is the point: a surface definition and a hash recipe that disagree hand two sessions two different digests for identical work. Individual artifact hashes (spec, plan) are SHA-256 over the raw file bytes.

## State file

Single JSON for the active run at `docs/superpowers/orchestrator-state.json`. One active run at a time, one receipt per checkpoint. A receipt records the artifact path and hash, the Codex mode, rounds run, the final verdict, the findings ledger, user decisions, `userApproved` where the pipeline table requires it, and on a downstream receipt `upstreamHash` — the hash of the upstream artifact supplied to the round that converged.

```json
{
  "run": "2026-06-02-export-csv",
  "base": "main",
  "checkpoints": {
    "spec": {
      "artifact": "docs/superpowers/specs/2026-06-02-export-csv-design.md",
      "artifactHash": "sha256:9f3a…",
      "mode": "red-team",
      "rounds": 2,
      "verdict": "no redesign-class problem",
      "findings": [
        {"id": "B1", "title": "missing idempotency guard on retry", "severity": "breakage", "status": "addressed"},
        {"id": "S1", "title": "drop the separate audit-log table", "severity": "simplification", "status": "skipped"}
      ],
      "userDecisions": {"S1": "keep — needed for the audit log"},
      "userApproved": true
    },
    "plan": {
      "artifact": "docs/superpowers/plans/2026-06-02-export-csv.md",
      "artifactHash": "sha256:1c70…",
      "upstreamHash": "sha256:9f3a…",
      "mode": "plan-review",
      "rounds": 1,
      "verdict": "READY TO EXECUTE",
      "findings": []
    }
  }
}
```

## Failure & resume

- **Codex unavailable** (429, timeout, auth, CLI missing) → STOP and ask the user before proceeding unreviewed. **No Gemini fallback.** This is why phase 0 preflights reachability, rather than failing three phases in.
- **Superpowers skills missing** → caught at preflight. STOP and name the missing prerequisite.
- **Skipped checkpoint** → caught at the next phase whose entry names its receipt. Go back and run it; if a downstream artifact was already built, its `upstreamHash` stops matching and that checkpoint re-runs too.
- **Resume off the state file, not artifact presence.** Resume at the first phase whose entry assertion fails, then establish that phase's producer finished before running its checkpoint.
- **Fresh invocation finding an existing state file** → ask the user resume-vs-start-over. Do not blindly continue, and do not blindly wipe it.
