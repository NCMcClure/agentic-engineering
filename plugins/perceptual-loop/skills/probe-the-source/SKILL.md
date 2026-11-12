---
name: probe-the-source
description: "Use when a colour, brightness, shape, or timing differs from the reference and the cause is unknown, or before implementing a rule guessed from pictures."
---

# probe-the-source

This skill prevents two failures: fixing the candidate to match a flaw of the reference, and implementing a rule fitted to a few pictures that breaks on the next one. It applies doctrine rules 3 and 4 (`${CLAUDE_PLUGIN_ROOT}/references/doctrine.md`): find what is true before deciding which picture is wrong.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`.

## Step 1: Ask about one thing

"The paint is less saturated than in the reference" becomes "what colour is this paint?". One surface, one lamp, one sound, one moment. Crop it, so nobody can doubt what is meant:

```
P sheet crop <shot> --box x0,y0,x1,y1 --zoom 3
```

*Done when: the question names one thing, and a crop shows it from every source.*

## Step 2: Triangulate, in this order

1. **What the source says.** The asset's own values: the texture's texels and its colour space, the material's parameters, the design token, the number in the spec, the recorded signal. Read them from the file, not from a render, and write them down.
2. **What the candidate presents for it.** The helper pass that isolates it (`albedo` for a surface colour, `id` for coverage), a value read back from the running candidate, a log line. Does the candidate show the source's value?
3. **Why the reference differs.** Its own processing: grading, tone mapping, a hotter light on this kind of object, bloom, another way of sampling alpha, an older asset. Find the mechanism, not a correction factor.

Then the verdict follows:

| What you found | Verdict | Next |
| --- | --- | --- |
| The candidate misrepresents the source | `wrong` | fix the candidate |
| The candidate is faithful and the reference adds or loses something | `more-correct` or `different-ok` | record the evidence and close it |
| The reference shows an effect a viewer expects (bloom on a lamp) and the candidate lacks it | `less-plausible` | build the effect; never bake its result into the asset's value |

*Done when: all three are written with their evidence (a file and a value, a pass and a pixel value, a mechanism), and the difference has a verdict.*

## Step 3: When the rule itself is unknown, probe the reference system

If the reference is a running system and the question is how it decides (when a lamp lights, how strong an overlay is, which model is drawn at which distance), read the rule out of it:

- a value read back per frame through whatever scripting or debug surface it has (a shader parameter, a state flag, an object's visibility);
- its own log lines and data files, which name the rule's inputs and constants;
- an A/B inside the reference: the same instant with one setting on and off, captured as two shots.

Write the probe as a small tool the project keeps (it will be needed again), record what it measured (the inputs, the outputs, how many samples, over what range), and implement **the rule it shows**, shared by every candidate. Where the system gives no rule and you choose one, say plainly that it is yours, name its constants, and queue it for the owner (`judge-and-queue`).

A probe that only reads files costs least: write those first. A probe that launches the reference application takes its turn like any render. When only one session may run it at a time (an editor, a GPU, a simulator), check by hand that no other session is using it, or take it under a resource lock if agent-works is installed, and never start a second instance beside the owner's own.

*Done when: the rule is stated with its inputs and constants, each marked measured (with the probe's numbers) or chosen, and a test holds it.*

## Step 4: Distrust "cannot be read"

A note saying a value cannot be read from the reference system is a claim with a date. Before building a stand-in on it, spend one bounded attempt checking again, through another surface than the one that failed. Record the result either way, with what was tried.

*Done when: the claim is confirmed with what was tried, or replaced by the reading.*

## Step 5: Record it

One short entry: the question, the three findings, the verdict, and where the probe lives. It goes in the success file's "Unknowns" while the work is open, so the next session finds it, and into the project's notes when the work closes; say in your report where that is. Next time the same kind of difference appears, the answer is a lookup.

*Done when: the entry exists and names the probe's file.*
