---
name: build-tdd
description: Test-driven development with a red-green-refactor loop, driven by a plan issue's acceptance criteria when one is in play. Use for test-first features and fixes, "red-green-refactor", or "implement this issue".
---

# build-tdd — red-green-refactor

## Implementing a plan issue

When the work is a plan issue (from `.plan/plan/`, typically the one
`build-next-issue` named as next), the issue gives you the test plan for
free:

- Its **acceptance criteria** are your behaviour list — one tracer bullet per criterion.
- Its **testing checkpoint** command is the gate the slice must pass to count as done.
- Its **spec anchors** (links into `.plan/spec/`) are the behavioural contract — read them so your tests assert what was *specified*, in the spec's vocabulary, not a guess.

Work the red-green loop below until every acceptance criterion is satisfied and
the testing checkpoint passes. Then run the status funnel — `python
.plan/plan/plan-status.py set EE-SS-II done` (e.g. `01-03-07`) — which flips the
issue's `Status:`, ticks its acceptance boxes, rolls the change up through the
sprint/epic tables and fields and the plan index, and syncs the tracker, all in
one step. Don't hand-edit any `Status` field. Then hand back to
`build-next-issue` to verify completion and name what's next. If, mid-implementation, the spec turns out to be wrong or
ambiguous, stop and route the change through `plan-6-edit` rather than quietly
diverging from it — the spec stays the source of truth.

When there's no `.plan/` workspace, ignore this section and use the plain
red-green-refactor loop below.

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

See [TESTS.md](TESTS.md) for examples and [MOCKING.md](MOCKING.md) for mocking guidelines.

## Anti-pattern: horizontal slices

**Never write all tests first, then all implementation.** That is horizontal slicing — treating RED as "write all tests" and GREEN as "write all code."

It produces brittle tests:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

When exploring the codebase, use the project's domain glossary so that test names and interface vocabulary match the project's language, and respect ADRs in the area you're touching. If a `.plan/` workspace exists, that glossary is `.plan/spec/reference/glossary.md`; the ADRs are in `.plan/spec/reference/adr/`.

Before writing any code:

- [ ] Confirm with user what interface changes are needed
- [ ] Confirm with user which behaviors to test (prioritize)
- [ ] Identify opportunities for **deep modules** — small interface, deep implementation; the suite's canonical architecture vocabulary lives in [plan-3-architect-spec's LANGUAGE.md](../plan-3-architect-spec/LANGUAGE.md), shared rather than duplicated here
- [ ] Design interfaces for testability: **accept dependencies** (don't construct them inside), **return results** (don't mutate arguments as side effects), **small surface** (fewer methods and params = simpler tests)
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get user approval on the plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

**You can't test everything.** Confirm with the user exactly which behaviors matter most. Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet - proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for [refactor candidates](REFACTORING.md):

- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Consider what new code reveals about existing code
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

## Checklist per cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```

## Done when

For a plan issue: every acceptance criterion maps to a named passing test; the
issue's testing-checkpoint command exits 0; status was flipped through
`plan-status.py set EE-SS-II done` (never hand-edited); and control is handed
back to `build-next-issue` to verify completion and name what's next. Without a
`.plan/` workspace: every behaviour agreed in Planning has a passing test and
the refactor pass left the suite green.
