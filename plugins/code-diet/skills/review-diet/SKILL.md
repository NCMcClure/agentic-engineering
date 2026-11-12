---
name: review-diet
description: "Hunt over-engineering in the working diff (pass `repo` to widen to the whole tree): review-scan.mjs locates cut candidates deterministically, you judge only the flagged spots, one line per finding with file:line, the cut, and the replacement; `--apply` lands each confirmed cut as its own commit behind validate-or-revert. Use before opening a pull or merge request, or when a diff feels bloated. Correctness bugs and security holes are out of scope here; the ladder is what stops the bloat being written in the first place."
argument-hint: "[repo] [--base <ref>] [--apply]"
---

# review-diet

One question: can this get shorter without losing anything? Correctness bugs and security holes are a different pass; if you find one, note it and keep the verdict separate.

## Step 1: Scope and scan

Default scope is the working diff: staged, unstaged, and untracked, against HEAD. `--base <ref>` measures against another commit instead (the branch point, when the work is already committed). The argument `repo` widens it to the whole tree. Note whether `--apply` was passed.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/review-scan.mjs" --scope diff|repo [--base <ref>]
```

Parse the JSON: `candidates` are locators, `diff` the change's stats, `counts` the tally per kind. Signals locate; you judge. Never re-derive a count, a diff stat, or the net-lines math in prose: the numbers are the script's.

*Done when: the script exited 0 and its JSON is parsed. On a non-zero exit, report the git error and stop.*

## Step 2: Judge each candidate

For every locator, decide **cut** or **keep** using the row in `references/signals.md` that matches its `kind`. Read the code before deciding; the scanner is a locator and it has known blind spots (dynamic registration, a framework calling a handler by name, a symbol exported for another package).

Two hard exceptions, every run. Never propose cutting a **safety guard** (trust-boundary validation, data-loss error handling, security, accessibility) or the **one runnable check** a piece of logic leaves behind.

*Done when: every candidate has an explicit cut or keep verdict.*

## Step 3: Report

One line per cut:

```
<file>:L<line>: <tag> <what to cut>. <what replaces it>.
```

Tags:

- `delete:` dead code, unused flexibility, a speculative feature. Replacement: nothing.
- `stdlib:` a hand-rolled thing the standard library ships. Name the function.
- `native:` a dependency or code doing what the platform already does. Name the feature.
- `yagni:` an abstraction with one implementation, config nobody sets, a layer with one caller.
- `shrink:` the same logic in fewer lines. Show the shorter form.

Close with the net figure: sum the `span` of the cuts you accepted and print `net: -<N> lines possible.` If nothing survives as a cut, output exactly `Lean already. Ship.` and stop.

*Done when: every line carries file:line, a tag, the cut, and the replacement, and the closing line is the net figure or the lean verdict.*

## Step 4: Apply, only with `--apply`

Each confirmed cut lands as its own commit, checked while it is the only change in the tree, so a red one costs exactly one cut. The git half belongs to `review-scan.mjs --apply`; never compose a `git reset`, `git clean`, or `git stash` here yourself.

With a workflow tool in the session, dispatch the workflow and let it own the protocol:

```
${CLAUDE_PLUGIN_ROOT}/skills/review-diet/workflows/review.js
```

Its args: `{root, scan, findings: [{file, line, tag, cut, replacement, spanLines}], scope, predictedNet}`, where `scan` is the absolute path of `${CLAUDE_PLUGIN_ROOT}/scripts/review-scan.mjs` and `spanLines` is the candidate's `span`.

Without one, run the same protocol by hand, from the repo root:

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-scan.mjs" --apply begin` prints the base commit and the untracked files nothing may touch. It exits 1 while tracked files carry uncommitted changes, because a cut landed over them would carry them into its commit: ask the person to commit or stash, then continue from here. The findings from step 3 still stand.
2. Find the repo's own checks: the `unit` lane in `.agents/manifest.json` when the repo has one, otherwise the test and lint commands its manifests name. Run each once before any cut. One that is red now cannot judge a cut: leave it out and say so.
3. Per confirmed cut, in order: make the one edit, then `--apply check <file>... --check "<command>"...`. On `green`, `git add` those files only and commit `code-diet: <tag> <what> (<file>)`. On red, read the `tail`, try one surgical repair (an import the cut orphaned, a caller it left dangling) and check again; still red, `--apply revert <file>...` and move to the next cut.
4. `--apply report --base <the base from 1>` prints the realized totals.

Report per cut what actually happened: `applied and green`, `applied, not validated` (no check could run), or `reverted: <reason>`. Print the realized net beside the predicted one from step 3. Realized, never predicted, is the number that gets reported as fact.

*Done when: every confirmed cut is accounted for as applied or reverted-with-reason, and the realized net is printed beside the predicted one.*
