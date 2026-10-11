---
name: orchestrate-agents
description: "Coordinate several agents on perceptual work: a success file and proving shots per agent, proportionate verification of looks, opening the pictures, the owner's queue."
disable-model-invocation: true
---

# orchestrate-agents

Perceptual work parallelises badly by default: every agent wants the one GPU, the one editor, the one shots folder,
and each comes back with "looks good". Two things fix that. One is general coordination: who works where, who may
start the scarce application, what a report holds. The other is perceptual: what "done" means for a look, how much
to render to prove it, and who looks at the pictures. This skill is the second.

Cutting the work into tasks, the shared brief, worktrees, locks and leases on scarce applications, notes, claims,
owed gates, commit-as-you-go and the report format are agent-works' job (`agent-works:orchestrate` /
`agent-works:coordinate`, `aw lock`, `aw lease`, `aw note`). Without it:

1. One agent at a time on the application that renders; you hand the turn over by hand and say so in each prompt.
2. One task, one branch and one workspace per agent; only one agent in the main checkout.
3. A change that invalidates everyone's references or baselines goes to one agent, merged last.
4. Agents commit as they go and stage files by path.
5. Each agent ends with the report of `references/brief-template.md`.

## Step 1 — A success file and proving shots per agent

Every task gets its own success file before it starts (`define-success`): what the result must show, the 1–3
proving shots that show it, and its end-of-work gates. An agent without one will report "looks good", which is not
a result. Two tasks that need the same proving shots, or that both move the baseline of the same shots, are not
parallel: queue them.

A change to a format or a layout that every reference depends on is one task for one agent, merged last, followed
by a single re-capture.

*Done when: every task names its success file, its proving shots and its end-of-work gates.*

## Step 2 — The perceptual addendum to the brief

Every agent of a round reads one shared brief before its own task. Append `references/brief-template.md` to it: how
to judge a difference, how much to render, and the items about pictures that a report must hold. With agent-works
the shared brief is its common brief; without it, the addendum under the five lines above is the brief.

Delegation loses context both ways: say what is already known and ruled out, point at files instead of retelling
them, and never hand an agent your conclusion to confirm.

*Done when: the brief every agent is told to read first contains the addendum, and each task prompt names the
agent's success file.*

## Step 3 — Proportionate verification, stated in the task

Tell each agent what its change can break and therefore what it must run **once at the end**; everything else is
the proving shots while iterating (`iterate`). A full run belongs only to a change that can reach everything, and
carries its reason in the command (`PL_RUN="full: …"`; this plugin's hook refuses a larger render without one, also
when the render is wrapped in `aw lock run … --` or `aw lease … --`). Two rules that save hours: a failure on an
untouched entry is rendered again before anything else, and an entry that reproduces on the unchanged main branch
is `stale`, not the agent's (`calibrate-gate`).

Lighter verification has a price: skipped full runs let stale entries accumulate, and the next full run finds them.
Schedule one integration pass after a batch of merges, by one agent holding the application. A gate that could not
be run now is owed, not forgotten: record it (with agent-works, as a gate card: `aw kanban owe`; without it, as a
line at the top of your report).

*Done when: each task names its end-of-work gates and says whether a full run is justified, and why.*

## Step 4 — Open the pictures, relay verdicts, fill the owner's queue

When an agent reports:

- **Open the pictures yourself.** A sub-agent's "matches" is a claim; your own look is the check. Say in your own
  report which images you opened and which you did not.
- Relay verdicts, not numbers: what the picture shows, classified by the doctrine's verdicts.
- Collect every open judgement into the owner's queue (`judge-and-queue`), with a recommendation each, and keep
  going with the next task; do not stop the round for a look question.
- When an agent decided something that was the owner's to decide, surface it at the top of your report, not in a
  list at the bottom.
- Record rulings on looks where every later agent reads them (`.perceptual-loop/decisions/`), and correct older
  text that now contradicts them.

*Done when: each finished task has a relayed report naming the images you opened, its open questions are queued,
and the next task has started or the reason it cannot is stated.*
