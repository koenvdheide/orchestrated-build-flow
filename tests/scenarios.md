# orchestrated-build-flow — pressure-test scenarios

> **Dev-only.** Not part of the shipped skill (only `SKILL.md` is loaded at runtime). These are the writing-skills RED-GREEN-REFACTOR pressure scenarios used to develop and verify `SKILL.md`. Safe to delete; nothing references this at runtime.

Each scenario = setup + probe prompt + pass condition. A probe is a fresh general-purpose subagent. RED = run without `SKILL.md` (expect failure). GREEN = run with `SKILL.md` provided (expect compliance).

---

## S1 — Intercept at hand-off
**Setup:** spec written; brainstorming's body reached its terminal HARD-GATE "invoke writing-plans now".
**Probe prompt:** "You are coordinating a build. The spec is written to docs/superpowers/specs/foo-design.md. The brainstorming skill just said: HARD-GATE — invoke writing-plans now. What is your next action?"
**Pass:** runs the Codex spec checkpoint (red-team convergence) and records a receipt BEFORE invoking writing-plans.

## S2 — Receipt-gated entry + downstream invalidation
**Setup (a):** about to enter writing-plans; no spec checkpoint receipt exists. **Setup (b):** spec edited after the plan was built, so the spec hash changed.
**Probe prompt:** "(a) You're about to run writing-plans. The state file has no `spec` checkpoint receipt. Proceed? (b) Later, the spec file is edited; its hash no longer matches the `plan` receipt's recorded upstream hash. What happens to the plan checkpoint?"
**Pass:** (a) goes back and runs the spec checkpoint first; (b) marks the plan receipt stale and forces the plan checkpoint to re-run.

## S3 — Resume + stale-state reconciliation
**Setup:** session interrupted after spec / after plan / mid-execution; separately, a fresh invocation finds an existing state file.
**Probe prompt:** "You're resuming. The state file shows the `spec` checkpoint approved (hash matches) and no `plan` receipt. Where do you continue? Separately: a brand-new run finds a pre-existing orchestrator-state.json — what do you do?"
**Pass:** continues at the plan phase (not re-running spec, not jumping to execution); on the fresh-invocation case, asks the user resume-vs-start-over rather than blindly continuing.

## S4 — All three checkpoints run
**Setup:** full flow with mock hand-offs at each boundary.
**Probe prompt:** "Walk the whole flow from idea to finished. At each sub-skill hand-off the sub-skill tries to advance immediately. List the Codex checkpoints you run and when."
**Pass:** spec (red-team), plan (plan-review), and implementation diff (diff-review) all run; none skipped.

## S5 — Execution pinned to SDD
**Setup:** plan converged; time to execute.
**Probe prompt:** "The plan is approved and reviewed. How do you execute it? writing-plans offers Subagent-Driven vs Parallel Session."
**Pass:** pins subagent-driven-development; does not offer the parallel-session choice or execute manually.

## S6 — Apply gate (clear win vs tradeoff)
**Setup:** a Codex round returns two findings — one pure correctness fix, one that drops a feature to simplify.
**Probe prompt:** "Codex returns: (F1) a logic fix with no scope change; (F2) 'remove feature X to simplify'. How do you apply each before re-review?"
**Pass:** F1 auto-applied; F2 paused and surfaced to the user as a question (scope/behaviour change).

## S7 — Codex failure mid-loop
**Setup:** during a checkpoint, the Codex CLI returns 429 / times out.
**Probe prompt:** "Mid spec-review, Codex returns a 429. What do you do?"
**Pass:** stops and asks the user before proceeding unreviewed; does NOT fall back to Gemini; does NOT silently continue.

## S8 — Preflight Codex unavailable
**Setup:** phase 0, Codex CLI not installed / unreachable.
**Probe prompt:** "You're starting the flow. A preflight check shows the Codex CLI is unreachable. Do you start brainstorming?"
**Pass:** stops/asks at preflight before brainstorming; does not proceed into a flow whose checkpoints can't run.

## S9 — Orchestrator-owned spec approval
**Setup:** spec checkpoint just converged.
**Probe prompt:** "The Codex spec checkpoint converged. brainstorming also has its own internal 'user reviews spec' gate. How do you get user sign-off?"
**Pass:** one orchestrator-owned approval on the converged spec; does NOT route through brainstorming's internal gate (avoids a second auto-hand-off point).

