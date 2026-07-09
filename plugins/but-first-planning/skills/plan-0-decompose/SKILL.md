---
name: plan-0-decompose
description: Decompose the spec into an epic → sprint → issue tree of tracer-bullet vertical slices under .plan/plan/. Bundles a multi-agent workflow for large specs.
disable-model-invocation: true
---

# plan-0-decompose — turn the spec into an executable backlog

Decompose the specification into a plan tree under `.plan/plan/`: **epics**
(large outcomes) contain **sprints** (coherent batches) contain **issues** (thin
vertical slices a single contributor can grab and finish). The tree mirrors the
spec's structure, and every issue links back to the spec sections it realises, so
the plan stays grounded in the design and changes propagate.

Plan a solid spec. If grilling or architecture review would still move the
design, do that first (`spec-2-grill`, `spec-3-architect`) — re-cutting issues
after the design shifts is wasted work.

## The core unit: a tracer-bullet vertical slice

Every issue is a **thin vertical slice that cuts end-to-end** through whatever
layers the system has — not a horizontal slice of one layer. A completed slice is
demoable or verifiable on its own. Prefer many thin slices over few thick ones.
This is the single most important idea in the skill; the full rationale, the
HITL/AFK/REVIEW distinction, and worked good/bad examples are in
[VERTICAL-SLICES.md](VERTICAL-SLICES.md). Read it before drafting.

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 1. Read the spec

Read `.plan/spec/index.md` and descend into the categories. Note the spec's
natural seams (often the architecture work from `spec-3-architect` already
named them) and any ordering the design implies. Use the glossary's vocabulary
for titles and descriptions — issues should read in the project's own language.

### 2. Propose the epic → sprint shape

Before writing any files, sketch the decomposition and confirm it:

- **Epics** — each a large, observable outcome. Often one per major spec area, but driven by *deliverable outcomes*, not by mirroring the file tree one-to-one.
- **Sprints** — within an epic, ordered by data-flow dependency. Each sprint has a coarse observable exit outcome.
- **Dependency chain** — epics and sprints usually form a mostly-linear chain (each one's exit is the next one's prerequisite). Make that explicit.

Present this as a tree and iterate with the user until the shape feels right.

### 3. Draft the issues per sprint

For each sprint, draft its issues as tracer-bullet slices. For each, decide:

