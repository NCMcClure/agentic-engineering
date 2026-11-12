---
name: grill
description: >
  Interview: one question at a time, each with a recommended answer, until
  intent, done criteria, scope and risks are agreed. Use before planning or
  building anything not fully specified, before handing work off, and after a
  round of work to reflect.
---

# grill: agree on the work before anyone builds it

A request nobody pinned down comes back as the wrong thing, and a session
working alone cannot ask. This skill pins it down first, by interview, and
leaves a brief short enough to read and exact enough to check.

## Method

- **One question at a time.** Ask it, then wait for the answer before the next.
- **Recommend an answer every time.** "I'd pick X, because Y. Yes, or something
  else?" You are a sparring partner with opinions, not a survey.
- **Read before asking.** If the code, the docs, the card, or the spec answers a
  question, read it and say what you found. Ask only what reading cannot settle.
- **Walk the decision tree in order.** Settle a decision other decisions depend
  on before the ones that follow from it. When an answer undoes an earlier one,
  say so and reopen that one.
- **Stop when no open question would change what gets built.**

## What it ends with

Write this down, read it back, and get a yes before treating it as agreed:

- **Intent:** the outcome and who it is for, in a sentence or two.
- **Done criteria:** a checklist where each item names how to check it (a
  command, a file, an observable behavior).
- **Out of scope:** what a reader might assume is included and is not.
- **Risks:** what could go wrong or is still unknown, and what would show it early.
- **Files likely touched:** by path, from reading the repo.
- **Tests:** which of the repo's test commands cover it, and what no test
  reaches. If agentic-teamwork is installed, name the lanes of
  `/agentic-teamwork:tdd` and say which are not wired.

When the work goes to a session you will not watch, the brief is all that
session has. Hold it to this bar: a stranger could build the work and check it
from the brief alone.

## Where the outcome goes

- **A card or issue exists for the task:** into its body.
- **The work is on the spec route** (`.agents/plan/spec/` exists and the
  answers change what the spec says): through `/but-first-planning:spec-edit`, which keeps
  the plan and the tracker in step. Grilling the spec itself is `spec-grill`.
- **Neither:** a short summary in the conversation.

## Reflect mode

Run it after a merge or a round of work. Start from what happened: read the
card or issue, the pull or merge request, and the CI history, and list where
the work deviated from the plan. Review rounds, a red pipeline, an owed check
(a test the task should have run and did not), scope that moved.

Then ask one or two questions about the causes a better brief would have
removed, each with your recommended answer. Turn the answers into one of two
things, and say which:

- **Follow-up tasks**, one per piece of work the deviation left behind.
- **A change to how the next task is briefed:** a sharper done criterion, a test
  named up front, a risk raised earlier.
