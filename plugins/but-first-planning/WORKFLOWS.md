# WORKFLOWS.md: the house contract for bundled workflow scripts

Ten skills bundle a [Claude Code dynamic Workflow](https://code.claude.com/docs)
script under `workflows/`. Every script is **self-contained**: no imports, no
shared module, so these conventions are duplicated per script *on purpose*;
this file is the single place that says what they are. Drift between copies is
caught by review. When writing or editing a script, copy from
`plan-decompose/workflows/build-plan-tree.js` (fan-out + pipeline + verify loop)
or `spec-grill/workflows/deep-review.js` (review + adversarial verify +
fix rounds) rather than inventing new shapes.

## Inventory

| Script | meta.name | Skill's autonomous mode for |
|---|---|---|
| `spec-write/workflows/author-spec.js` | `spec-write-author` | authoring a spec from a brief |
| `spec-grill/workflows/deep-review.js` | `spec-grill-deep-review` | grill-until-dry deep review |
| `spec-architect/workflows/deepening-review.js` | `spec-architect-deepening` | spec-side deepening hunt (+apply) |
| `plan-decompose/workflows/build-plan-tree.js` | `plan-decompose-tree` | spec → plan tree (+decide) |
| `spec-edit/workflows/propagate.js` | `spec-edit-propagate` | wide-blast-radius propagation |
| `build-next-issue/workflows/reconcile.js` | `build-next-reconcile` | verification + dispatch JSON |
| `build-sprint/workflows/build-sprint.js` | `build-sprint-run` | autonomous sprint build |
| `build-assess-drift/workflows/triage-drift.js` | `build-drift-triage` | drift triage (+publish) |
| `build-audit/workflows/build-audit.js` | `build-audit-run` | post-build gap audit → new epic (+publish) |
| `build-improve-architecture/workflows/deepening-hunt.js` | `build-improve-deepening-hunt` | code-side deepening hunt (report-only) |

Deliberately **not** workflows: `spec-init` (a short interview + verbatim
copy), `plan-publish` (`publish-issues.mjs` is the automation),
`build-tdd` (the leaf discipline builder agents execute, staging it would
recreate the horizontal-slicing anti-pattern it forbids), `build-user-docs`
(serial grounded writing, a fan-out would fragment doc coherence),
`build-rubber-duck` (an ephemeral conversation), and `autopilot` (it chains the
ten below rather than being one; wrapping the pipeline in a mega-workflow would
put permission-mediated actions and the human touchpoint inside a run nobody
can stop).

## The Workflow tool is not everywhere

A session may have no `Workflow()` tool. Every autonomous mode therefore names
the fallback in
[references/subagent-fallback.md](references/subagent-fallback.md): the same
phases, run as parallel subagents, with the parent session owning every shared
file and the status funnel. A skill that mentions the tool without naming the
fallback leaves a model with an instruction it cannot follow.

## The model-tier policy

Set per `agent()` call via `model` / `effort`; also paste the short version as
a comment header in each script.

| Tier | Use for | Never for |
|---|---|---|
| `haiku` + effort `low` | Discover/Find/Index stages: ls/glob/grep, state reads, running index scripts, loading JSON | judgment of any kind |
| `sonnet` | template-driven file authoring, mechanical edits, builders (effort `high`, quality comes from the red-green discipline and re-checkpoint gates), verify-loop rounds, tracker-CLI driving | ranking, synthesis |
| `opus` + effort `high` | parallel-heavy judgment fan-outs: reviewers, hunters, classifiers, adversarial verifiers, critics, decomposers, lens proposals, HITL drafters |, |
| *omit* (inherit the session model) + effort `high`/`max` | singleton judgment: judges, shape synthesis, completeness critics, reference reconcilers, post-fix audits, dispatch derivation, stop-the-line diagnosis, decision resolution | wide fan-outs (cost) |

## Structural conventions (copy verbatim where possible)

- **meta**: `{name, description, whenToUse, phases:[{title, detail, model?}]}`, pure literal; `whenToUse` states the offer condition AND the full args
  signature; phase titles match the `phase()` calls exactly.
- **Arg coercion**, first thing in the body:
  `let A = args; if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }`
  then throw with the exact args signature if required keys are missing.
- **`BRIEF`**: the terse-machine-output constant appended to worker prompts;
  **`CTX`**: the pipeline-orientation constant (paths, what the run is,
  project notes) prepended to every substantive prompt.
- **Schemas** on every `agent()` call; severity enum is always
  `['critical','major','minor']`; review-verdict shape is
  `{refuted, reasoning, confidence, adjusted_*}` with "default to refuted when
  evidence is thin".
- **Barriers**: `pipeline()` is the default for multi-stage work; every
  `parallel()` barrier carries a one-line comment justifying it (dedup needs
  all findings; a judge needs all proposals; serial settle needs all verdicts).
- **The funnel is serial**: `plan-status.mjs` rewrites shared parent files, exactly one agent per run may call it, never a fan-out. Same for any stage
  that edits a shared file (`progress/index.md`, `reference/`).
- **No `Date.now()` / `Math.random()` / `new Date()`**: they break resume.
  Agents derive dates themselves (`date +%F`, `date +%s`), or the date arrives
  via args.
- **Git**: worker agents never mutate git state unless the script's contract is
  exactly that (build-sprint's builders commit; its PR stage pushes). Review/fix
  workflows leave everything uncommitted for the user.
- **`log()`** after every fan-out with counts (`Assessed 12/14 pages`); silent
  truncation is forbidden, a cap (`maxFindings`, `verifyLimit`) always reports
  what it dropped.
- **Failure**: an agent returning null is reported, never silently passed
  (`.filter(Boolean)` + count logs); verify loops escalate to an
  inherit-model agent after 3 worker rounds; a still-red verifier is returned
  in the report, not thrown, once artifacts exist on disk.

## Shared machine contracts

- **Dispatch JSON**: produced by `reconcile.js` at
  `.agents/plan/progress/dispatch/EE-SS.json`, consumed by `build-sprint.js`. The
  schema's canonical home is `skills/build-next-issue/DISPATCH-PLAN.md` ("The
  JSON contract").
- **Drift files**: format owned by `skills/build-next-issue/SKILL.md`; scripts
  edit `status:`/`route:` lines and never delete a drift file.
- **The evidence rule**: checkpoint evidence is re-derived at each layer
  (builder → integrator → reconcile), never forwarded; only `reconcile.js`
  writes `--evidence` ledger rows.
- **The `**User-facing**` line**: required on every AFK/HITL issue a script
  authors or edits; format owned by `skills/plan-decompose/PLAN-FORMAT.md`.
  Scripts that touch issue bodies preserve it; `build-plan-tree.js` fills it.
- **Codebase hubs** - the repository-layout page and the hub rules are owned
  by `skills/spec-write/CODEBASE-LAYOUT.md`. This plugin ships no hub checker:
  scripts that run verifiers run the "Codebase hubs current" checkpoint row
  when a plan carries one (a repo with agent-works installed), and builder
  prompts carry the update-on-change duty either way.
