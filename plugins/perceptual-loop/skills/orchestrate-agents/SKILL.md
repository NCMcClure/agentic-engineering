---
name: orchestrate-agents
description: "Coordinate several agents on perceptual work: one per task, a shared brief, locks on scarce applications, a board, proportionate verification."
disable-model-invocation: true
---

# orchestrate-agents

Perceptual work parallelises badly by default: every agent wants the one GPU, the one editor, the one shots folder,
and each comes back with "looks good". This skill is the coordination that let eight agents work for hours without
a person: what a coordinator hands out, what agents must not share, and what they bring back.

## Step 1 — Cut the work into tasks an agent can finish alone

One task per agent, each with its own success file (`define-success`) and its own branch. Sort them first by what
they **need exclusively**:

- the application that renders (one instance at a time: a lock),
- the main checkout, where builds, imported content and baselines live (one agent at a time),
- anything that invalidates everyone's references or baselines (a format or layout change): **one integrator**,
  merged last, with a single re-capture; nobody else merges such a change.

Tasks that need none of these run in parallel in separate git worktrees. Tasks that need the same exclusive thing
are queued, not raced. Decide the order by dependency (who needs whose merge), then by value.

*Done when: every task has an owner name, a workspace (main checkout or a worktree), its exclusive needs, and the
files where it may collide with another task.*

## Step 2 — The shared brief

Every agent reads the same short brief before its own task; write it once per round from
`references/brief-template.md`. It carries what an agent cannot infer: the doctrine in five lines, the lock and
board procedure, where it works and what it must not touch, how to verify **proportionately**, the git rules, the
report format. An agent's own prompt then holds only its task, its collisions and its gates.

Delegation loses context both ways: say what is already known and ruled out, point at files instead of retelling
them, and never hand an agent your conclusion to confirm.

*Done when: the brief exists as a file every agent is told to read first, and each task prompt names the agent, its
workspace, its collisions and its gates.*

## Step 3 — Locks and the board

Configure the scarce applications in `.perceptual-loop/config.json` (`locks.apps`: the process names that mean "it
is running" and the command patterns that start it). Then every agent, and you:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/lock.py" run <app> --as <agent> --for "<what>" --max-minutes <N> -- <command>
```

`run` queues for the lock, runs the command as its holder, stops it at the time limit and **always releases**. For
a hold spanning several commands use `acquire` … `PL_AGENT=<agent> <command>` … `release` (PowerShell:
`$env:PL_AGENT = "<agent>";` in front). The hook refuses a matching command from anyone who does not hold the lock;
the name is self-declared, so this is a coordination aid, not a security boundary. The rules that keep it working:

- The queue is **first come, first served**: a waiter keeps its place between calls. A wait that ends with "still
  queued" is not a failure: run the same command again (waits are kept shorter than tool time limits on purpose).
- Hold a lock **for the run only**: never while thinking or editing. Release also after a failure; give every hold
  a time limit, since one hung run otherwise blocks everyone.
- Needing two applications, take them in the config's order and release in reverse.
- `acquire` waits while the application runs with **no** lock: that is the human's own instance. Never kill it;
  do other work and say so.
- The **board** is the record: `lock.py note --as <agent> "<one line>"` when you start, when you merge something
  others must pull (say what changed), before editing a file another agent is likely in, when you wait, when you
  finish. `lock.py board` before starting and after every long step.

Locks and the board live in a per-user folder keyed by the main repository, so every worktree sees the same ones.

*Done when: `lock.py status` lists the applications, and a command that starts one without the lock is refused.*

## Step 4 — Proportionate verification, stated in the task

Tell each agent what its change can break and therefore what it must run **once at the end**; everything else is
the proving shots while iterating (`iterate`). A full run belongs only to a change that can reach everything. Two rules
that save hours: a failure on an untouched entry is rendered again before anything else, and an entry that
reproduces on the unchanged main branch is `stale`, not the agent's (`calibrate-gate`).

Lighter verification has a price: skipped full runs let stale entries accumulate, and the next full run finds them.
Schedule one integration pass after a batch of merges, by one agent holding the lock.

*Done when: each task names its end-of-work gates and says whether a full run is justified, and why.*

## Step 5 — Agents that survive interruption

- **Commit as you go**, in small steps on the task's branch: a cut-off loses nothing, and a resumed agent reads its
  own history.
- Long jobs run in the background and are **polled with a timeout**; an agent never waits on a notification that
  may not come.
- When an agent stops early for an infrastructure reason, resume it with its own last note and the state of its
  branch; do not restart the task from the prompt.
- An agent that must stop short (a decision is the owner's; a change would invalidate everyone's references) stops
  with its work pushed and its PR **open**, and says exactly what the next step is and who triggers it.

*Done when: every running agent's work is recoverable from its branch and the board alone.*

## Step 6 — What comes back, and what you do with it

Require the report format of `references/brief-template.md` § Report. Then, as coordinator:

- **Open the pictures yourself.** A sub-agent's "matches" is a claim; your own look is the check. Say in your own
  report which images you opened and which you did not.
- Relay verdicts, not numbers: what the picture shows, classified.
- Collect every open judgement into the owner's queue (`judge-and-queue`), with a recommendation each, and keep
  going with the next task; do not stop the queue for a look question.
- When an agent decided something that was the owner's to decide, surface it at the top of your report, not in a
  list at the bottom.
- Record rulings where every later agent reads them, and correct older text that now contradicts them.

*Done when: each finished task has a relayed report with the images you opened, its open questions are queued, and
the next task has started or the reason it cannot is stated.*
