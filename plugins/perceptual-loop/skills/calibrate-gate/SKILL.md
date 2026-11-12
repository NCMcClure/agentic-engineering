---
name: calibrate-gate
description: "Use when a perceptual gate fails on something untouched, numbers wobble between identical runs, or a baseline is about to be accepted. Measures noise into tolerances."
---

# calibrate-gate

A gate is only as good as its tolerances. Too tight, and agents learn to accept failures; too loose, and it catches nothing. Tolerances are **measured**, never chosen. Shapes: `${CLAUDE_PLUGIN_ROOT}/references/contract.md`, the baseline.json section.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`.

## Step 1: Measure the spread

Render the same shots several times with **no change in between** (the smoke group is a good sample; six runs separate noise from a flip between two values), each into its own run:

```
PL_RUN="verify: calibration, no change between runs" P iterate --group smoke --run cal --repeat 6
P calibrate --runs cal1,cal2,cal3,cal4,cal5,cal6
```

It prints, per metric class (`<source>/frame.ssim`, `<source>/region.*.edgeF1`, and so on), the largest spread and a proposed tolerance (the spread times a margin of 2.5, never under the class's floor), and lists **bistable** entries: single values that take one of two levels from run to run.

A tolerance measured while another job ran is too wide. Look at the processor and GPU load before the runs, wait if another job is running, and write what you saw beside the numbers.

A large spread everywhere is not a tolerance problem; it is a determinism problem. Go back to `shot-harness` step 2 (`${CLAUDE_PLUGIN_ROOT}/skills/shot-harness/SKILL.md`) before widening anything.

*Done when: calibrate printed a largest spread and a proposed tolerance for every metric class, from at least three runs, and no class's spread exceeds the smallest change the gate must catch (else: `shot-harness` step 2).*

## Step 2: Write the tolerances with their evidence

```
P calibrate --runs cal1,...,cal6 --write-tolerances
```

Tolerances go per class, not per shot. A class whose spread comes from one or two bistable entries keeps its tight tolerance, and those entries get a measured allowance of their own (1.5 times their spread):

```
P calibrate --runs cal1,...,cal6 --write-spread
```

The note written beside each tolerance says what was measured (runs, shots, date). A tolerance without a note is a guess: never set one by hand without measuring (`P baseline tolerances set` refuses one without `--note`).

*Done when: `P baseline tolerances show` lists every class with a note, and no class was widened to hide one entry.*

## Step 3: A gate failure on a change that touched no pixel

In this order, stopping at the first that explains it:

1. **Render that shot again.** If it passes, it was noise: note the entry; if it flips repeatedly, give it a measured spread (step 2). Never accept a new value for an entry your change cannot have reached.
2. **The first render after an import, a rebuild, or a cold cache?** Assets may not have been ready. The second run is the one that counts.
3. **Stale?** The baseline may have been off before your work. Make a run from the unchanged main branch, in a separate worktree (never by discarding anyone's changes), and gate it:

   ```
   P baseline stale --source <candidate> --run <run-made-on-main>
   ```

   The entries it lists are `stale`: report them as such, update them in a separate, labelled step, and do not count them against your change. If that step cannot happen now, owe it where the next session finds it: a line at the top of the report, or the task board if agent-works is installed.
4. **Otherwise it is an effect of your change** you did not intend: look at the shot (`iterate-shots` step 3).

*Done when: every entry beyond tolerance is labelled noise, not ready, stale, or real, with what showed it.*

## Step 4: Accept, targeted

Accept new values only for the shots the work changed, for one source, from a run that used the configured region source:

```
P baseline update --source <candidate> --run <run> --shots a,b,c
```

List the accepted shots in the report, with the direction each headline number moved and the verdict that justifies it ("moved away from the reference: `more-correct`, because ..."). Then run `smoke` once more.

*Done when: the update printed how many entries changed, nothing outside the named shots changed, and the next smoke run passed.*
