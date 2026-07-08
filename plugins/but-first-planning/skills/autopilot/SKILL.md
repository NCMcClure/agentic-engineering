---
name: autopilot
description: Autopilot the planning-and-build pipeline — spec, grill, architect, plan, publish, build — with one human touchpoint. Use when the user wants a project built end-to-end autonomously ("build this AFK").
---

# autopilot — the whole pipeline, hands-off

Drive the suite end-to-end by invoking each skill's **autonomous mode** in
sequence from the main loop — you stay the orchestrator between stages, reading
each workflow's report and deciding the next move. Do **not** wrap the pipeline
in one mega-workflow: publishing tickets and pushing PRs are permission-mediated
actions, the decision batch needs a real user touchpoint, and recovering from a
failed stage (a red verifier, a re-cut, a failed sprint) is judgment you do best
with the full report in front of you.

The user can mix modes — e.g. author the spec interactively, then autopilot
everything after. Ask which stages are yours at contract time.

## Step 0 — settle the autonomy contract (plan mode)

Enter plan mode and settle the contract in one pass — the questions, defaults,
option sets, policy-arg mappings, and the permissions to pre-approve are in
[AUTONOMY-CONTRACT.md](AUTONOMY-CONTRACT.md). Four calls: **decisions**,
**hitl**, **scope**, and the **publish/PR posture** — the contract file owns
each one's options. Present the contract and the stage list; the user's
approval of this plan is the run's one blanket authorization — after it, stop
only at the touchpoints the contract keeps.

## The pipeline

Each stage is the named skill's Autonomous mode section, invoked exactly as
documented there (the spec-2, spec-3, plan-0, and plan-1 skills are user-invoked
— read and follow each one's `SKILL.md` directly for anything their workflows
leave to prose):

1. **Workspace** — if `.plan/` is absent, run `spec-0-init` (the one inherently
   interactive step; keep its interview brief, feeding it the contract's tracker
   choice).
2. **Spec** — `spec-1-specify` → `author-spec.js` with the brief, passing
   `languagePosture` read from `.plan/spec/reference/adr/0001-language-posture.md`
   (spec-0-init recorded it). Carry its `openQuestions` forward.
3. **Grill until dry** — `spec-2-grill` → `deep-review.js`
   `{applyFixes: true, rounds: 3}`.
4. **Architect** — `spec-3-architect` → `deepening-review.js`
   `{apply: 'strong'}`.
5. **Plan** — `plan-0-decompose` → `build-plan-tree.js` `{decisionPolicy: decisions
   === 'auto' ? 'decide' : 'route'}`.
6. **Touchpoint 1 — the consolidated gate.** One message: the epic/sprint shape
   and counts, every `decisionsMade` ADR (if auto), the residual HITL decision
   issues **with your recommended answer for each**, and "about to publish
   sprint EE-SS to <tracker>". Apply the user's batch answers as spec/ADR edits
   (re-run `propagate.js` if they ripple), flip answered decision issues through
   the funnel. Under a fully pre-authorized contract this degrades to a report —
   post it and continue.
7. **Per-sprint loop** until the scope is exhausted or a failure budget stops it:
   - `python .plan/plan/publish-issues.py publish --sprint EE-SS --dry-run`,
     then for real (the contract's publish posture authorized this).
   - `build-next-issue` → `reconcile.js` `{dispatch: true}`.
   - `build-sprint` → `build-sprint.js` with the contract's `hitlPolicy` and the
     dispatch JSON.
   - Surface the returned `drafts` / `autoDecisions` / `failed` lists per the
     contract's cadence (touchpoint 2); under full-auto, append them to the run
     ledger and continue.
   - `reconcile.js` again — the independent re-verification that writes the
     `--evidence` ledger rows. Then the next sprint.
8. **Every 2 sprints** — `build-assess-drift` → `triage-drift.js` (publish per
   contract), and optionally `build-improve-architecture` → `deepening-hunt.js`;
   route survivors on the next loop.

## The trust property

Evidence is **re-derived at every layer, never forwarded**: a builder's
checkpoint pass is re-run by its integrator, and everything is re-verified by
`reconcile.js` before a ledger row exists. Every autonomous decision is an ADR
plus a flagged report line — reviewable after the fact, never silent. If any
stage's convergence fails (verifier stays red, a sprint stops early twice on
the same route), stop the pipeline and report — don't push through a broken
foundation.

## Done when

The contracted scope is built and PR'd, every sprint's ledger rows were written
by an independent reconcile, the run ledger (a `.plan/progress/notes/` file per
sprint plus your final summary) accounts for every draft, auto-decision,
failure, and drift item — and the user got exactly the touchpoints the
contract promised, no more.
