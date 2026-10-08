---
name: calibrate-gate
description: "Noise and tolerances of the perceptual gate. Use when a gate fails on something untouched, numbers wobble between identical runs, or a baseline is accepted."
---

# calibrate-gate

A gate is only as good as its tolerances. Too tight and agents learn to accept failures; too loose and it catches
nothing. Tolerances are **measured**, never chosen. Shapes: `${CLAUDE_PLUGIN_ROOT}/core/references/contract.md`
§ baseline.json.

## Step 1 — Measure the spread

Render the same shots several times with **no change in between** (the smoke group is a good sample; six runs
separate noise from bistability), each into its own run:

```
PL_RUN="verify: calibration, no change between runs" \
  uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/iterate.py" --group smoke --run cal --repeat 6
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/calibrate.py" --runs cal1 cal2 cal3 cal4 cal5 cal6
```

It prints, per metric class (`<source>/frame.ssim`, `<source>/region.*.edgeF1`, …), the largest spread and a
proposed tolerance (the spread times a margin, with a floor), and lists **bistable** entries: single values that
take one of two levels from run to run.

A large spread everywhere is not a tolerance problem, it is a determinism problem: go back to `build-harness` (`${CLAUDE_PLUGIN_ROOT}/skills/build-harness/SKILL.md`)
step 2 before widening anything.

*Done when: `calibrate.py` printed a largest spread and a proposed tolerance for every metric class, from at least
three runs, and no class's spread exceeds the smallest change the gate must catch (else: `build-harness` step 2).*

## Step 2 — Write tolerances with their evidence

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/calibrate.py" --runs cal1 … cal6 --write-tolerances
```

Tolerances go per class, not per shot. A class whose spread is driven by one or two bistable entries keeps its tight
tolerance; those entries get their own measured allowance instead:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/calibrate.py" --runs cal1 … cal6 --write-spread
```

The note written beside each tolerance says what was measured (runs, shots, date). A tolerance without a note is a
guess: do not add one by hand without measuring.

*Done when: `baseline.py tolerances show` lists every class with a note, and no class was widened to hide one entry.*

## Step 3 — A gate failure on a change that touched no pixel

In this order, stopping at the first that explains it:

1. **Render that shot again.** If it passes, it was noise: note the entry; if it flips repeatedly, give it a
   measured `spread` (step 2). Never accept a new value for an entry your change cannot have reached.
2. **First render after an import, a rebuild or a cold cache?** Assets may not have been ready. The second run is
   the one that counts.
3. **Stale?** The baseline may have been off before your work. Check on the unchanged main branch (a clean
   checkout or a stash-free worktree; never by discarding someone's changes):

   ```
   uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/baseline.py" stale --source <candidate> --run <run-made-on-main>
   ```

   Entries it lists are `stale`: report them as such, update them in a separate, labelled step, and do not count
   them against your change.
4. **Otherwise it is an effect of your change** you did not intend: look at the shot (`iterate` step 3).

*Done when: every entry beyond tolerance is labelled noise, not-ready, stale or real, with what showed it.*

## Step 4 — Accept, targeted

Accept new values only for the shots the work changed, for one source, from a run that used the standard region
source:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/baseline.py" update --source <candidate> --shots a,b,c --run <run>
```

List the accepted shots in the report, with the direction each headline number moved and the verdict that justifies
it ("moved away from the reference: `more-correct`, because …"). Then run `smoke` once more.

*Done when: the update printed how many entries changed, nothing outside the named shots changed, and the next
smoke run passed.*
