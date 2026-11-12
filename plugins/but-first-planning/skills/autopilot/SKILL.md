---
name: autopilot
description: >
  Runs the whole pipeline hands-off (spec, grill, architect, plan, publish,
  build, docs) under one up-front contract with one consolidated human gate.
  Run when the user wants a well-specified project built end to end unwatched.
disable-model-invocation: true
---

# autopilot: the whole pipeline, hands-off

Drive the suite end-to-end by invoking each skill's **autonomous mode** in
sequence from the main loop: you stay the coordinator between stages, reading
each workflow's report and deciding the next move. Do **not** wrap the pipeline
in one mega-workflow: publishing tickets and pushing PRs are permission-mediated
actions, the decision batch needs a real user touchpoint, and recovering from a
failed stage (a red verifier, a re-cut, a failed sprint) is judgment you do best
with the full report in front of you.

The user can mix modes: author the spec interactively, then autopilot
everything after. Ask which stages are yours at contract time.

## Without the Workflow tool

Every stage below is another skill's autonomous mode, and most of those are a
`Workflow()` call. Where the session has no such tool, each stage runs as a
parallel-subagent fan-out instead:
[references/subagent-fallback.md](../../references/subagent-fallback.md) is the
contract, and it is what keeps an autonomous run there from quietly becoming
a different, unverified run. The stage order, the gates between
phases, and the autonomy contract are unchanged; only how a stage executes
inside itself differs.

## Step 0: settle the autonomy contract (plan mode)

Enter plan mode and settle the contract in one pass: the questions, defaults,
option sets, policy-arg mappings, and the permissions to pre-approve are in
[AUTONOMY-CONTRACT.md](AUTONOMY-CONTRACT.md). Four calls: **decisions**,
**hitl**, **scope**, and the **publish/PR posture**: the contract file owns
each one's options. Present the contract and the stage list; the user's
approval of this plan is the run's one blanket authorization, after it, stop
only at the touchpoints the contract keeps.

## The pipeline

Each stage is the named skill's Autonomous mode section, invoked exactly as
documented there. Read and follow a stage's `SKILL.md` directly for anything
its workflow leaves to prose:

1. **Workspace**: if `.agents/plan/` is absent, scaffold it by following
   `${CLAUDE_PLUGIN_ROOT}/skills/spec-init/SKILL.md` (the one inherently
   interactive step; keep its interview brief, feeding it the contract's
   tracker choice).
2. **Spec**: `spec-write` → `author-spec.js` with the brief, passing
   `languagePosture` read from `.agents/plan/spec/reference/adr/0001-language-posture.md`,
   `uiPosture` from `adr/0002-ui-posture.md`, and `docsPosture` from
   `adr/0003-user-docs-posture.md` (spec-init recorded all three). Carry its
   `openQuestions` forward.
3. **Grill until dry**: `spec-grill` → `deep-review.js`
   `{applyFixes: true, rounds: 3}`.
4. **Architect**: `spec-architect` → `deepening-review.js`
   `{apply: 'strong'}`.
5. **Plan**: `plan-decompose` → `build-plan-tree.js` `{decisionPolicy: decisions
   === 'auto' ? 'decide' : 'route'}`.
6. **Touchpoint 1, the consolidated gate.** One message: the epic/sprint shape
   and counts, every `decisionsMade` ADR (if auto), the residual HITL decision
   issues **with your recommended answer for each**, and "about to publish
   sprint EE-SS to <tracker>". Apply the user's batch answers as spec/ADR edits
   (re-run `propagate.js` if they ripple), flip answered decision issues through
   the funnel. Under a fully pre-authorized contract this degrades to a report, post it and continue.
7. **Per-sprint loop** until the scope is exhausted or a failure budget stops it:
   - `node .agents/plan/plan/publish-issues.mjs publish --sprint EE-SS` (the
     contract's publish posture authorized this; skip it in local-markdown
     mode). On GitHub with a Project board, set each new issue's board fields
     per plan-publish's TRACKER-GITHUB.md.
   - `build-next-issue` → `reconcile.js` `{dispatch: true}`.
   - `build-sprint` → `build-sprint.js` with the contract's `hitlPolicy` and the
     dispatch JSON.
   - Surface the returned `drafts` / `reviewPending` / `autoDecisions` /
     `failed` lists per the contract's cadence (touchpoint 2); under full-auto,
     append them to the run ledger and continue (`notified` says which gate
     issues already carry a `Human gate` @mention comment).
   - `reconcile.js` again, the independent re-verification that writes the
     `--evidence` ledger rows.
   - `build-user-docs`, end-user docs for the ledger-verified work, grounded
     by running the built commands and committed onto the still-open sprint PR,
     per the contract's docs posture. Then the next sprint.
8. **Every 2 sprints**: `build-assess-drift` → `triage-drift.js` (publish per
   contract), and optionally `build-improve-architecture` → `deepening-hunt.js`;
   route survivors on the next loop.

**If agent-works is installed** and the person wants one change request per
issue, the build step of step 7 can go to its board instead of `build-sprint`:
each issue is built by its own session in its own worktree and lands as its
own change. Name that choice, and any touchpoint it adds, in the contract.
Reconcile before and after, and `build-user-docs`, are unchanged.

## The trust property

Evidence is **re-derived at every layer, never forwarded**: a builder's
checkpoint pass is re-run by its integrator, and everything is re-verified by
`reconcile.js` before a ledger row exists. Every autonomous decision is an ADR
plus a flagged report line, reviewable after the fact, never silent. If any
stage's convergence fails (verifier stays red, a sprint stops early twice on
the same route), stop the pipeline and report, don't push through a broken
foundation.

## Done when

The contracted scope is built and PR'd, every sprint's ledger rows were written
by an independent reconcile, end-user docs are current through the built scope
(`.agents/plan/progress/docs.md` covers every verified sprint, unless the contract
turned the docs pass off), the run ledger (a `.agents/plan/progress/notes/` file per
sprint plus your final summary) accounts for every draft, pending REVIEW
walkthrough, auto-decision, failure, and drift item, and the user got exactly
the touchpoints the contract promised, no more.
