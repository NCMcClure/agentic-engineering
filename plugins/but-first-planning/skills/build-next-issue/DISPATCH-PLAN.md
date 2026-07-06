# The dispatch plan — the parallel-safe build frontier

`NEXT-SELECTION.md` answers "what is the *one* next issue for a person." A coordinator
that builds in parallel needs more: the whole set of issues that can be built
**now, concurrently, without colliding**, plus the edges among the ones that
can't yet. That set — wave-ordered, with its dependency DAG, file-overlaps, and
human gates — is the **dispatch plan**. It is the hand-off artifact that
`build-sprint` consumes to fan builders out safely.

Produce it whenever work will be built in parallel by multiple builders; skip it when
you're only telling a human the single next thing.

## 1. Derive the *true* dependency graph

The plan's `Blocked by` field is necessary but not sufficient — it records
*declared* dependencies and routinely says `None — can start immediately` for
issues that genuinely depend on each other. Recover the rest:

- **Implicit, from checkpoints.** Read each issue's `## Testing checkpoint`
  command. If it invokes an artifact another issue *builds* (a script, binary,
  fixture, config), that issue depends on the producer — even with `Blocked by:
  None`. Example seen in the wild: three issues all declared independent, but two
  of them had the checkpoint `scripts/verify-layout` — which was a *third*
  issue's deliverable. True order: producer first.
- **Implicit, from "What to build."** An issue that *calls* a module another
  issue *creates* (e.g. a shim that calls `hook_core.handle_session_start` built
  in a later issue) depends on it, or needs a stub. Flag the forward-dependency.
- **Declared-vs-implied mismatch is a finding.** When the two disagree, the
  implied graph wins for dispatch, and the `Blocked by` field should be corrected
  via `plan-6-edit`. Surface it; don't silently route around it.

## 2. Find file-overlaps (the *other* dependency)

Two issues with no logical dependency still cannot be built concurrently in the
same working tree if they edit the **same files**. From each issue's "What to
build" and checkpoint, predict the files it will touch. Issues whose predicted
file sets are **disjoint** are safe to batch; overlapping ones must serialise
(or run in genuinely isolated worktrees). When unsure, treat them as overlapping
— a wrong "disjoint" guess causes merge tangles.

## 3. Map the HITL gates

For the current and next sprint, list the **HITL** issues and, for each, whether
any AFK issue depends on it (logically or implicitly). This yields the one fact a
sprint coordinator most wants up front: **is this sprint autonomous-able, or will it
stall at issue #N waiting on a human?** A HITL issue that gates the frontier is
the real next action even if AFK issues sit "available" behind it.

## 4. Order into waves

Topologically sort the frontier into **waves**: wave 1 is every issue with all
prerequisites verified-complete *and* no file-overlap with its wave-mates; each
later wave unlocks once the prior wave's producers land and re-checkpoint green.
Within a wave, cluster issues that touch the same module into one unit (one
builder, one commit) rather than racing them.

## Output shape

Hand back a compact, machine-followable plan — this is what `build-sprint`
reads:

```
Sprint NN-MM dispatch plan
  Wave 1 (parallel-safe, disjoint files):
    - 02 (#3) AFK  scripts/verify-layout            files: scripts/, dev/test/
    - 03 (#4) AFK  shared/scripts sentinel          files: shared/scripts/, dev/test/
    - 05 (#6) AFK  sample-kb fixture                files: dev/fixtures/, dev/test/
  Wave 2 (after 02 lands + re-checkpoint):
    - 06 (#7) AFK  CI runs verify-layout            depends: 02 (checkpoint tooling)
    - 07 (#8) AFK  root README                      checkpoint drift: scripts/package.py absent
  HITL gates:
    - 08 (#9) HITL ADR-001 layout decision          gates: sprint exit (pause for human)
  Checkpoint health:
    - 07: checkpoint names scripts/package.py (unbuilt) → verify via acceptance; route to plan-6-edit
    - sprint-exit uses plan-status.py check 01-01 (the old grep -L "Status: done" was broken-by-construction)
```

Keep the dependency reasons explicit (why an issue is in a later wave) so the
orchestrator — and the human reading over its shoulder — can trust the ordering
without re-deriving it.

## The JSON contract (machine hand-off)

When the dispatch plan is produced for an autonomous build — by hand or by the
bundled `workflows/reconcile.js` — it is **also written as JSON** to
`.plan/progress/dispatch/EE-SS.json`, which `build-sprint`'s workflow
(`build-sprint.js`) takes as its required `dispatch` arg. This file is the
canonical schema; keep the prose plan and the JSON saying the same thing.

```json
{
  "sprint": "EE-SS",
  "generated": "YYYY-MM-DD",
  "waves": [
    { "n": 1,
      "units": [
        { "coords": ["EE-SS-II"],
          "refs": ["#NNN or <unassigned>"],
          "type": "AFK",
          "title": "one line",
          "files": ["predicted/paths/"],
          "reason": "why this unit sits in this wave" } ] }
  ],
  "edges": [
    { "from": "EE-SS-II", "to": "EE-SS-II",
      "kind": "declared | implicit-checkpoint | implicit-module | file-overlap",
      "why": "one line" }
  ],
  "hitlGates": [
    { "coords": "EE-SS-II", "title": "…", "gatesWhat": "which AFK work stalls on it" }
  ],
  "checkpointHealth": [
    { "coords": "EE-SS-II", "problem": "…", "route": "plan-6-edit" }
  ],
  "declaredVsImpliedMismatches": [
    { "coords": "EE-SS-II", "declared": "None", "implied": "EE-SS-II", "why": "…" }
  ]
}
```

A unit whose `coords` lists more than one issue is a **same-module cluster**:
one builder, one commit, built together on purpose. `type` is `HITL` only when
every issue in the unit is HITL; a mixed cluster is a planning smell — split it.
