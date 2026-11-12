---
name: review-card
description: "Use when a child session reports its card in review, by its CARD line, a note from its session, or a board wait waking: check the diff against the done criteria, send findings back, land it on green, close the card."
argument-hint: "<card id>"
---

# review-card

A child's "passed" is a claim until checked, and a merge is the one step that cannot be taken back. This skill is
the check, then the landing. `aw board` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board`.

## Step 1: Read the report and the card

The CARD line is the first line of the child's report. `blocked` or `failed` is not a review: answer the child, or
take the question to the person. For `review`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board show <id>
git fetch origin
git diff --stat origin/<base>...origin/<branch>
```

`show` gives the done criteria, the branch, the worktree, and the request's number.

## Step 2: Check the work, in proportion to the risk

- **The diff against the done criteria.** `git diff origin/<base>...origin/<branch>`: each criterion is met and
  shown by a test or a command, and nothing outside the card's scope came along.
- **The evidence.** Each check the report names has its command and its result. Re-run the cheapest one yourself
  in the child's worktree when anything looks off.
- **What must not ship.** Machine paths, credentials, debris from the session.
- **Risky cards** (security, a migration, a shared format, or more than about 400 changed lines): a second reader
  that sees only the done criteria and the diff, never the child's report or your own view. Without subagents,
  `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/subagent-fallback.md` says what to do instead.
- **Run it.** A smoke test from a scratch repository, or render the picture and look at it, as far as the risk
  calls for. Where code-diet is installed, `/code-diet:review-diet` in the child's worktree.

## Step 3: Send findings back

Findings go to whoever owns the branch: a message to the card's session, or, for a terminal child, under
`## Review` in the card's file. Then put a loose card back to work with `aw board move <id> in-progress`. Leave a
plan card (an id like `01-02-03`) in review and say so: moving it back would undo the child's status change. Wait
for the next report and review again from Step 1.

## Step 4: Land it

Merge only the head you reviewed, after its checks are green: `gh pr merge <number>` or `glab mr merge <number>`,
or `/agentic-teamwork:land <number>` where that plugin is installed. A red pipeline goes back to the child with
the failed jobs; a conflict tells the child to sync.

Requests that share files merge one at a time. Compare each one's `git diff --stat` with what merged since its
branch was cut:

- **Disjoint**: it touches nothing that merged in between, so it lands straight away.
- **Sharing a generated file or a version line**: after each merge, the next child syncs with
  `git merge origin/<base>` (never a rebase or a force push), regenerates the generated file, re-bumps once above
  the base's version, and pushes. Before waiting on its checks, look at the sync: the branch contains
  `origin/<base>`, the versions are right, and both sides' entries are kept.

## Step 5: Close the card

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board done <id> --merged <merge commit sha>
```

It moves the card to done, records the merge, revokes the branch's push grant, and closes the epic when this was
its last card.

## Step 6: Tell the others, and keep what was owed

- Every child still in flight gets one message: "<base> moved to <sha>: sync with a merge and re-run your checks."
  For a terminal child, write it under `## Review` in its card. A note reaches the rest:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" note "<base> moved to <sha>"`.
- Each item after `owed=` that is not already a gate on the board becomes one:
  `aw board owe "<what>" --ref <the request> --needs <who can settle it>`.
- Each card the child filed with `--suggest` is offered to the person.

Then back to `/agent-works:orchestrate`: the next card.
