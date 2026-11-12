# Running an autonomous mode without the Workflow tool

Ten skills in this plugin bundle a `workflows/*.js` script. The `Workflow()`
tool that runs one is not in every session: a host or a configuration may not
offer it. An autonomous mode that is only a `Workflow({...})` call then leaves
the model with an instruction it cannot follow, and it either improvises or
stops.

So every "Autonomous mode" section points here, and this is what to do instead.

## The fallback

Run the same phases with parallel subagents, in the same order, with the parent
session holding the state the workflow would have held.

1. **Phases stay sequential.** A workflow's `phase()` boundaries are real
   barriers: phase N+1 reads what phase N wrote. Do not overlap them because
   subagents make parallelism cheap.
2. **Fan out inside a phase only.** Where the workflow calls `parallel()`,
   launch the subagents in one message so they run at once. The natural unit is
   whatever the workflow fanned over: one subagent per epic, per spec category,
   per review lens, per finding to verify, per builder in a wave. Where it calls
   `pipeline()` or a single `agent()`, do that yourself or launch one subagent
   and wait.
3. **The parent owns every shared file.** Subagents return findings; the parent
   writes. That means `plan/index.md`, `epic.md`, `sprint.md`, the drift files,
   the per-run note, and anything else two phases both touch. Two subagents
   writing one index is the failure this rule exists to prevent.
4. **The parent owns the funnel.** `plan-status.mjs set` rewrites six surfaces
   at once, so it is never run inside a subagent and never run twice
   concurrently. A builder subagent reports that its checkpoint passed; the
   parent runs the funnel, one issue at a time. Only the independent
   verification pass passes `--evidence`, because that argument writes the
   verified-complete ledger.
5. **Same schema, same commands.** A subagent returns the fields the workflow's
   `schema:` declares, and any number a script can compute still comes from the
   script. A model that decides in prose what `verify-plan-tree.mjs` would have
   said has already got it wrong.
6. **Verifiers loop to exit 0.** Where the workflow loops a checker until it
   passes, loop it: run `verify-spec-tree.mjs` or `verify-plan-tree.mjs`, fix
   what it names, run it again. Report the residual honestly if it will not go
   green inside the round budget rather than declaring the phase done.
7. **Claims are verified by somebody who did not make them.** A subagent that
   built an issue does not get to close it. The parent, or a fresh subagent with
   no memory of the build, re-runs the checkpoint and reads the diff. This is
   the whole point of the audit and reconcile phases, and it is the first thing
   a hand-rolled fan-out tends to drop.
8. **No clock, no dice.** Pass timestamps in from the parent, for the same
   reason a workflow may not call `Date.now()` or `Math.random()`: a run you
   cannot reproduce is a run you cannot debug.

## What you lose

Resume. A workflow checkpoints between phases and picks up where it stopped; a
subagent fan-out does not. Everything this plugin produces is files on disk, so
keep them written at the end of each phase and a re-run starts from the last
phase that finished rather than from nothing. Say which phase that was.
