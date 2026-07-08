# Re-assessing a drift item

A drift file is a *claim* recorded at some past moment — "this defect / smell / bug is
cross-cutting and recurs." The code has moved since. Before you spend an issue on it,
re-derive whether the claim still holds against the tree as it exists today. This is
the same discipline as verifying a "done" claim
([ASSESSMENT.md](../build-next-issue/ASSESSMENT.md)), pointed at a drift write-up.

## The verdicts

Every open item lands on exactly one. The first three concern *relevance* and the last
two are escape hatches for items that are real-looking but shouldn't earn an issue — each
maps to the drift `status:` you set (the vocabulary owned by
[build-next-issue](../build-next-issue/SKILL.md)):

- **still-relevant** → `routed` — the problem is present in the current code, essentially
  as described. It earns an issue (step 5).
- **already-resolved** → `resolved` — the code no longer exhibits it. A later issue,
  refactor, or spec edit fixed it incidentally. Flip the drift file to `resolved` with
  the evidence; no issue.
- **changed** → `routed` — the underlying problem moved or only partly survives: the
  smell shifted to a different module, the defect now bites a narrower case, the spec
  section it anchored to was rewritten. **Re-scope it** — write the issue against what's
  actually there now, not the stale description. Don't blind-resolve a changed item; the
  residue is still real.
- **by-design** → `by-design` — the claim looked like a defect when surfaced, but the
  code is intentionally this way and the re-assessment confirms it's correct. This is
  *not* already-resolved (nothing was fixed — it was never a problem). Note the evidence
  that it's deliberate; no issue.
- **human-or-future** → `human-or-future` — real, but not an agent's call: it needs a
  human decision (a product/policy trade-off) or is deferred to future work. Park it
  with a note on what's blocking; no issue now. Use this instead of leaving it `open`,
  so the next triage doesn't re-litigate it.

Evidence settles the verdict, not the write-up's age or confidence. Record what
convinced you in the drift file alongside the status you set.

## Confirm the `where:` still exists first

Each item names a `where:` — a spec path, a sprint, or a code location. Resolve it
against the current tree before anything else:

- **The location is gone** (file deleted, module renamed away, spec section removed).
  That's a signal, not a dead end: it usually means *resolved-by-refactor* (the thing
  that drifted no longer exists) or a *stale* item written against a design that's
  since changed. Track down where the behaviour lives now before deciding — a vanished
  path can hide a **changed** item, not an **already-resolved** one.
- **The location still exists.** Read it, and judge relevance by `kind` below.

## What settles it, per `kind`

- **defect / checkpoint-bug** — re-run the concrete thing. If the drift named a
  checkpoint command that was broken-by-construction or not-yet-runnable, run it now
  against the current tree; if it names a spec anchor, re-open that anchor and check
  whether the invariant it described is still violated. A command that now passes (or a
  contradiction that's gone) is **already-resolved**; one that still fails the same way
  is **still-relevant**.
- **smell (architecture)** — walk the modules under `where:` with an
  `subagent_type=Explore` agent and apply the **deletion test** from
  the canonical [LANGUAGE.md](../spec-3-architect/LANGUAGE.md):
  imagine deleting the shallow module — does complexity concentrate (the smell is real
  and **still-relevant**) or just move (it was never load-bearing)? Use that skill's
  vocabulary — *module, interface, depth, seam, leverage, locality* — so the issue you
  write speaks the same language the fix will.
- **note** — an observation, not a claimed defect. Re-read it against the code and decide
  whether what it observed still holds. A note usually settles to **by-design** (the
  thing it flagged is confirmed intentional) or **human-or-future** (it raised something
  for a human to weigh), not an issue. It only becomes **still-relevant** if the
  re-read shows the note was actually surfacing a latent defect — in which case route it
  by what that defect *is* (treat it as `defect`/`smell`).

## How strict to be

Demonstrate, don't assert. An item is **still-relevant** only when you can point at the
code, command, or anchor that still exhibits it — the same bar `build-next-issue`
applies before trusting a "done" flag. When the evidence is genuinely ambiguous (a
**changed** item whose residual fix could go several ways), don't force a verdict — flag
it in the report (step 7) for the user to decide, rather than opening a vague issue.
