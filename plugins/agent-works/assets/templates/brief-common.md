# Common brief: how an agent works in <project>

<!-- Copy to the briefs folder as common.md, fill every <placeholder>, delete what does not apply. 120 lines at most. A rule of the project belongs in the root AGENTS.md: link to it here, do not restate it. -->

Every agent of every round reads this before its own task. It says how to work beside other agents here. The
project's rules are in the root AGENTS.md and bind you; where this brief and that file differ, that file wins and
this brief is wrong: say so in your report.

## Read first

1. The root AGENTS.md, in full, then `.agents/README.md`.
2. The memory index and the status memory, then the folders your task touches.
3. Your round's brief and your task. Then the hub of each folder you will change.
4. <What every agent of this project must read before looking at a result: a review guide, a contract page.>

## Your name

Your task gives you an agent name. Pass it as `--as <name>` to `aw`, and put `<AGENT_VAR>=<name>` in front of any
command that starts a locked resource (PowerShell: `$env:<AGENT_VAR> = "<name>";`). The guard matches the holder of
a lock by that name.

## Where you work

- Your own git worktree on your own branch, cut from `<default branch>`. It has no build outputs and no installed
  dependencies. Provision it first: <the install and build commands a fresh worktree needs, and what they cost>.
- <What cannot be built or run from a worktree and so stays in the main checkout, and who may use the main
  checkout: one agent at a time, named in the round's brief.>
- Never switch another checkout's branch, never edit or clean files outside your worktree.
- <The owner's own files, by path: never edit, stage, revert, stash or delete them. The guard refuses it.>

## Git

- Stage files by their exact paths. Never a directory, never `git add -A`, `-u` or `.`, never `git commit -a`.
- Read `git status` and `git diff --cached --stat` before every commit. A file you did not mean is unstaged, not
  explained afterwards.
- Commit as you go, in steps a reviewer can read. An interruption must lose nothing.
- When `<default branch>` moved under you: `git fetch`, then merge it into your branch. Never rebase a branch you
  have pushed, never force-push.
- <Branch naming, the pull-request convention, the trailer lines, and who merges: you when every gate is green, or
  the orchestrator.>
- Leave the pull request open and report when a gate is not green or a judgement is not yours.

## Scarce resources

- <The project's locked resources by name and what each protects; the order to take two of them in.>
- Start one only through `aw lock run <resource> --as <name> --for "<what, how long>" -- <command>`. It queues,
  runs and releases, also when the command fails.
- Exit code 3 with `STILL QUEUED` means you did not run. Do other work, then run the same command again: your
  place in the queue is kept.
- One build or one run per hold. Do your reading and your code first, so each turn with the lock is a planned run.
  Others are waiting behind you.
- "Running without a lock" is the owner's own instance, or a leftover. Never kill it. Note it and try later.
- Say what you use: a long compile, a training job, anything that loads the GPU beside others runs under
  `aw lease <resource> --share <0..1> --mem <size> --for "<what>" -- <command>`.

## Measuring

Before any run whose timing matters: `aw sys --quiet-for timing --wait <seconds>`. Measure only when it exits 0,
or mark the numbers as taken under load. Keep the `record:` line of `aw sys` beside the numbers. Compare only
within one batch, and repeat the batch's baseline at its end. Re-run a timing failure once before calling it one.
Never stop a process that is not yours.

## Shared numbers

<The counters of this project, by name: a schema version, a format version, a migration number.> Do not bump one
on your branch while you work. When you are about to merge: merge `<default branch>` in, `aw claim <counter>
--for "<branch>"`, write the number it gives you, re-test, merge, then `aw claim <counter> --release --landed` and
`aw note "merged <PR>: <counter> is now <N>"`.

## Talking to the others

- `aw notes` before you start and whenever you come back from a long step.
- `aw note "<one line>"` when you merged something others must pull (say what changed for them), when you are
  about to change a file another agent is in, when you wait for someone, and when you finish.
- Work you notice that is not your task: `aw kanban add "<title>" --suggest --details "<…>"`, then carry on.

## Verification, in proportion

- While iterating: the one test file, the one command, the few cases that show your change.
- Once, at the end: what your change can break, as your task names it. The whole suite only where the task says so.
- A failure on something you did not touch: run it again before anything else. If it also fails on an unchanged
  `<default branch>`, it is not yours: add a card and say so.
- A check you cannot run (it needs the main checkout, a resource you could not get, the owner) is owed:
  `aw kanban owe "<the check>" --ref <PR or card> --needs "<what it needs>"`. Never skip one silently, and never
  report it as passed.
- <The project's end-of-work gates, each with its command and its cost.>

## Done

1. Every item of your task is done and verified, or shown impossible with the reason, or deferred with what
   remains as a card.
2. The end-of-work gates are green, or owed with a gate card each.
3. Hubs, the glossary and contract pages match what you changed. A lesson that cost you time is a memory.
4. Your card is in review, your locks and leases are released, your claims are landed or released.

## Report

Your final message is all the orchestrator sees. Verdict first; write for a reader who was not there; evidence as
commands and numbers; what you did not verify; what needs the owner. Use the report template. No report file in
the repository.
