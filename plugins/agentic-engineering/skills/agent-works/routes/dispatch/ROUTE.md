---
name: dispatch
description: "Use when a card on the board should start: the person approved a parallel set, the orchestrator picked the next ready card, or the kanban pane asked to start one."
argument-hint: "<card id> [--serial]"
---

# dispatch

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

One card, from ready to being built in its own git worktree: by a subagent, or by a child session where the
person asked for sessions. `aw board` below is
`node "W/scripts/aw.mjs" board`.

## Step 1: Check it can still start

```
node "W/scripts/aw.mjs" board propose --ids <id>
```

Something may have started since the person said yes. If the card is held now, say why and wait for the card it
waits on, or ask the person. If it carries no grant (`aw board show <id>` has no `grant:` line), the person has not
approved its push: ask, or start it knowing its push will ask the person.

*Done when: the card runs in the proposal, and its grant is on it or the person knows it has none.*

## Step 2: Bring the base up to date

A child's worktree is cut from the local base branch, so a stale base starts the child behind. In the main
checkout, when it is clean and on the base branch:

```
git -C <main checkout> pull --ff-only origin <base>
```

A dirty checkout, or one on another branch, is named to the person rather than touched. When a fix to a hook or
the guard has landed since this session started, the installed plugin is still the old one, and a child loads
plugins when it starts: `claude plugin update <name>@<marketplace>` first.

*Done when: the base is at origin's head, or the person knows why not.*

## Step 3: Write the brief

```
node "W/scripts/aw.mjs" board brief <id>
```

It prints the child's whole prompt: the task, the done criteria, its files, the other children's files as not its
own, the cadence, the one push its grant covers, and the CARD line it ends with. Read it once as the child will.
It refuses a card with no done criteria: write them with the person first.

*Done when: you have the brief, and it reads as a task a stranger could finish.*

## Step 4: Start the child

**By default, a subagent.** Unless the person asked for sessions (their words, a Start press in the board pane,
or an approved plan whose unit says `session`), the card is built by one subagent, which asks nothing more of
them. Make the card's worktree, bind the card, and send the brief as the whole prompt:

```text
git worktree add <path> -b <the card's branch> origin/<base>
node "W/scripts/aw.mjs" board bind <id> --subagent
```

Then one Agent call: the brief from Step 3 as its prompt, with a first line telling it that every command runs in
`<path>`, and `model` set one tier below this session and never below Sonnet (the card's pin wins). One subagent
per card; a set's calls go in one message. When it returns, review its diff as the `review-card` route says before
anything merges: you did not write it, and its "passed" is a claim. Remove the worktree once the card is done.

**A child session, when the person asked for one** (the desktop app's `start_session` tool). Start it as a session
of its own, with the person's yes as the ask:

```text
start_session {
  initiation: "user_asked", context: "fresh", use_worktree: true,
  name: "card-<id>", branch_name: "<short slug>", source_branch: "<base>",
  model: "<the child's model id, or left out>",
  prompt: "<the brief>",
  background: "<the round's goal, what the person decided, the constraints, and where this card fits: 80 characters or more>",
  wake_when_done: true
}
```

`background` is text, not a flag. A fresh session is refused without at least 80 characters of it, and it does not
stand in for `prompt`: the brief carries the card, the background carries what the child has not seen of this
conversation. `branch_name` is a slug, not the branch: the host puts a prefix before it and a suffix after it, so
the worktree starts on a branch the grant does not cover. The child creates the granted branch itself in its
first step, and the push grant is written to that one. Leave the permission mode alone so the child inherits this
session's.

`model` is where the round's step-down happens. A child runs one tier below this session and never below Opus:
from Fable, pass the current Opus model's id, written the way this session's own id is written; from Opus or
below, leave `model` out and the child inherits. The card's `model:` line is the person's word and wins
(`aw board show <id>` has it, and `aw board propose` prints it beside the card): `inherit` leaves `model` out
whatever this session runs on, and a family name (`fable`, `opus`, `sonnet`, `haiku`) is passed as that family's
current id. Then record it:

```
node "W/scripts/aw.mjs" board bind <id> --session card-<id>
```

**In a terminal.** Print the command for the person to run in a new terminal, record it, and wait in the
background:

```
claude -w card-<id> --model <family> "/agentic-engineering:agent-works work-card <id>"
node "W/scripts/aw.mjs" board bind <id> --terminal
node "W/scripts/aw.mjs" board wait --until review --ids <id>
```

`<family>` is the child's model by the same rule, as a family name (`opus`, `sonnet`). Always name it here: a new
terminal session starts on the person's default model, not on this session's.

Run `aw board wait` as a background command. It exits 0 when the card reaches review or the child writes a CARD
line into it, and 3 at its timeout: then run it again.

**With `--serial`** (the pane passes it when the board is in queue mode), **or where no subagent, session or terminal is possible**, work the card here, serially, as
`W/routes/orchestrate/references/subagent-fallback.md` describes: a worktree of its own on the card's branch,
`aw board bind <id> --serial`, then `/agentic-engineering:agent-works work-card` with that worktree as the working directory.

*Done when: the subagent or the child is running (or the person has the command) and `aw board show <id>` names how it is worked.*

## Step 5: Say what started

One line to the person per card: the card, the session, the branch. `bind` moved it to in progress, so the board
already says so.
