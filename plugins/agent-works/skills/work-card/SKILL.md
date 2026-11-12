---
name: work-card
description: "Use when this session was started to work one card from the board, by a brief or by a work-card command naming the card."
argument-hint: "<card id>"
---

# work-card

You are a child of an orchestrated round. The session that started you reviews your pull or merge request and
merges it; your job ends at a request ready for review and an honest report. `aw board` below is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board`; your brief has the same commands with absolute paths.

## Step 1: Read the brief

If it is not already in your first message (a terminal start, or after a compaction), print it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board brief <id>
```

It has the task, the done criteria, your files, the files that are not yours, and the branch your push grant
covers.

## Step 2: Branch, then claim

```
git switch -c <the card's branch>
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board claim <id>
```

The branch is the one the grant names (`branch:` in `aw board show <id>`; `<type>/<topic>` of your choosing when
the card has none). The claim records the branch and worktree on the card and writes the person's push grant to
the branch's git config. If it refuses, read why: in the main checkout you are in the wrong place; a branch
another card holds, or one other than the granted branch, means switching to the right branch, or stopping and
reporting `blocked`.

## Step 3: Sync with the base

`git fetch origin`, then `git merge origin/<base>`. Never rebase a pushed branch.

## Step 4: Build test-first

- Write the failing test, make it pass, commit at each green step with a subject that says what changed. Where
  agentic-teamwork is installed, `/agentic-teamwork:tdd` is that cadence; a plan card built with
  but-first-planning follows `/but-first-planning:build-tdd`.
- A task judged by eye or ear (a `look`, `motion` or `sound` label): where perceptual-loop is installed, load its
  skills before the first test.
- Anything only one session can use at a time (a port, a simulator, a database, a timing run) goes through
  `/agent-works:resource-locks`, with `--as card-<id>`.
- A file on your brief's not-yours list belongs to another child right now. Do not edit it; if the task needs it,
  stop and report `blocked`.
- The card-sync hook watches your work. When it says the card owes a move, make it; when it asks whether the card
  still stands where it is, move it or answer in one line. `aw board note <id> "<where it stands>"` records
  progress on a long card.
- A check you cannot run (credentials, a device, a person's eye) is owed, never claimed:
  `aw board owe "<what>" --ref <request or commit> --needs <who or what>`. Work outside the card goes on the board
  instead of into this branch: `aw board add "<title>" --suggest --details "<what you saw>"`.

## Step 5: Ship

Run the repository's checks before pushing, and name each one you ran. The grant covers exactly one command, run
on its own:

```
git push -u origin <the card's branch>
```

A chained command, another flag, or another refspec is not covered and asks the person. Open the pull or merge
request (`gh pr create`, `glab mr create`, or `/agentic-teamwork:ship` where that plugin is installed), then:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board move <id> review --mr <number>
```

Never merge, approve, tag, force push, or pass `--no-verify`, and never write or remove a grant yourself.

## Step 6: Report

The first line of your final message is the CARD line, because only the start of the message is quoted to the
session that started you:

```text
CARD <id> <review|blocked|failed> !<number> lanes=<lane>:<pass|fail>,... owed=<items|->
```

`!-` when there is no request, `lanes=-` when no check ran, and `owed=` lists the gate ids you filed or a short
name for each check left undone. After it, in the form of `${CLAUDE_PLUGIN_ROOT}/assets/templates/report.md`: the
verdict, the evidence (each check, the exact command, its result), what is not verified, the decisions you made,
and anything that needs the person. In a terminal session, a `blocked` or `failed` CARD line also goes at the top
of a `## Report` section in the card's file, which the brief names, so a waiting `aw board wait` sees it.

## When findings come back

They arrive as a message here, or are under `## Review` in the card (`aw board show <id>`). Fix them on the same
branch, commit, push the same way, `aw board move <id> review --mr <number>` again, and report again with a new
CARD line. When you are told the base moved, sync with a merge, regenerate any generated file instead of merging
it by hand, re-bump a version once above the base's, re-run your checks, and push.
