---
name: review
description: "Over-engineering review of the working diff (pass `repo` to widen to the whole tree): scripts/review.py locates cut candidates deterministically, the model judges only the flagged spots, one line per finding with file:line, cut, and replacement; `--apply` lands each confirmed cut as its own commit behind a validate-or-revert loop."
disable-model-invocation: true
argument-hint: "[repo] [--apply]"
---

# review

Hunt over-engineering, nothing else: the diff's best outcome is getting
shorter. `scripts/review.py` locates cut candidates deterministically; you
judge only the flagged spots. Correctness bugs and security holes are out of
scope here: route them to a normal review pass.

## Step 1 — Scope and signals

Parse the args: default scope is the working diff; `repo` widens to the whole
tree; note whether `--apply` was passed. Then run the scanner:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/review/scripts/review.py --scope diff|repo
```

Parse its JSON. `candidates` are the locators, `diff` the change's stats,
`counts` the per-kind tally. Signals locate; you judge. Never re-derive counts,
diff stats, or net-lines math in prose: the numbers are the script's.

*Done when: review.py exited 0 and its JSON is parsed. On non-zero exit, report
the git error from stderr and stop.*

## Step 2 — Judge each candidate

For every locator in `candidates`, decide **cut** or **keep** using the
per-kind judgment tests in `references/signals.md` — read the row matching the
candidate's `kind` (what makes a single-caller wrapper legitimate, when a dep
beats stdlib, which dead flags are documented interfaces).

Hard exceptions, every run: never flag for deletion a **safety guard**
(trust-boundary validation, data-loss error handling, security, accessibility)
or a **single smoke test / assert self-check**. If judging a candidate surfaces
a correctness bug or security hole, that is out of scope: note it for a normal
review and keep the candidate's over-engineering verdict separate.

*Done when: every candidate in the JSON has an explicit cut/keep verdict.*

## Step 3 — Report

One line per cut, in this shape:

```
<file>:L<line>: <tag> <what to cut>. <replacement>.
```

Tags (the inherited vocabulary):

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

Close with the net figure: sum the `~N lines` spans the script reported for the
cuts you accepted, and print `net: -<N> lines possible.` If nothing survives as
a cut, output exactly `Lean already. Ship.` and stop.

*Done when: every finding line carries file:line + tag + cut + replacement, and
the closing line is either the net figure or the lean verdict.*

## Step 4 — Apply (only when `--apply`)

Dispatch the workflow with the confirmed findings from step 3 and the scope:

```
${CLAUDE_PLUGIN_ROOT}/skills/review/workflows/review.js
```

The workflow owns the whole safety protocol (base SHA capture, protected
untracked set, per-cut validate/repair/revert). Do not hand-apply cuts in this
mode. When it returns, report per cut what it *realized* — `applied and green`
or `reverted: <reason>` — predicted vs realized, never "possible", and print the
realized net-lines total beside the predicted one from step 3.

*Done when: every confirmed cut is accounted for as applied-and-green or
reverted-with-reason, and the realized net total is reported next to the
predicted one.*
