---
name: tdd
description: >
  Red, green, refactor over this repo's four test lanes (unit, integration,
  e2e, live), with the lane commands read from the marker rather than guessed.
  Use when writing or changing tests, when a change needs a failing test
  first, when wiring a new repo's lanes, or when deciding what to mock and
  what to run for real.
---

# tdd

One loop, four lanes, and a rule about which lane a check belongs in. The lane commands for this repo are `lanes` in `.agents/manifest.json`, which the session briefing names; read them before running anything, and never invent a command. `node .agents/scripts/lane.mjs <lane>` runs one by name and says so when a lane is not wired. A repo with no marker uses its own test command; if it has none, say so.

## The loop

1. **Red.** Write the smallest test that fails for the right reason. Run it and read the failure: a test that fails because of a typo or a missing import has proved nothing. The failure message is the first thing the test is judged on.
2. **Green.** The least code that passes. If code-diet is installed, `/code-diet:ladder` says how little that is.
3. **Refactor.** Only with the lane green. Structure the code, not the behavior; the tests do not change in this step. `references/refactoring.md` lists what to look for.

Repeat per behavior, not per file: one test, one implementation, then the next. Writing every test first and every implementation after tests the shape you imagined, not the behavior you found. One logical assertion per test.

## Choosing the lane

Read `references/lanes.md` for the full table and for what makes a test worth keeping in any lane. The short form:

- **unit**: pure logic, no I/O, milliseconds. Most tests live here.
- **integration**: real database, real filesystem, real HTTP inside the process. Opt-in behind an environment flag so a laptop without Docker still passes.
- **e2e**: a browser against a built server the test runner starts itself. The one process allowed to start the server; never start it by hand for a test.
- **live**: a real model, opt-in, structural assertions only. Needed in any repo that calls a model: `references/live-lane.md` has the pattern, including the per-turn budget and why assertions never touch wording.

A repo that calls a model and has no live lane has a gap its tests cannot see. `/agentic-teamwork:audit-project` reports it.

## What to mock

Mock at system boundaries only: external APIs, time, randomness, sometimes the filesystem. Never mock your own modules or internal collaborators: a test that asserts on a call to a function you own breaks on every refactor and proves nothing about behavior. `references/mocking.md` has the design that makes boundaries mockable, and `references/scripted-model.md` is the boundary mock for a model, including the fixture schema.

## Before you finish

Run the lanes the change touched and say which ones ran. "Tests pass" without naming the lane is the claim that hides a vacuous run: a suite that never selected the changed file passes trivially. When a lane could not run (no Docker, no credentials), say that instead of implying it did.

*Done when: the lanes that cover the change have been run by name, and every new behavior has a test that fails without it.*
