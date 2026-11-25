---
name: spec-grill
description: >
  Interrogates the spec one question at a time: sharpens the glossary,
  surfaces contradictions and unstated decisions, records ADRs. Use after
  spec-write and before planning, or when asked to grill or stress-test the
  spec.
---

# spec-grill: interrogate the spec until it's sharp

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

`P` below is the workspace this run works in, `.agents/plan` or `.agents/plans/<name>`: the area's `SKILL.md` says how it is settled. Write it out wherever a path says `P`.

Interview the user relentlessly about the specification until you reach shared
understanding. Walk down each branch of the design tree, resolving dependencies
between decisions one by one. For every question, offer your recommended answer, you're a sparring partner with opinions, not a survey.

Ask **one question at a time** and wait for the answer before continuing. If a
question can be answered by reading the spec instead of asking, read the spec.

This route grills a spec and nothing else. For anything that is not a spec (a
request, a task, a plan, a design not yet written down), use `grill`, the
general alignment interview.

The standing goal: every concept has one canonical name, every fork in the design
has a recorded resolution, and no two spec files contradict each other.

## What this route operates on

- The spec under `P/spec/`, the thing being grilled.
- The glossary at `P/spec/reference/glossary.md`, the canonical vocabulary. Format and discipline in [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md).
- The decision records under `P/spec/reference/adr/`, load-bearing choices. Format and the bar for creating one in [ADR-FORMAT.md](ADR-FORMAT.md).

Both the glossary and the ADR folder were scaffolded by `spec-init`. Create
individual ADR files lazily, only when one is warranted.

**In a named workspace** (`.agents/plans/<name>/`) the vocabulary and the
decisions are first of all the project's: read `.agents/plan/spec/reference/`
where the repo has it, and challenge against that. What the grilling settles
goes one of two places. A term or decision that belongs to this work alone goes
in `P/spec/reference/` (`glossary.md`, `adr/NNNN-slug.md` numbered from 0001
there), made when the first one is. One that reaches past this work, or that
contradicts a project record, is the project's: say so, change it there
through `spec-edit --plan project`, and link to it from the page that leans on
it. Never copy a project term into the workspace to redefine it.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with `glossary.md`, call it out at once:
"The glossary defines *cancellation* as X, but you seem to mean Y, which is it?"
The glossary is the contract; drift from it is a bug to fix, in one place or the
other.

### Sharpen fuzzy language

When a term is vague or overloaded, propose a precise canonical name: "You're
saying *account*, do you mean the Customer or the User? Those are different
things in this spec." Pin it, then record it.

### Surface contradictions between spec files

There's no code yet to cross-reference against, so cross-reference the spec
against *itself*. When the user states how something works, check whether the
spec already says something different elsewhere, and surface it: "`02-runtime/`
says intents are processed in arrival order, but you just described out-of-order
retries, which holds?" Internal coherence is the main thing a pre-code grill can
buy you. When you find a contradiction, drive it to a single resolution and fix
the losing file.

### Probe with concrete scenarios

When a relationship is fuzzy, invent a specific scenario that forces precision:
"Two intents for the same entity arrive in the same tick, what happens?" Edge
cases expose the boundaries between concepts faster than abstract questions.

## Capture decisions inline, don't batch

The value of this route is that understanding gets *recorded* as it crystallises,
not lost to the transcript.

- **A term gets resolved?** Update `glossary.md` right then, in the format in [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md). The glossary is a glossary, definitions only, no implementation detail, no design rationale.
- **A fuzzy term gets sharpened?** Update its glossary entry on the spot.
- **The grilling changes the design?** Edit the affected spec file(s) so the spec stays the source of truth, and bump their `updated` frontmatter and summary (see `spec-write`'s FRONTMATTER reference). Run `node P/spec/scripts/verify-spec-tree.mjs` after edits.
- **A decision is load-bearing?** Offer an ADR, but only when it clears the bar (hard to reverse ∧ surprising without context ∧ a real trade-off). Most decisions don't qualify; see [ADR-FORMAT.md](ADR-FORMAT.md). ADR files on the site carry frontmatter like any content file.

## At scale: the bundled deep-review workflow

The grill above is interactive by design, one question, one answer, one edit.
Its headless complement is bundled at `workflows/deep-review.js`: a deterministic
multi-agent pipeline that fans a reviewer out per spec section plus cross-cutting
lenses (coherence, gap-hunting, planning-readiness, plus any project-specific
lenses you pass), semantically dedups the findings, **adversarially verifies
every one** (a skeptic tries to refute it against the spec), runs a completeness
critic whose follow-up probes are themselves verified, and, only if
`applyFixes: true`, applies the confirmed fixes per section with a serial
glossary/ADR reconciler and a post-fix coherence audit.

Offer it when the user asks for a deep/comprehensive/multi-agent review, or when
the spec has grown past what one session can interrogate. After they approve
(plan mode), invoke:

```
Workflow({
  scriptPath: "W/routes/spec-grill/workflows/deep-review.js",
  args: {
    root: "<absolute repo root>",
    workspace: "P", // repo-relative; leave it out when P is .agents/plan
    // optional: context: "<project orientation + external source paths for reviewers>",
    // extraLenses: [{key, prompt}, ...]  e.g. fidelity-vs-<source>, feasibility-vs-<codebase>
    // applyFixes: true, default false (report-only); true trusts the fixers to edit the spec
    // rounds: 3, with applyFixes: re-review the changed files after fixing,
    //                     until a round confirms zero critical/major findings (max 3)
    // maxFindings: 60, cap the verified set per round by severity
  }
})
```

**Autonomous mode** is this workflow with `{applyFixes: true, rounds: 3}`, grill-until-dry. **Converged when** a re-review round over the changed files
confirms no critical or major finding. What stays gated: product decisions, fixers never invent them; anything needing one lands as an `**Open question:**`
block in the spec, which the interactive grill (or plan-decompose's decision routing)
then resolves with the user. Findings and fix reports come back for you to walk
through and hand off normally.

## Done when

A full pass over the target spec files raises no question the user hasn't
answered; every resolved term has a glossary entry; every design change landed
as a spec edit with bumped frontmatter; every surfaced contradiction has a named
losing file that was fixed; and `verify-spec-tree.mjs` exits 0.

## Hand off

When the spec is coherent and the vocabulary is sharp, point the user at
`spec-architect` to pressure-test the *system design* (depth, seams, leverage)
before any code exists, or at `plan-decompose` to start decomposing into work. If the
grilling surfaced that a whole area is underspecified, send them back to
`spec-write` to write it before planning.

## Without the Workflow tool

Where the session has no `Workflow()` tool, run the same phases with parallel
subagents instead, in the same order, with the parent session owning every
shared file and the status funnel:
[references/subagent-fallback.md](../../references/subagent-fallback.md) is
the contract, and it is what keeps an autonomous run there from quietly
becoming a different, unverified run.