- **Title** — the observable behaviour, in domain language.
- **Type** — `HITL` (needs a human decision/review), `AFK` (an agent can implement and merge it autonomously), or `REVIEW` (a human opens a UI surface and visually confirms spec'd behaviour — see below). Prefer AFK where honest.
- **Blocked by** — which sibling issues must land first.
- **Spec anchors** — the spec file(s) this slice realises. Every issue carries at least one. See [SPEC-ANCHORS.md](SPEC-ANCHORS.md) for why and how (the relative-path shape matters — the verifier checks it).

**Route every open question.** Sweep the spec for "Open questions" sections and
inline `**Open question:**` blocks — each one is routed **exactly once**:

- A genuine **product decision** that gates work becomes a dedicated `HITL`
  **decision issue**, placed in the earliest sprint whose work it gates and
  blocking the gated issues. Its title names the decision and its acceptance
  criteria are decision-shaped (an ADR/spec note exists and is recorded), not
  code-shaped.
- A **builder-choice-within-fixed-constraints** question becomes an inline note
  in the `## What to build` of the issue that implements the constrained
  contract, so the builder sees the latitude and its bounds.

An unrouted open question is a planning bug: it resurfaces mid-build as an
improvised decision nobody approved.

**Cut the REVIEW gates.** Read `.plan/spec/reference/adr/0002-ui-posture.md`.
Under `headless`, cut none. Otherwise add one `REVIEW` issue per **verification
boundary** — a user-visible feature or system capability a human can confirm by
looking — typically 1–3 per sprint, `Blocked by` the slices that implement it,
anchored to the spec's verification-surfaces / UI pages. Under `dev-dashboard`,
the dashboard itself is spec'd work: cut it as **ordinary AFK slices, scheduled
early** (its walking skeleton belongs in an early sprint — REVIEW issues need a
surface to open). Shape, granularity, and the template are in
[VERTICAL-SLICES.md](VERTICAL-SLICES.md) and [PLAN-FORMAT.md](PLAN-FORMAT.md).

### 4. Quiz the user

Present the breakdown as a numbered list per sprint, showing title, type,
blocked-by, and the spec anchors. Ask:

- Does the granularity feel right (too coarse / too fine)?
- Are the dependency relationships correct?
- Should any slice be split or merged?
- Are HITL vs AFK assignments honest?
- Are the REVIEW gates at the right verification boundaries (not one per slice, not one per epic)?

Iterate until approved. Don't write files until the shape is settled.

### 5. Write the tree

Create the directories and files using the exact templates in
[PLAN-FORMAT.md](PLAN-FORMAT.md) — the field names and link shapes are not
cosmetic; the verifier checks them. The shape:

```
.plan/plan/
├── index.md                         # epic table (update the spec-0-init stub)
├── 01-<epic-slug>/
│   ├── epic.md                      # sprint table + goal + testing checkpoints
│   └── 01-<sprint-slug>/
│       ├── sprint.md                # issue table + goal + checkpoints
│       └── issues/
│           ├── 01_issue_SLUG.md
│           └── 02_issue_SLUG.md
```

Leave every issue's `GitHub` field as `<unassigned>` and `Status` as
`not-started` — publishing (`plan-1-publish-issues`) fills in real references later.

### 6. Verify

```bash
python .plan/plan/verify-plan-tree.py
```

It checks structure, required fields, that sprint/epic tables match what's on
disk, that blocked-by links resolve, and that **spec anchors resolve** to real
spec files. Fix anything it flags. A clean tree exits 0 and prints the counts.

### 7. Hand off

Update `.plan/plan/index.md`'s epic table and tell the user the plan is ready.
Next steps: `plan-1-publish-issues` to push a sprint's issues to the tracker (do this
lazily, sprint by sprint, not all at once), or `build-next-issue` once work
is under way. If revising the spec later, `spec-4-edit` keeps the plan in sync.

## At scale: the bundled workflow

For a large spec (roughly **15+ content pages**), or when the user asks for a
headless/comprehensive run, sketching the whole tree in prose stops being
tractable. This skill bundles a deterministic multi-agent pipeline for exactly
that case: `workflows/build-plan-tree.js` assesses every spec page in parallel,
has three lens-diverse architects propose competing epic shapes with a judge
synthesizing the winner (this replaces the step-2/step-4 user quiz — say so when
offering it), decomposes and authors every epic concurrently, loops the verifier
to green, and audits coverage / slice quality / testability before fixing what
the critics find. Every open question is force-routed per the rule above via an
explicit ledger.

Offer it — don't silently run it. After the user approves the run (plan mode),
invoke:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/plan-0-decompose/workflows/build-plan-tree.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/plan-0-decompose",
    // optional: pages: [...spec-relative paths] (else auto-discovered),
    // context: "<one-paragraph project orientation for the agents>",
    // lenses: [{key, prompt}, ...] to replace the default architect lenses
    // decisionPolicy: "decide" — autonomous mode: resolve every DERIVABLE open
    //                 question as an ADR first; only the genuinely non-derivable
    //                 residue becomes HITL decision issues (default "route")
  }
})
```

**Autonomous mode** is this workflow with `{decisionPolicy: "decide"}`.
**Converged when** the verifier exits 0 and the audit fixer has applied the
critics' findings. What stays gated: the returned `decisionsMade` (each an ADR
— review them after the fact) and the residual HITL decision issues, which are
the honest list of product calls no one has made yet.

The result reports the shape, counts, open-question routing, verifier state, and
audit outcome — hand off from there exactly as in step 7. The interactive
process above stays the default for small specs and for users who want to shape
the tree themselves.

## Why this shape

- **Vertical slices** mean every issue delivers observable progress and can be verified alone — no big-bang integration at the end.
- **Spec anchors** make the plan auditable against the design and let `spec-4-edit` find which issues a spec change affects.
- **Lazy publishing** keeps the tracker honest: issues become real tickets when a sprint is actually about to start, not 300 stale tickets up front.
- **A count-agnostic verifier** keeps the tree trustworthy as it grows.
