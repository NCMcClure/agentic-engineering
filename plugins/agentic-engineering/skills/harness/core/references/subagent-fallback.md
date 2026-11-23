# Running an autonomous mode without the Workflow tool

The Workflow tool is not in every session: an older host, a session with it
switched off, a headless run that was never given it. A skill whose
autonomous mode is only a `Workflow({...})` block then hands the model an
instruction it cannot follow, and the model either improvises or stops. Every
autonomous mode here therefore names the fallback, and check WQ7 in the
rubric marks down a skill that does not.

## The fallback

Run the same phases with parallel subagents, in the same order, with the
parent holding the state the workflow would have held.

1. **Phases stay sequential.** A workflow's `phase()` boundaries are real
   barriers: phase N+1 reads what phase N wrote. Do not overlap them because
   subagents make parallelism easy.
2. **Fan out inside a phase only.** Where the workflow calls `parallel()`,
   launch one subagent per item in a single message so they run at once.
   Where it calls `pipeline()` or a lone `agent()`, do it yourself or launch
   one subagent and wait.
3. **The parent owns every shared file.** Subagents return findings; the
   parent writes `scan.json`, `grades.json`, `score.json`, the report, and
   anything else two phases both touch. Two subagents writing one file is the
   failure this rule exists to prevent.
4. **Same schema, same arithmetic.** A subagent returns the same fields the
   workflow's `schema:` declares, and the parent still runs
   `plugin-scan.mjs --score` for every number. A model that totals a
   composite in prose has already got it wrong.
5. **Verifiers loop to green.** Where the workflow loops a checker until it
   exits 0, loop it: run, fix, run again, and report the residual honestly if
   it will not go green in the round budget.
6. **No clock, no dice.** Pass timestamps in from the parent, the same reason
   a workflow may not call `Date.now()` or `Math.random()`: a run you cannot
   resume is a run you cannot debug.

## With no subagents either

Do the phases yourself, in order, one item at a time, and say so in the
report. The inline steps of each skill are that path already written down;
the fan-out buys speed and independent graders, not a different result.

## What you lose

Resume. A workflow checkpoints between phases and picks up where it stopped;
a subagent fan-out does not. Keep the artifacts on disk after each phase so a
re-run starts from the last one that finished instead of from nothing.
