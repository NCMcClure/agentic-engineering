---
name: ladder
description: >
  Build code at the first rung that holds: YAGNI, reuse what's already in the
  codebase, stdlib, native platform, installed dep, one line, minimum that
  works. Use on any coding task (writing, adding, refactoring, fixing,
  designing, choosing dependencies), and whenever the user asks for the
  simplest or minimal solution or complains about over-engineering, bloat,
  boilerplate, or unnecessary dependencies. Not for non-code prose.
license: MIT
---

# ladder

The canonical home of the discipline: price every line at generation time and
stop climbing the moment a rung holds. Everything else in this plugin points
here. The distilled always-on form lives in the kernel block below, which
`${CLAUDE_PLUGIN_ROOT}/hooks/kernel_inject.py` injects at SessionStart and
SubagentStart; the numbered steps are the full procedure you run when you
build.

<!-- kernel:start -->
**Climb, stop at the first rung that holds:** (1) YAGNI, speculative need means
skip it and say so; (2) reuse what already lives in this codebase; (3) stdlib;
(4) native platform; (5) installed dependency; (6) one line; (7) only then the
minimum that works. Understand the real flow before climbing. A bug fix is root
cause not symptom: one guard where all callers route through beats one per
caller. Never cut trust-boundary validation, data-loss error handling,
security, or accessibility. Mark every deliberate shortcut with a comment
`debt: <ceiling>, <upgrade trigger>`. Output code first, then at most 3 lines:
`skipped: X, add when Y`.
<!-- kernel:end -->

The kernel is measured, not eyeballed. `scripts/ladder.py` extracts the block
between the two markers above and checks it stays under budget; keep it lean.

## Step 1: Understand first

The ladder shortens the solution, never the reading. Trace the real flow end to
end before picking a rung; a small diff in the wrong place is a second bug, not
laziness. For a bug fix, grep every caller of the function you are about to edit
so you fix the root cause once where all callers route through, not the one path
the ticket named.

*Done when: every file the change touches has been read, and the callers of any
function you intend to edit are enumerated.*

## Step 2: Climb

Stop at the first rung that holds:

1. **YAGNI**: does this need to exist at all? Speculative need means skip it and say so in one line.
2. **Already in this codebase**: a helper, type, or pattern a few files over; reuse it. Re-implementing what already lives here is the most common slop.
3. **Stdlib**: the standard library does it, use it.
4. **Native platform**: `<input type="date">` over a picker lib, CSS over JS, a DB constraint over app code.
5. **Installed dependency**: something already in the manifest solves it. Never add a new dep for what a few lines cover.
6. **One line**: if it collapses to one line, one line.
7. **Minimum that works**: only then, the least code that does the job.

Two rungs both hold, take the higher one and move on.

*Done when: the chosen rung is named in one line, and no lower rung would have sufficed.*

## Step 3: Build the minimum

No unrequested abstractions: no interface with one implementation, no factory
for one product, no config for a constant. No scaffolding "for later"; later
can scaffold for itself. Fewest files, boring over clever. Hardware is the one
place a minimal model lies: a real clock drifts and a sensor reads off, so leave
the calibration knob even when the paper math says you don't need it. The safety
carve-outs (trust-boundary validation, data-loss error handling, security,
accessibility) are never cut. If the user insists on the full version, build it,
no re-arguing.

*Done when: the diff contains nothing the task didn't require, and nothing from
the carve-out list was removed.*

## Step 4: Mark the debt

Every deliberate shortcut with a known ceiling gets a debt-marker comment naming
the ceiling and the upgrade trigger, e.g.
`# debt: global lock, per-account locks if throughput matters`. The marker
grammar has a single canonical home,
`${CLAUDE_PLUGIN_ROOT}/skills/debt/scripts/debt.py`; point at it, don't restate
the regex here.

*Done when: every known ceiling in the diff carries a marker whose trigger names
an observable condition.*

## Step 5: Leave one runnable check

Non-trivial logic (a branch, a loop, a parser, a money or security path) leaves
the smallest thing that fails if the logic breaks: an `assert`-based self-check
or one small test file. No frameworks, no fixtures. Trivial one-liners need no
check (YAGNI applies to tests too).

*Done when: the check has been run once and passes, and deleting the logic would
make it fail.*

## Step 6: Output

Code first, then at most three short lines saying what was skipped and when to
add it: `skipped: [X], add when [Y]`. Explanation the user explicitly asked for
(a report, a walkthrough) is exempt; the rule is only against unrequested prose,
where every paragraph defending a simplification is complexity smuggled back in.

*Done when: unrequested prose is at most 3 lines.*

## Maintenance

After editing this file, re-run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ladder/scripts/ladder.py`.
It prints `{"ok": true, ...}` and exits 0 when the kernel block is present and
within budget; it exits non-zero if the block is missing or over its token
budget (target and hard cap live in the script). Where this discipline comes from and what code-diet changed:
`references/provenance.md`.
