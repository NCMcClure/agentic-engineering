---
name: coordinate
description: Use before a scarce application, heavy job or timing run on a machine agents share.
---

# coordinate

Sessions in different repositories share one GPU, one copy of each heavy application, and each other's
measurements, and cannot see each other's files. The machine's store (`~/.agent-works/`) is where each says what it
uses and reads what the others said. `aw` is the only way in: never read or write the store's files.

The commands, the ten rules and the project configuration are in
`${CLAUDE_PLUGIN_ROOT}/core/references/coordination.md`. Read it before your first lock in a repository.

## Step 1 — Look before you start

```
aw sys
aw who
aw notes
```

Live GPU, CPU, memory and disk beside the leases and locks in force; the agents running, by project; what this
project's agents told each other (`--all` for every project).

*Done when: you know who else is running, what they hold, and whether the machine is busy.*

## Step 2 — Lock or lease

- **Lock** when only one may run: an application that exists once, a port, a benchmark that needs the GPU alone.
  Others wait in a queue.
- **Lease** when you share: a training job, a long compile, a memory-heavy run. Others carry on, and see it.

A resource the project's config declares with `"scope": "machine"` locks across every project; any other name
locks within this project. Declaring a resource is the `guard` skill.

*Done when: each thing you are about to start is either a lock, a lease, or light enough to need neither.*

## Step 3 — Run under a lock

```
aw lock run <resource> --as <name> --for "<what, about how long>" -- <command>
```

It queues, runs the command, and releases, also when the command fails or runs past its limit. It returns the
command's own exit code.

- **Exit 3 with `STILL QUEUED` means you did not run.** Your place is kept for ten minutes: do other work, then
  run the same command again.
- One build or one run per hold. Never hold a lock while reading, thinking or editing.
- Several commands under one hold: `aw lock acquire <resource> …`, check that it exited 0, run them, then
  `aw lock release <resource>`, also after a failure.
- Two locks: in the order of the config's `lockOrder`; release in reverse.
- "Running without a lock" is the owner's own instance, or a leftover. Wait or ask. Never kill it.

*Done when: the command ran under the lock and the lock is free again (`aw lock status`).*

## Step 4 — Declare shared use

```
aw lease gpu --share 0.5 --mem 12GB --for "<what, about how long>" -- <command>
```

An honest share and memory figure. A lease is a declaration, not enforcement: `aw sys` prints the live readings
beside the leases, so a wrong one shows. `--hold` keeps a lease past the command; release it with
`aw lease --release <id>`.

*Done when: `aw leases` shows your lease while the job runs and not after.*

## Step 5 — Before a timing run

```
aw sys --quiet-for timing --wait 120
```

Exit 0: no other agent holds a GPU lease or a machine-wide lock, and every GPU reads under the threshold. Measure
only then, or mark the numbers as taken under load. Keep the `record:` line of `aw sys` beside the numbers.
Compare only within one batch and repeat its baseline at the end; re-run a timing failure before calling it one.

*Done when: the measurement's record holds the `record:` line and whether the machine was quiet.*

## Step 6 — Tell the others, and claim shared numbers

```
aw note "<one line: what others must do or know now>"
aw claim <counter> --for "<branch or card>"
```

A note when you merged something others must pull, when you wait for someone, when you leave something running.
One line; detail goes on a card and the note points at it. A counter (a schema or format version) is claimed when
you are about to merge; after the merge `aw claim <counter> --release --landed`. First use of a counter:
`--after <the value the code holds now>`.

*Done when: what others need to know is a note, and every claim of yours is landed or released (`aw claims`).*

## Step 7 — Lessons that hold on any project

```
aw learn search <words>
aw learn add --topic "<one line>" --tags <tool>,<platform> --from-file <file>
```

Search before a fight with a tool. Add a lesson when it would be true in any repository on this machine: the
fact, how it was established, how to apply it. Never a secret, a project's proprietary content or source code:
every project on the machine reads it. A lesson about this project is the `memory` skill. A learning that stopped
being true: `aw learn retire <id> --reason "…"`.

*Done when: the lesson is in exactly one place, the shared learnings or the project's memory.*
