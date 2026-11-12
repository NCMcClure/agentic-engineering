---
name: ladder
description: >
  Build at the first rung that holds: YAGNI, reuse what the repo already has,
  stdlib, native platform, installed dependency, one line, the minimum that
  works. Use on any coding task (writing, adding, refactoring, fixing, choosing
  a dependency) and whenever the user asks for the simplest solution or
  complains about bloat, boilerplate, or over-engineering. To check what
  already exists before building use reuse-first; to audit shortcuts already
  in the tree use debt. Not for prose.
---

# ladder

The discipline: price every line at generation time and stop climbing the moment a rung holds. The always-on form is the one ladder line in `hooks/critical.json`, which the session hook keeps in context; this skill is the full procedure.

## Step 1: Understand first

The ladder shortens the solution, never the reading. Trace the real flow end to end before picking a rung; a small diff in the wrong place is a second bug, not efficiency. For a bug fix, enumerate every caller of the function you are about to edit so you fix the root cause once where all callers route through, not the one path the report named.

*Done when: every file the change touches has been read, and the callers of any function you intend to edit are listed.*

## Step 2: Climb

Stop at the first rung that holds.

1. **YAGNI.** Does this need to exist at all? Speculative need means skip it and say so in one line.
2. **Reuse.** A helper, type, or pattern a few files over in this repo, then the other checkouts the person has listed (a shared component library, a sibling service). Run `/code-diet:reuse-first <thing>` when you are not sure; re-implementing what already exists is the expensive kind of slop, because it also has to be maintained.
3. **Stdlib.** The standard library does it, use it.
4. **Native platform.** A date input over a picker library, CSS over JS, a database constraint over application code.
5. **Installed dependency.** Something already in the manifest solves it. Never add a dependency for what a few lines cover.
6. **One line.** If it collapses to one line, one line.
7. **Minimum that works.** Only then, the least code that does the job.

Two rungs both hold: take the higher one and move on.

*Done when: the chosen rung is named in one line and no higher rung would have sufficed.*

## Step 3: Build the minimum

No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a constant, no scaffolding for later. Fewest files, boring over clever. Hardware is the one place a minimal model lies: a real clock drifts and a sensor reads off, so leave the calibration knob even when the paper math says you do not need it. The carve-outs are never cut: trust-boundary validation, data-loss error handling, security, accessibility. If the user asks for the full version anyway, build it without re-arguing.

*Done when: the diff contains nothing the task did not require, and nothing from the carve-out list was removed.*

## Step 4: Mark the debt

Every deliberate shortcut with a known ceiling gets a comment `debt: <ceiling>, <trigger>`, where the trigger is an observable condition: `# debt: global lock, per-account locks if throughput matters`. The grammar has one home, `${CLAUDE_PLUGIN_ROOT}/scripts/debt.mjs`; do not restate the regex.

*Done when: every known ceiling in the diff carries a marker whose trigger names something you could observe.*

## Step 5: Leave one runnable check

Non-trivial logic (a branch, a loop, a parser, a money or security path) leaves the smallest thing that fails if the logic breaks: a test under the project's own test command where it has one, an assert-based self-check where it does not. No new framework, no fixtures. With agentic-teamwork installed, `/agentic-teamwork:tdd` says which lane it belongs in. Trivial one-liners need none.

*Done when: the check has been run once and passes, and deleting the logic would make it fail.*

## Step 6: Output

Code first, then at most three short lines: `skipped: X, add when Y`. Explanation the user asked for is exempt; the rule is against unrequested prose, where every paragraph defending a simplification is complexity smuggled back in.

*Done when: unrequested prose is at most three lines.*

## Where it comes from

`references/provenance.md` records what this discipline inherited and what changed.
