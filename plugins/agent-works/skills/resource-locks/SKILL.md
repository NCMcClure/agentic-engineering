---
name: resource-locks
description: "Use before starting anything only one session on this machine can use at a time: a dev-server port, a simulator, a GPU, a shared database, a timing-sensitive test run."
argument-hint: "[run|acquire|release|status] <resource> ..."
---

# resource-locks

Sessions running side by side in their own worktrees still share one machine. Two of them starting a dev server on
one port, driving one simulator, or timing the same suite at once break each other in ways that look like flaky
code. A lock makes them take turns: the first session to ask runs, the others wait in line in the order they
asked, and the lock goes back when the command ends, however it ends.

`aw` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs"`.

## Wrap the command

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" lock run devserver --for "e2e suite, about 4 min" --max-minutes 10 --wait 90 -- npm run e2e
```

- `devserver` is the resource: a plain name the sessions agree on (`port-3000`, `simulator`, `gpu`, `test-db`).
- `--for` says what you are doing and for how long. Whoever waits reads it.
- After `--` comes the program and its arguments, run without a shell. Leading `NAME=value` words set its
  environment. A line that needs a shell (a pipe, `&&`) is yours to wrap: `-- bash -c "npm run build && npm test"`.
- `--max-minutes` stops the command at the limit, so a hang cannot hold the lock all day (default: the
  resource's `maxMinutes`, else 30).
- `--wait` is how many seconds to wait in line (default 480). Keep it under your tool's timeout.
- While the command runs the lock is refreshed. When the command ends it is released: on success, on failure, and
  at the time limit.

Exit codes: the command's own, except 3 (still queued when `--wait` ran out; nothing ran), 124 (stopped at the
limit), 127 (the command could not be started) and 2 (usage).

**On exit 3**, do other work and run the same command again: your place in line is kept for 10 minutes. The lock
knows you by `--as`, else by the agent variable (`AW_AGENT`), else by `session-<pid>`. Pass `--as <your card or
branch>` to keep a place across calls.

## Which sessions a lock reaches

A resource the config declares with `"scope": "machine"`, and the built-in `gpu` and `gpu-exclusive`, lock across
every repository on this machine. Any other name locks within this repository and all its worktrees, so the same
name in two repositories is two locks. A port, a simulator and a GPU belong to the machine: declare them in
`resources` of `.agents/agent-works.json` (the `guard` skill, Step 2). A name the config does not declare still
locks, for this repository, with a warning.

## Hold it across commands

When one command is not enough (start a server, run several checks against it, stop it):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" lock acquire port-3000 --for "dev server for manual checks, 15 min" --as card-0004 --wait 90
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" lock release port-3000 --as card-0004
```

- Pass the same `--as` to both. Only the holder releases a lock.
- `acquire` exits 0 with the lock and 3 while still queued. Acquiring again refreshes it: a lock not refreshed for
  45 minutes while none of the resource's processes runs is taken over by the next in line.
- Release on every path, failures included. Prefer `run` whenever the work fits in one command, because it cannot
  forget.
- Never hold a lock while reading, thinking or editing.

## See who has what

`aw lock status [<resource>] [--all]` lists the locks: the holder, what for, since when, and the queue in order
(`--all`: other repositories' too). Read it before guessing why something is slow. "Running without a lock" is the
person's own instance, or a leftover: wait or ask, never kill it.

## Two locks

A session that takes two locks takes them in the order the repository declares: `"lockOrder": ["test-db",
"devserver", "simulator"]` in `.agents/agent-works.json`, and releases in reverse. Taking them out of order prints
a warning, because two sessions taking one pair in opposite orders wait on each other forever.

## The guard

Where the config declares the commands that start a resource (`resources.<name>.match`), the guard notices such a
command run outside its lock. It warns by default; `"guard": { "locks": "deny" }` makes it refuse. Sharing rather
than excluding (a training job on a GPU others still use), timing runs, and notes to other sessions are the
`coordinate` skill.
