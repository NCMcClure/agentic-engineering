---
name: ship
description: "Take finished work from the working tree to an open pull request or merge request: branch if needed, commit with a conventional subject, confirm the tests ran, ask before pushing, and open the change request on the repo's forge. Use when the user says ship it, open a PR, open an MR, or push this. --stack targets the branch below instead of the default branch; --draft opens it as a draft. To merge it afterwards use land."
argument-hint: "[--stack] [--draft]"
---

# ship

Everything between "the work is done" and "the change request is open". The guard hook blocks the mistakes; this is the sequence that avoids them. It works the same on GitHub and GitLab: the forge is reached only through `scripts/mr.mjs`.

## Step 1: Check the state

```bash
git status --short --branch
git log --oneline "$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo HEAD)"..HEAD
node "${CLAUDE_PLUGIN_ROOT}/scripts/mr.mjs" check
```

`check` names the forge and what it calls a change request (a pull request or a merge request; use its word from here on), and says whether its CLI is installed and signed in. If it is not, give the person the line it printed and stop before pushing: signing in is theirs to do.

If the current branch is the default branch, create one first: `git switch -c <type>/<topic>` with `feat`, `fix`, `chore`, `docs`, `test`, or `ci`, or the prefix the session briefing names. Committing to the default branch is denied, so this is not optional.

*Done when: the branch is not the default branch, the set of changes to land is known, and the forge can be reached.*

## Step 2: Confirm the tests ran

Name the lanes the change touched and say whether each was run in this session, from the marker's `lanes` in `.agents/manifest.json` (the session briefing names them; `node .agents/scripts/lane.mjs <lane>` runs one). If a lane that covers the change has not run, run it now. Do not open a change request on an untested change and let CI find out; that spends a reviewer's round trip.

*Done when: every lane covering the change has been run in this session, or the person has been told which one was skipped and why.*

## Step 3: Commit

Stage deliberately (`git add <path>`, never `git add -A` unless you have read `git status` and know every entry). Write a conventional short subject and a body that says why. Backticks in `-m "..."` run as command substitution: use a heredoc with a quoted delimiter, then confirm with `git log -1 --format=%B`.

*Done when: the commit exists and its message reads back as written.*

## Step 4: Ask, then push

Pushing is the point where work leaves the machine. First look for a push the person approved ahead of time:

```bash
git config --get "branch.$(git branch --show-current).agentic-engineering-push"
```

If it prints a grant, say so in one line, quoting it, and push: the guard lets this branch's own push through without asking. Otherwise ask, in one line, naming the branch and the remote, and wait for a yes. Then:

```bash
git push -u origin "$(git branch --show-current)"
```

The grant covers that push and nothing wider: any other flag, refspec, remote, or a command chained onto it asks again, and a force push or a push to the default branch is still denied.

A person grants a branch in their own terminal: `git config branch.<b>.agentic-engineering-push "<who> <iso date>: push and open the change request"`; `git config --unset branch.<b>.agentic-engineering-push` takes it back. Granting is the person's call: never record a grant the person did not give.

*Done when: the branch is on the remote, after a yes or under a grant.*

## Step 5: Open the change request

The title is the commit subject, or one line for the whole branch when it has several commits. The body says what changed and why, and how it was tested; it goes in on stdin, so backticks and quotes need no escaping:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mr.mjs" open --title "<subject>" --body-file - [--draft] [--target <branch below>] --json <<'BODY'
<what changed and why>

<which lanes ran>
BODY
```

With `--stack`, pass `--target` the branch below this one instead of leaving it to the default branch. Run it twice and the second run reports the request the first one opened (`created: false`) rather than failing.

Report `url` and `number`. Do not merge here. Landing comes after the review, through `/agentic-teamwork:land`: it waits on the checks in the background, asks the person for an approval where the repo needs one, and merges the reviewed head on green. A stack lands from the bottom, also through `land`.

*Done when: the URL is reported.*

## When the forge cannot be asked

`mr.mjs` exits 7 and says which of these it is, with the one line that fixes it: the forge is not known (pass `--forge github` or `--forge gitlab`), its CLI is not installed or not signed in, the network or a proxy is in the way, or the account may not do this here. Relay the line and stop; retrying a sign-in or a permission problem fixes nothing.
