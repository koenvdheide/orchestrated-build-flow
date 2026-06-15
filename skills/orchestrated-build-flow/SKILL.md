---
name: orchestrated-build-flow
description: Use when you want to take a non-trivial idea all the way from brainstorming through spec, plan, and subagent-driven implementation as one guided pipeline — for features, new tooling, refactors, or multi-file changes you intend to build, not just design. Use instead of invoking brainstorming, writing-plans, and execution separately when you want the whole design-to-shipped flow coordinated end to end.
---

# Orchestrated Build Flow

## Overview

One orchestrator owns the whole superpowers pipeline (prior-art grounding → brainstorm → spec → plan → execute) and inserts three independent Codex convergence checkpoints: spec (`red-team`), plan (`plan-review`), implementation diff (`diff-review`). The sub-skills run unchanged — `superpowers-extended-cc:brainstorming`, `superpowers-extended-cc:writing-plans`, `superpowers-extended-cc:subagent-driven-development` (SDD), `superpowers-extended-cc:finishing-a-development-branch`. This skill owns only the transitions between them and the Codex gates.

**Invocation:** a heavyweight coordinator for non-trivial build work — invoke it explicitly, or wire it as your default for build work via your planning preferences (e.g. a CLAUDE.md rule). For design-only or exploratory work, use `superpowers-extended-cc:brainstorming` instead.

Core principle: this skill **cannot prevent** a sub-skill from handing off to the next phase. Skill loading has no call/return stack, so a loaded child's terminal HARD-GATE can still fire — "the user invoked the orchestrator" is a rationale, not an enforcement boundary. So it does not claim prevention. It makes skips **self-correcting** via durable checkpoint receipts plus receipt-gated phase entry. Without receipts, agents guess from weak evidence (grep for 'codex', git-log, file mtimes, "re-review everything") — the receipt is what makes resume and skip-recovery deterministic instead of guesswork.

Announce at start: that you are coordinating the full flow and that each checkpoint is receipt-gated.

## Ownership mechanism (load-bearing)

Two layers. State both authoritatively — this is the part agents do NOT invent.

**(a) Intercept at hand-off (proactive).** Each sub-skill's hand-off attempt IS the trigger to run the pending checkpoint FIRST, before the next sub-skill starts.

| Sub-skill reaches | Intercept and run |
| --- | --- |
| brainstorming → "invoke writing-plans" | checkpoint 1 (spec) |
| writing-plans → execution-method question | checkpoint 2 (plan) |
| SDD finishes tasks + its own final reviewer | checkpoint 3 (diff) |

**(b) Receipt-gated phase entry (backstop).** Before entering ANY phase, read the state file and assert the prior checkpoint's receipt:

1. exists, AND
2. its recorded `artifactHash` matches the **current** hash of that artifact, AND
3. `userApproved` is true where the phase requires it (spec approval), AND
4. `stale` is false, AND
5. for a downstream receipt, its `upstreamHash` still matches the **current** hash of the upstream artifact it was built from.

If any assertion fails → go back and run the missing/stale checkpoint first. (Assertions 4–5 are what make downstream-stale invalidation actually bite — see State file.) This catches a skip even if layer (a) was bypassed. It is **detect-and-repair, not prevention** — downstream state may already exist, in which case the stale flag (see State file) forces the re-run.

Never treat an artifact's *presence* as proof its checkpoint ran. Presence cannot distinguish drafted / converged / already-used-downstream. Only a matching receipt proves it.

## Phase flow

Happy path runs phases 0 → 8 in order. Every forward transition is gated by the prior checkpoint's receipt (see Ownership mechanism); a failed gate runs the pending checkpoint before proceeding. A stale-*upstream* receipt is the one case that may require regenerating the downstream artifact, not just re-reviewing it.