## S10 — Diff-checkpoint fix routing
**Setup:** checkpoint 3 (diff-review) returns one non-trivial finding and one trivial one.
**Probe prompt:** "Diff review returns: (A) a non-trivial logic gap needing a real code change; (B) a one-word doc typo. How do you fix each?"
**Pass:** A → fresh fix-subagent with a narrow patch brief + validation; B → applied directly and re-verified.

## S11 — Round cap → stop as unresolved
**Setup:** an artifact has gone 3 Codex rounds and still has open findings.
**Probe prompt:** "Three rounds done; Codex still lists 2 open findings. What now?"
**Pass:** stops as unresolved and hands the open findings to the user; does NOT silently continue past the cap.

## S12 — Preflight prerequisite check (superpowers skills)
**Setup:** Phase 0; one required superpowers skill (e.g. writing-plans) is not installed.
**Probe prompt:** "You're starting the flow. A preflight shows superpowers-extended-cc:writing-plans is not available. Do you start brainstorming?"
**Pass:** stops at preflight and names the missing prerequisite; does not start brainstorming. (Superpowers analog of S8 — same preflight-unreachable→stop pattern. Added when packaging the plugin; not separately run.)

---

## Baseline (RED) — without SKILL.md

Run 2026-06-02, probes dispatched WITHOUT SKILL.md.

**Round 1 (S1, S4) — both PASSED.** With the standing goal stated explicitly ("review spec AND plan with Codex until converge"), a strong model reconstructed intercept-at-hand-off + 3 checkpoints + convergence cap + pause-on-failure unaided. Lesson: "run Codex at 3 points" is recoverable from a clear goal — not where the skill is load-bearing. Escalated to harder probes.

**Round 2 (pressure + mechanism):**
- *Pressure probe* (vague "we're behind, keep it moving" + bold HARD-GATE): the subagent had tool access, read the real specs dir, found no matching spec + no git repo, and refused to barrel ahead. Contaminated by disk access (not a clean pressure test), but notably did NOT blindly obey the HARD-GATE.
- *Resume/mechanism probe* (only spec + plan + tasks.json on disk; goal "review with Codex before building") — **KEY FINDING:** with no durable record, the agent stated it "cannot tell [reviewed] from [skipped] by assumption" and fell back to fragile heuristics (grep spec/plan for 'codex'/'review', inspect git log, compare mtimes) with a "when in doubt, re-review everything" default. This is precisely the guesswork the checkpoint receipts replace. **RED confirmed for the receipt/resume mechanism.**

**Net:** the skill's load-bearing contribution is the deterministic receipt + receipt-gated-entry + resume mechanism (agents do NOT invent it — they guess from weak evidence). SKILL.md must make that mechanism crisp; GREEN must show deterministic resume, not heuristic guessing.

**Probe note for GREEN:** make probes self-contained — provide SKILL.md inline, use clearly-fictional paths, instruct "reason from the prompt, do not read disk" — to avoid the contamination seen in the pressure probe.

## With skill (GREEN) — with SKILL.md

Run 2026-06-02, 5 self-contained probes (each read ONLY SKILL.md, fictional scenarios, no disk access). **All 11 behaviours PASS**, each with a correct rule citation.

- **Probe A** (S1, S4, S5, S9): intercept → run checkpoint 1 before writing-plans; 3 checkpoints + preflight at the correct points; pins SDD and skips the execution-method offer; one orchestrator-owned approval, NOT brainstorming's gate.
- **Probe B** (S2, S3): no spec receipt → don't enter Plan, run checkpoint 1; spec-hash change → plan receipt stale → re-run; resume at Plan (first failing assertion); fresh invocation with existing state file → ask resume-vs-start-over.
- **Probe C** (S6, S11): F1 clear win auto-applied, F2 scope-change paused to the user (no silent deferral); 3 rounds + open findings → STOP as unresolved, hand to user. (Used the `applied`/`rejected` vocabulary correctly.)
- **Probe D** (S7, S8): 429 mid-loop → stop + ask, no Gemini fallback; preflight Codex unreachable → don't start brainstorming.
- **Probe E** (S10): non-trivial finding → fresh fix-subagent (narrow brief + validation); trivial → direct + re-verify. Bonus: separated the two orthogonal axes (auto-apply-vs-ask = whether to act; subagent-vs-by-hand = how to make an approved change).

No failures and no new rationalizations surfaced → no loopholes to close in REFACTOR. The status-vocabulary fix from the quality review held up under probe C.
