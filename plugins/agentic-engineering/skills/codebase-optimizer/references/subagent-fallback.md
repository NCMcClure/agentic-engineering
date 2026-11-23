# Running a multi-agent mode without the tool it was written for

Two skills in this plugin bundle a `workflows/*.js` script: `optimize-codebase`
runs the staged engine, `codebase-organizer` runs the plan and apply pair. Both
are executed by the `Workflow()` tool, and not every session has it: a host or a
version without it, a session where it is switched off. An autonomous mode that
is only a `Workflow({...})` call leaves the model there with an instruction it
cannot follow, and it either improvises or stops.

So every section that reaches for the tool points here, and this is what to do
instead. The third skill, `improve-codebase-architecture`, fans out with plain
subagents; the last section covers a session that has none of those either.

## The fallback: the same phases, with subagents

Run the same phases with parallel subagents, in the same order, with the parent
session holding the state the workflow would have held.

1. **Phases stay sequential.** A workflow's `phase()` boundaries are real
   barriers: Setup writes the baseline commit and the protected-untracked set
   that every later phase reads, Conventions writes the block the find and
   panel prompts carry, and a stage reads what the stage before it committed.
   Do not overlap them because subagents make parallelism cheap.
2. **Fan out inside a phase only.** Where the workflow calls `parallel()`,
   launch the subagents in one message so they run at once. The natural unit is
   whatever the workflow fanned over: one subagent per directory being
   characterized, per extraction candidate, per panel lens, per deepening
   lead. Where it calls `pipeline()` or a single `agent()`, do that yourself or
   launch one subagent and wait.
3. **The parent owns the repository.** Subagents read and report; the parent
   writes. That means the plan JSON, every `git mv`, every commit, every
   revert, and the branch itself. Two subagents committing into one working
   tree is the failure this rule exists to prevent, and it is the reason the
   engine's own concurrency uses one git worktree per file rather than one
   branch shared by everybody.
4. **The human gate stays in the conversation.** The organizer's approval beat
   and the sweep's go-ahead are real stops: present the plan, wait for a yes,
   and only then change anything. Running the phases by hand moves neither
   gate. The workflows refuse to start without `approved: true` for the same
   reason, and a fan-out that applies its own plan has removed the one check the
   whole design rests on.
5. **Validation is a command, not a judgement.** Every apply is followed by the
   repo's own smoke, test, and lint commands against the round's oracle of
   pre-existing failures, and anything newly red is reverted. A subagent that
   reports "looks fine" without running them has not validated anything, and a
   parent that accepts that has removed the safety net.
6. **Same schema, same numbers.** A subagent returns the fields the workflow's
   `schema:` declares, and any number a script can compute still comes from the
   script: line counts, the recon profile, the structure gate's findings. A
   model that decides in prose what `repo-scan.mjs` would have said has already
   got it wrong.
7. **Gates decide by exit code.** Where the workflow runs
   `verify-structure.mjs`, run it: exit 2 fails the stage, exit 1 is a list of
   warnings to pass on, and a hub finding is fixed by editing the hub it names
   and running the gate again. Report the residual honestly if it will not go
   green inside the round budget rather than declaring the phase done.
8. **Claims are verified by somebody who did not make them.** A subagent that
   performed an extraction does not get to call it landed. The parent, or a
   fresh subagent with no memory of the change, re-runs the checkpoint and reads
   the diff. This is the first thing a hand-rolled fan-out tends to drop.
9. **No clock, no dice.** Pass timestamps in from the parent, for the same
   reason a workflow may not call `Date.now()` or `Math.random()`: a run you
   cannot reproduce is a run you cannot debug.

## What you lose

Resume. A workflow checkpoints between phases and picks up where it stopped; a
subagent fan-out does not. What saves you here is that the work is commits on a
branch: a re-run rediscovers the tree as it now stands, skips the files that are
already finished, and starts from the last round that committed rather than from
nothing. Say which round that was.

## No subagents either

Then the session does every unit itself, one after another, and the rules above
still hold with one reading changed: where a rule separates the one who does
from the one who checks, separate them in time. Finish a unit, write down what
it claims, and only then re-run its checkpoint from the command line as if
somebody else had made the change.

- A fan-out becomes a queue: one directory, one candidate, one lens at a time.
  Keep the units as small as the workflow kept them; a single pass that "covers
  everything" is how findings get lost.
- A panel of lenses becomes the same questions asked in turn, each answered in
  writing before the next is read.
- Independent designs (the interface exploration in
  `improve-codebase-architecture`) are written one constraint at a time, each
  finished before the next is started.
- Say in the report that the run was sequential and single-agent, so the person
  knows the independent second read did not happen.
