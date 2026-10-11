---
name: probe-the-source
description: "Triangulation of a difference between candidate and reference. Use when a colour, brightness, shape or timing differs and the cause is unknown, or before implementing a rule guessed from pictures."
---

# probe-the-source

Two failures this skill prevents: fixing the candidate to match a flaw of the reference, and implementing a rule
fitted to a few pictures that breaks on the next one. Doctrine rules 3 and 4
(`${CLAUDE_PLUGIN_ROOT}/core/references/doctrine.md`).

## Step 1 — State the difference as a question about one thing

"The paint is less saturated than in the reference" → "what colour is this paint?". One surface, one lamp, one
sound, one moment. Crop it so there is no doubt what is meant:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/sheet.py" crop <shot> --box x0,y0,x1,y1 --zoom 3
```

*Done when: the question names one thing and a crop shows it in both sources.*

## Step 2 — Triangulate, in this order

1. **What the source says.** The asset's own values: the texture's texels and colour space, the material's
   parameters, the design token, the spec's number, the recorded signal. Read them from the file, not from a
   render. Write the values down.
2. **What the candidate presents for it.** The helper pass that isolates it (the `albedo` pass for a surface
   colour, the `id` pass for coverage, a value read back from the running candidate, a log line). Does the
   candidate show the source's value?
3. **Why the reference differs.** Its own processing: grading, tone mapping, a hotter light on this class of object,
   bloom, a different sampling of alpha, an older asset. Find the mechanism, not a correction factor.

Then the verdict follows: the candidate misrepresents the source → `wrong`, fix the candidate. The candidate is
faithful and the reference adds something → `more-correct` or `different-ok`: record the evidence and close the
item. The mechanism is something a viewer expects to see (bloom on a lamp) → the candidate lacks an **effect**:
build the effect, do not bake its result into the asset's value.

*Done when: all three are written with their evidence (file and value, pass and pixel value, mechanism), and the
item has a verdict.*

## Step 3 — When the rule itself is unknown: probe the reference system

If the reference is a running system and the question is "how does it decide this?" (when does a lamp light, how
strong is an overlay, which model is drawn at what distance), **read the rule out of it**:

- a value read back per frame through whatever scripting or debug surface the system has (a shader parameter, a
  state flag, an object's visibility);
- its own log lines and data files (configuration that names the rule's inputs and constants);
- an A/B in the reference itself: the same instant with one setting on and off, captured as two shots.

Write the probe as a small tool the project keeps (it will be needed again), record what it measured (inputs,
outputs, how many samples, over what range), and implement **the rule it shows**, shared by every candidate. Where
the system gives no rule and you choose one, say plainly that it is yours, name its constants, and queue it for the
owner (`judge-and-queue`).

A probe that needs no launch (it reads files) is cheapest: write those first. A probe that launches the reference
application takes its turn on it like any other run. Locks on scarce applications are agent-works' job
(`agent-works:coordinate` / `aw lock run <resource> -- <command>`). Without it: make sure by hand that no other
agent is using the application, and never start a second instance beside the owner's own.

*Done when: the rule is stated with its inputs and constants, each marked measured (with the probe's numbers) or
our own, and a test holds it.*

## Step 4 — Distrust "cannot be read"

A note saying a value cannot be read from the reference system is a claim with a date. Before building a stand-in
on it, spend one bounded attempt re-checking, with a different surface than the one that failed. Record the result
either way, with what was tried.

*Done when: the claim is confirmed with what was tried, or replaced by the reading.*

## Step 5 — Record

One short entry: the question, the three findings, the verdict, the probe's location. Next time the same class of
difference appears, the answer is a lookup. Keeping a project's memory is agent-works' job (`agent-works:memory` /
`aw memory new`): use it when the project has `.agents/memory`. Without it: write the entry where the project
keeps its notes, and say in your report where that is.

*Done when: the entry exists in the project's memory or notes and names the probe's file.*