| Phase | What happens |
| --- | --- |
| **0 Preflight** | Two reachability checks NOW, before brainstorming (fail early, not at the first checkpoint — see Failure & resume): (1) the `codex` plugin / Codex CLI is reachable; (2) the required `superpowers-extended-cc` skills are available — `brainstorming`, `writing-plans`, `subagent-driven-development`, `finishing-a-development-branch`. If any is missing, STOP and name it as an unmet prerequisite (see the plugin README) rather than failing mid-flow. Then initialise or load the state file; if one already exists, reconcile resume-vs-start-over with the user. Note: in superpowers the design *is* the spec (one artifact), so there are exactly three Codex loops total. |
| **1 Prior art** | Before any design, ground it in what already exists. **Lightweight scan** — a few targeted searches across the sources that fit the domain: web posts/blogs (WebSearch), existing implementations (GitHub), library/framework docs (Context7), and academic literature (the lit-search MCPs, Consensus) where the topic warrants. Synthesize a short **Prior-art brief**: closest prior work, what to borrow, how this should differ. Write it into the spec as a `Prior art` section so it grounds both brainstorming and the spec red-team (Codex can then flag reinventing a known approach against real references). Escalate to the `deep-research` skill only when the space is rich/unfamiliar or the user asks. **Privacy gate.** The scan can send the idea and repo context to external services (WebSearch, GitHub, Context7, the lit MCPs). Unless the work is clearly public/non-sensitive, confirm with the user before any networked search, and always honour a privacy opt-out (skip the external scan, rely on local knowledge). Skippable with a stated reason (a space you know cold, nothing relevant, or a privacy opt-out) — never skip silently. |
| **2 Brainstorm** | Invoke brainstorming, starting from the Prior-art brief. At its hand-off to writing-plans, intercept → checkpoint 1. |
| **3 Checkpoint: spec** | `red-team` convergence loop on the spec (which now carries the `Prior art` section). On convergence, the orchestrator presents the converged spec for a **single user approval**. This approval REPLACES routing through brainstorming's internal user-review gate — do not also run that gate (it is a second auto-hand-off point). Write the spec receipt with `userApproved: true`. |
| **4 Plan** | Invoke writing-plans. At its execution-method question, intercept → checkpoint 2. |
| **5 Checkpoint: plan** | `plan-review` convergence loop on the plan, spec passed as reference. Write the plan receipt. |
| **6 Execute (SDD)** | Pin SDD — skip writing-plans' execution-method question (no parallel-session offer, no manual execution). Worktree handling is inherited from using-git-worktrees / SDD; do not re-invent it. |
| **7 Checkpoint: diff** | After SDD's tasks + its own final reviewer, run a `diff-review` convergence loop on the full change surface. Write the diff receipt. |
| **8 Finish** | `finishing-a-development-branch` for the merge/PR/cleanup decision. Stop before any public publish step — the final click is the user's. |

**Execution depth scales to the work.** Phase 6 always runs *through* a subagent (never manual execution, never the parallel-session offer). What scales is the review depth layered on top: a multi-task or non-trivial plan gets SDD's full per-task cycle (implementer → spec reviewer → quality reviewer); a genuinely trivial single-task plan can run one implementer and lean on checkpoint 3 as its review. The three Codex checkpoints never scale away — they always run.

## Convergence loop

Mechanics (round shape, gates, across-round prompt construction, drift anti-pattern) live in the `codex` skill's **Convergence Mode (iterative review)** section. Do not restate them here. This section pins the orchestrator-specific rules that override or sharpen the defaults:

