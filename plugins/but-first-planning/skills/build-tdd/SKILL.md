---
name: build-tdd
description: >
  Builds one plan issue test-first: acceptance criteria become failing tests
  one at a time, the checkpoint is the gate, the status funnel records the
  result. Use when implementing a plan issue.
---

# build-tdd

One plan issue, built test-first. This skill owns the half that is specific to
a plan issue: where the tests come from, what counts as the gate, and how the
funnel records the result.

## The loop

**If agentic-teamwork is installed, the loop is its `tdd` skill**
(`/agentic-teamwork:tdd`): red, green, refactor, the repo's test lanes and
their commands, what to mock and what to run for real, and the refactor
candidates. Read that skill and run its loop; come back here for the
plan-issue contract around it.

**If it is not, this is the loop:**

1. **Red.** Write the one smallest test for the next criterion. Run it and
   read the failure: a test that fails on a typo or a missing import has
   proved nothing.
2. **Green.** The least code that passes it. Nothing for a criterion the
   issue does not carry.
3. **Refactor.** Only while green, and the tests do not change in this step:
   extract duplication, move complexity behind a smaller interface, run the
   tests after each step.

Repeat per criterion, never all the tests first and all the code after:

```
WRONG:  RED test1 test2 test3   then  GREEN impl1 impl2 impl3
RIGHT:  test1 -> impl1,  test2 -> impl2,  test3 -> impl3
```

Tests written in bulk test the shape you imagined, not the behaviour you
found, and they pass when the behaviour breaks.

- Test behaviour through the public interface. A test that breaks when you
  rename an internal function was testing the implementation.
- Mock at system boundaries only (an external API, time, randomness,
  sometimes the filesystem). Never mock a module you own.
- Design for it: accept dependencies instead of constructing them, return
  results instead of mutating arguments, keep the surface small.
- Run the project's own test command and say which one ran. If the project
  has none, say so instead of implying a run.

## What the issue gives you

The issue file under `.agents/plan/plan/` (usually the one `build-next-issue`
named as next) is the test plan:

- Its **acceptance criteria** are the behaviour list. One tracer bullet per
  criterion, in order.
- Its **testing checkpoint** command is the gate the slice must pass to count
  as done. Run the literal command from the issue; do not substitute a
  broader or narrower one.
- Its **spec anchors** (links into `.agents/plan/spec/`) are the behavioural
  contract. Read them before writing the first test, so the assertions say
  what was specified, in the spec's vocabulary, rather than a guess at it.
- The project's **glossary** (`.agents/plan/spec/reference/glossary.md`) and
  **ADRs** (`.agents/plan/spec/reference/adr/`) set the names. A test whose
  vocabulary disagrees with the glossary is a rename waiting to happen.
- A criterion about how something **looks or sounds** is not a unit assertion
  on bytes or a threshold picked by hand. If perceptual-loop is installed, use
  it to prove the criterion on the few shots that show it; otherwise capture
  the surface, look at the capture, and say that a person still has to judge
  it.

Build the first thing that satisfies the criterion and nothing speculative
beside it (if code-diet is installed, `/code-diet:ladder` is that
discipline). The architecture vocabulary for a deep module is in
[spec-architect's LANGUAGE.md](../spec-architect/LANGUAGE.md).

If the spec turns out to be wrong or ambiguous mid-implementation, stop and
route the change through `spec-edit` rather than quietly diverging from it.
The spec stays the source of truth.

## Hubs, in the same change

A directory you create gets placed per the spec's `repository-layout.md`, and
if it makes its parent non-leaf that parent gets an `AGENTS.md` hub, one line
per direct child. A directory whose contents you changed gets its governing
hub updated in the same change, not as follow-up. No source file lands beside
an `AGENTS.md`. Where the root has a `CLAUDE.md` that imports `AGENTS.md`, a
new hub gets the same sibling (a `CLAUDE.md` whose whole content is
`@AGENTS.md`). The rules are in
[spec-write's CODEBASE-LAYOUT.md](../spec-write/CODEBASE-LAYOUT.md); if
agent-works is installed, its hub check verifies them.

## Recording the result

When every acceptance criterion is satisfied and the checkpoint exits 0, run
the funnel:

```bash
node .agents/plan/plan/plan-status.mjs set EE-SS-II done
```

It flips the issue's `**Status**`, ticks its acceptance boxes, rolls the
change up through the sprint and epic tables and fields and the plan index,
and moves the issue's ticket on the tracker, in one step. Never hand-edit a
`Status` field or a table cell.

Note the deliberate omission: a builder flips status **without**
`--evidence`. The evidence argument writes the verified-complete ledger, and
only `build-next-issue`'s independent verification is allowed to do that. A
builder that writes its own ledger row has verified nothing.

Then hand back to `build-next-issue`, which verifies the completion claim and
names what is next. When the issue is built on its own branch and lands as
its own change request, make the flip the last commit before it ships, so
the issue reads done on the base branch when the change merges and not
before.

## Done when

Every acceptance criterion maps to a named passing test; the issue's
testing-checkpoint command exits 0; the tests that cover the change were run
and named; the hubs your change touched are current; an issue whose
`**User-facing**` line says `yes` changed its end-user pages and retook its
screenshots in this same change (`/docs-parity:docs-sync` if docs-parity is
installed, by hand per the spec's `user-docs-plan.md` otherwise), or the
commit says `Docs: none, <why>`; status was flipped through the funnel
without `--evidence`; and control is back with `build-next-issue`.
