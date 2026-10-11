# Coordination across agents and projects

Several agents share one machine: one GPU, one copy of each heavy application, one set of ports, and each other's
measurements. Two sessions in two repositories cannot see each other's files, so each needs somewhere to say what it
is using and to read what the others said. That place is the store, and `aw` is the only way in.

## The store

One folder per machine: `~/.agent-works/` (or `AGENT_WORKS_HOME`). It holds who is running, the leases, the locks and
their queues, notes, claims on counters, and learnings shared by every project. A project is a repository with all
its worktrees: they resolve to one project id, so a lock taken in one worktree is seen in the others.

Never read or write the store's files. Every action goes through `aw`, so one permission rule covers all of it and no
agent needs file access outside its own working tree. Entries clean themselves up: a lease, a lock of a run or an
agent whose process is gone is dropped by whoever reads next.

Your name in the store is `--as <name>`, else the project's agent variable (`AW_AGENT` unless the config names
another), else `session-<pid>`: the process of your session, which is `AW_SESSION_PID`, else `CLAUDE_PID` (Claude Code
sets it for the shells and hooks it starts), else the nearest ancestor of the command that is not a shell. The last
is unreliable under Git Bash on Windows, where it can change from one command to the next: without either variable,
name yourself there. Names are lower-case letters, digits and `-`. This is a coordination aid between cooperating
agents, not a security boundary.

## Lock or lease

| | Lock | Lease |
|---|---|---|
| Says | "only me, for this run" | "I am using about this much" |
| Others | wait in a queue, first come first served | carry on, and see it |
| Use for | an application that exists once, a benchmark that needs the GPU alone, a port | training beside other work, a long compile, a memory-heavy job |
| Enforced | the guard refuses a matching command from a non-holder | no: a declaration |

A resource locks **machine-wide** when the project's config declares it with `"scope": "machine"`, and always for the
built-in `gpu` and `gpu-exclusive`. Any other resource locks **per project**: the same name in two projects is two
locks. A resource the config does not declare still locks, per project, with a warning.

Leases are declarations, not enforcement. Nothing stops a process from using more than its lease, or from running
without one. `aw sys` prints the live readings beside the leases so that a mismatch is visible.

## Commands

```
aw sys                                             live GPU, CPU, memory and disk beside leases, locks and agents
aw sys --quiet-for timing --wait 120               quiet enough to measure? exit 0 yes, 1 no (with the reasons)
aw who                                             running agents by project, with what each holds

aw lock run renderer --for "smoke render, 2 min" -- ./render.sh --quick
aw lock acquire renderer --for "import, then render"       several commands under one hold ...
aw lock release renderer                                   ... then give it back
aw lock status                                     free or held, by whom, how long, who waits

aw lease gpu --share 0.5 --mem 12GB --for "fine-tune, 40 min" -- python train.py
aw lease cpu --cpu 16 --for "full rebuild" --hold          prints an id; aw lease --release <id>
aw leases                                          the leases in force and what they add up to

aw note "merged the parser change: pull before running the suite"
aw notes                                           this project's last notes (--all, --machine, --project <name>)

aw claim schema-version --after 41 --for "branch add-index"    the next free number: 42
aw claim schema-version --release --landed                     the merge is in
aw claims

aw learn add --topic "Linker runs out of memory above eight jobs" --tags linker,build --from-file lesson.md
aw learn search linker memory                      then: aw learn show <id>
```

Every command takes `--help`; the reading commands take `--json`. Exit codes: 0 done, 1 not now, 2 usage error,
3 still queued for a lock. `aw lock run` and `aw lease ... --` return the wrapped command's own exit code, and 124
when a time limit killed it.

`aw lock run` or `aw lock acquire` that could not get its turn within `--wait` seconds prints `STILL QUEUED` and
exits 3 (not 1, which a wrapped command's own failure would also give). That is not a failure: the command did not
start, and the place in the queue is kept for ten minutes. Run the same command again.

## Rules

1. **Hold a lock for the run only.** Never while reading, thinking or editing. `aw lock run` is the normal way: it
   queues, runs, and releases also when the command fails or hangs past its limit.
2. **Check that the acquire succeeded** before starting what it protects. Exit 3 means you do not hold it.
3. **One build or run per hold.** Finished, release; need it again, queue again. Others are waiting behind you.
4. **Take two locks in the configured order** (`lockOrder`), and release in reverse. `aw` warns when the order is
   broken: two agents each holding one and waiting for the other never finish.
5. **Say what you use before a heavy run.** Wrap it in `aw lease` with an honest share and memory figure. A minute
   of typing saves another project an afternoon of chasing numbers that would not repeat.
6. **Read `aw sys` before a timing measurement and keep its `record:` line beside the numbers.** Better:
   `aw sys --quiet-for timing --wait <seconds>`, and measure only on exit 0. A timing taken on a busy machine is not
   a result.
7. **A busy resource that nobody declared is the owner's own work, or a leftover.** Wait or ask. Do not kill it.
8. **Notes are one line.** What others must do or know now: what you merged that they must pull, what you wait for,
   what you left running. Detail goes in a kanban card or a file, and the note points at it. Notes rotate away; what
   must last belongs in the project's memory.
9. **Claim a counter at merge time**, not when the work starts, and release it with `--landed` once the merge is
   in. A claim taken early and forgotten leaves a gap.
10. **Do not release or work around what another agent holds.** A lock that looks abandoned is taken over by `aw`
    itself once it is stale and none of the resource's processes runs.

## Shared learnings or the project's memory

A lesson goes to **shared learnings** when it would be true in any repository on this machine: a fact about the
machine, the operating system, a shell, a compiler, an engine, a library or a tool. "The linker runs out of memory
above eight parallel jobs on this machine" is one. Search them before a fight with a tool: `aw learn search <words>`.

A lesson stays in the **project's memory** when it is about this project: its code, its design, its decisions, its
measurements, its people's preferences.

Shared learnings are read by every project on the machine, whoever owns it. Never put in one: secrets, tokens or
credentials (a learning that looks like it holds one is refused), a project's proprietary content, source code, or
names of customers and people. Write the general fact, how it was established, and how to apply it. When a learning
stops being true, retire it (`aw learn retire <id> --reason "..."`) instead of leaving it to mislead.

## Project configuration

In `.agents/agent-works.json` (all optional):

```json
{
  "resources": { "renderer": { "scope": "machine", "processes": ["render"], "maxMinutes": 20 } },
  "lockOrder": ["simulator", "renderer"],
  "counters": { "schema-version": { "note": "the migration number" } },
  "coordination": { "lockStaleMinutes": 45, "holdMinutes": 120, "claimHours": 72 }
}
```

`processes` are name prefixes of the resource's executables: while one runs without any lock, an acquire waits (it is
the owner's own instance, or a leftover), and a stale lock is not taken over while one still runs. `maxMinutes` is
the limit of an `aw lock run` on that resource.