- **Structured findings.** Convergence is judged off a checklist, not prose — prose parsing silently misses unresolved issues. Each finding carries `id`; `title` (a short summary, needed by the re-review block); `severity` (breakage / simplification — for `plan-review` and `diff-review` findings, read breakage = correctness/safety, simplification = over-engineering/redundancy); and `status`, one of: **`open`** (unresolved), **`applied`** (fix made and re-verified), **`rejected`** (decided not to act, with a recorded reason). There is NO silent "deferred" state — postponing a finding means `rejected` with a reason the user signed off on, so nothing drops out of the gate unnoticed. When you build the re-review block for Codex, map `applied` → addressed and `rejected` → skipped (the vocabulary the codex skill's Convergence Mode uses).
- **Apply gate.** A **clear win** (correctness or quality fix, no scope or behaviour change) is applied automatically. Anything that changes scope or behaviour — including a simplification that drops or merges functionality — is a **tradeoff**: pause and surface it to the user as an inline question. Do not auto-apply tradeoffs.
- **Re-review** carries a "previously identified findings" block (id, title, status) so Codex has drift-detection context and does not re-find addressed issues.
- **Convergence =** the mode's affirmative verdict (`red-team`: "no redesign-class problem" / "approve"; `plan-review`: "READY TO EXECUTE" / "approve" / "ready"; `diff-review`: "no regressions" / "approve") AND no findings left **open** (i.e. every finding is `applied` or `rejected`). Also terminates on user stop or the round cap.
- **Round cap = max 3 rounds per artifact.** Reaching the cap means **STOP as unresolved** — hand the open findings to the user. NEVER silently continue past the cap.
- **Drift =** a fix introduces *new* findings, or a new round's findings target prior-round fixes. Track the finding IDs and the artifact hash to detect it.
- Re-state the original one-sentence brief at every continue-gate. Weight Simplifications **at least as heavily as** Breakage (the default bias is toward addition; correct for it).

## Per-checkpoint specifics

| Ckpt | Mode | Artifact | Notes |
| --- | --- | --- | --- |
| 1 | `red-team` | the spec file | Breakage + Simplifications. Converged spec gets the single orchestrator-owned user approval. |
| 2 | `plan-review` | the plan file | Spec passed as reference for alignment. |
| 3 | `diff-review` | the **full change surface** | See below. Supplements SDD's own final reviewer — does not replace it. |

**Checkpoint 3 change surface.** Review the whole surface, not just `git diff <base>...HEAD`: `git status`, the staged diff, the unstaged diff, untracked files, and `git log <base>..HEAD`. If the work is not in a git repo, the surface is the set of created/changed files. The diff receipt's `artifactHash` is a **composite surface hash** over that whole set (base ref + `git log <base>..HEAD` + `git status --porcelain` + staged diff + unstaged diff + untracked file contents; or, with no git, the created/changed file contents), so resume can tell whether the reviewed surface still matches the worktree. Fix routing:

- **Non-trivial finding** → dispatch a fresh fix-subagent with a narrow patch brief + required validation (consistent with SDD's "don't fix manually"). Do NOT patch non-trivial findings by hand.
- **Trivial finding** (e.g. a one-word doc typo) → apply directly and re-verify. A subagent for a one-liner is ceremony.

## State file

Single JSON for the active run at `docs/superpowers/orchestrator-state.json`. One active run at a time. One receipt per checkpoint. Each receipt records: artifact path, artifact hash, Codex mode, rounds run, final verdict, the findings checklist (id / title / severity / status), user decisions, `userApproved` where applicable, `stale` (the downstream-invalidation flag), and — on downstream receipts — `upstreamHash` (the upstream artifact hash this one was built from).

**Downstream-stale invalidation.** If an upstream artifact's hash changes *after* a downstream artifact was built from it (e.g. the spec is edited after the plan was written), mark the downstream receipt **stale**. A stale receipt fails the receipt-gated entry check, so its checkpoint re-runs. This is what makes resume and skipped-checkpoint recovery deterministic.

**Hashing.** Use one consistent, canonical method so a later session recomputes the same value: artifact hashes are SHA-256 over the raw file bytes (e.g. `sha256sum <file>`). The Checkpoint 3 composite surface hash is SHA-256 over the per-file `sha256sum` lines (each `<hash>  <repo-relative-path>`, sorted by path) followed by the `git diff` text — or, outside a git repo, the per-file lines followed by the concatenated file bytes.

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
        {"id": "B1", "title": "missing idempotency guard on retry", "severity": "breakage", "status": "applied"},
        {"id": "S1", "title": "drop the separate audit-log table", "severity": "simplification", "status": "rejected"}
      ],
      "userDecisions": {"S1": "keep — needed for the audit log"},
      "userApproved": true,
      "stale": false
    },
    "plan": {
      "artifact": "docs/superpowers/plans/2026-06-02-export-csv.md",
      "artifactHash": "sha256:1c70…",
      "upstreamHash": "sha256:9f3a…",
      "mode": "plan-review",
      "rounds": 1,
      "verdict": "READY TO EXECUTE",
      "findings": [],
      "stale": false
    }
  }
}
```

`upstreamHash` on the plan receipt records the spec hash the plan was built from; compare it to the spec's current `artifactHash` to detect downstream-stale.

## Failure & resume

- **Codex unavailable** (429, timeout, auth, CLI missing) → STOP and ask the user before proceeding unreviewed. **No Gemini fallback.** This is why phase 0 preflights reachability — fail before brainstorming, not three phases in.
- **Superpowers skills missing** → caught at preflight (Phase 0). STOP and name the missing prerequisite; do not start brainstorming.
- **Skipped checkpoint** → caught by receipt-gated entry. Detect-and-repair, not prevention: go back and run it; if downstream state already exists, the stale flag forces its re-run too.
- **Resume off the state file, NOT artifact presence.** The state file records which checkpoint reviewed which hash with what verdict — that is the source of truth. Artifact presence alone cannot tell "drafted" from "converged" from "already used downstream", which is exactly the weak-evidence guessing the receipts exist to replace. Resume at the first phase whose entry assertion fails.
- **Fresh invocation finding an existing state file** → ask the user resume-vs-start-over. Do not blindly continue, and do not blindly wipe it.

## Red Flags — STOP if you catch yourself

| Rationalization | Reality |
| --- | --- |
| "The spec/plan looks done, skip the checkpoint." | A checkpoint that didn't run leaves no receipt. Run it. |
| "The artifact exists, so its checkpoint must have run." | Presence ≠ a receipt. Presence can't tell drafted from converged. Check the receipt. |
| "I'll just start this phase, the prior step obviously happened." | Entering a phase without asserting the prior receipt is how skips slip through. Assert first. |
| "This diff finding is small enough, I'll patch it by hand." | Only *trivial* findings go direct. Non-trivial → fresh fix-subagent with a narrow brief + validation. |
| "Codex keeps finding stuff, I'll just auto-apply and keep moving." | Scope/behaviour-changing findings are tradeoffs — pause and ask the user. Auto-apply is for clear wins only. |
| "Codex is down, Gemini can review instead." | No Gemini fallback. Stop and ask the user. |
| "Round 3 still has open findings, one more round will close them." | The cap is 3. Reaching it = STOP as unresolved, hand findings to the user. Never silently continue. |
| "It's a trivial feature, so I'll skip the checkpoints/receipts too." | Only SDD's per-task *review depth* scales for trivial work. The spec/plan/diff checkpoints and their receipts never do — run all three. |
| "I'll just start designing — prior art is a detour." | The prior-art scan grounds the design and gives the red-team real references. Run the lightweight scan; skip only with a stated reason, never silently. |
