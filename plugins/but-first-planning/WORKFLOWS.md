# WORKFLOWS.md — the house contract for bundled workflow scripts

Nine skills bundle a [Claude Code dynamic Workflow](https://code.claude.com/docs)
script under `workflows/`. Every script is **self-contained** — no imports, no
shared module — so these conventions are duplicated per script *on purpose*;
this file is the single place that says what they are. Drift between copies is
caught by review. When writing or editing a script, copy from
`plan-0-decompose/workflows/build-plan-tree.js` (fan-out + pipeline + verify loop)
or `spec-2-grill/workflows/deep-review.js` (review + adversarial verify +
fix rounds) rather than inventing new shapes.

## Inventory

| Script | meta.name | Skill's autonomous mode for |
|---|---|---|
| `spec-1-specify/workflows/author-spec.js` | `spec-1-author-spec` | authoring a spec from a brief |
| `spec-2-grill/workflows/deep-review.js` | `spec-2-deep-review` | grill-until-dry deep review |
| `spec-3-architect/workflows/deepening-review.js` | `spec-3-deepening-review` | spec-side deepening hunt (+apply) |
| `plan-0-decompose/workflows/build-plan-tree.js` | `plan-0-build-plan-tree` | spec → plan tree (+decide) |
| `spec-4-edit/workflows/propagate.js` | `spec-4-propagate` | wide-blast-radius propagation |
| `build-next-issue/workflows/reconcile.js` | `build-next-reconcile` | verification + dispatch JSON |
| `build-sprint/workflows/build-sprint.js` | `build-sprint-run` | autonomous sprint build |
| `build-assess-drift/workflows/triage-drift.js` | `build-drift-triage` | drift triage (+publish) |
| `build-improve-architecture/workflows/deepening-hunt.js` | `build-improve-deepening-hunt` | code-side deepening hunt (report-only) |

Deliberately **not** workflows: `spec-0-init` (a short interview + verbatim
copy), `plan-1-publish-issues` (`publish-issues.py` is the automation),
`build-tdd` (the leaf discipline builder agents execute — staging it would
recreate the horizontal-slicing anti-pattern it forbids), `build-rubber-duck`
(an ephemeral conversation).

## The model-tier policy

Set per `agent()` call via `model` / `effort`; also paste the short version as
a comment header in each script.

| Tier | Use for | Never for |
|---|---|---|
| `haiku` + effort `low` | Discover/Find/Index stages: ls/glob/grep, state reads, running index scripts, loading JSON | judgment of any kind |
| `sonnet` | template-driven file authoring, mechanical edits, builders (effort `high` — quality comes from the red-green discipline and re-checkpoint gates), verify-loop rounds, tracker-CLI driving | ranking, synthesis |
| `opus` + effort `high` | parallel-heavy judgment fan-outs: reviewers, hunters, classifiers, adversarial verifiers, critics, decomposers, lens proposals, HITL drafters | — |
| *omit* (inherit the session model) + effort `high`/`max` | singleton judgment: judges, shape synthesis, completeness critics, reference reconcilers, post-fix audits, dispatch derivation, stop-the-line diagnosis, decision resolution | wide fan-outs (cost) |

## Structural conventions (copy verbatim where possible)

- **meta**: `{name, description, whenToUse, phases:[{title, detail, model?}]}` —
  pure literal; `whenToUse` states the offer condition AND the full args
  signature; phase titles match the `phase()` calls exactly.
- **Arg coercion**, first thing in the body:
  `let A = args; if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }`
  then throw with the exact args signature if required keys are missing.
- **`BRIEF`** — the terse-machine-output constant appended to worker prompts;
  **`CTX`** — the pipeline-orientation constant (paths, what the run is,
  project notes) prepended to every substantive prompt.
- **Schemas** on every `agent()` call; severity enum is always
  `['critical','major','minor']`; review-verdict shape is
  `{refuted, reasoning, confidence, adjusted_*}` with "default to refuted when
  evidence is thin".
- **Barriers**: `pipeline()` is the default for multi-stage work; every
  `parallel()` barrier carries a one-line comment justifying it (dedup needs
  all findings; a judge needs all proposals; serial settle needs all verdicts).
- **The funnel is serial**: `plan-status.py` rewrites shared parent files —
  exactly one agent per run may call it, never a fan-out. Same for any stage
  that edits a shared file (`progress/index.md`, `reference/`).
- **No `Date.now()` / `Math.random()` / `new Date()`** — they break resume.
  Agents derive dates themselves (`date +%F`, `date +%s`), or the date arrives
  via args.
- **Git**: worker agents never mutate git state unless the script's contract is
  exactly that (build-sprint's builders commit; its PR stage pushes). Review/fix
  workflows leave everything uncommitted for the user.
- **`log()`** after every fan-out with counts (`Assessed 12/14 pages`); silent
  truncation is forbidden — a cap (`maxFindings`, `verifyLimit`) always reports
  what it dropped.
- **Failure**: an agent returning null is reported, never silently passed
  (`.filter(Boolean)` + count logs); verify loops escalate to an
  inherit-model agent after 3 worker rounds; a still-red verifier is returned
  in the report, not thrown, once artifacts exist on disk.

## Shared machine contracts

- **Dispatch JSON** — produced by `reconcile.js` at
  `.plan/progress/dispatch/EE-SS.json`, consumed by `build-sprint.js`. The
  schema's canonical home is `skills/build-next-issue/DISPATCH-PLAN.md` ("The
  JSON contract").
- **Drift files** — format owned by `skills/build-next-issue/SKILL.md`; scripts
  edit `status:`/`route:` lines and never delete a drift file.
- **The evidence rule** — checkpoint evidence is re-derived at each layer
  (builder → integrator → reconcile), never forwarded; only `reconcile.js`
  writes `--evidence` ledger rows.
