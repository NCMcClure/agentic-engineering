---
name: ship
description: "Take finished work from the working tree to an open pull request or merge request: branch if needed, commit with a conventional subject, confirm the tests ran, ask before pushing, open the change request on the repo's forge, and see its checks watched. Use when the user says ship it, open a PR, open an MR, or push this. --stack targets the branch below instead of the default branch; --draft opens it as a draft. To merge it afterwards use land."
argument-hint: "[--stack] [--draft]"
---

# ship

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

Everything between "the work is done" and "the change request is open and its checks have an answer". The guard hook blocks the mistakes; this is the sequence that avoids them. It works the same on GitHub and GitLab: the forge is reached only through `scripts/mr.mjs`.

## Step 1: Check the state

```bash
git status --short --branch
git log --oneline "$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo HEAD)"..HEAD
node "W/scripts/mr.mjs" check
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
node "W/scripts/mr.mjs" open --title "<subject>" --body-file - [--draft] [--target <branch below>] --json <<'BODY'
<what changed and why>

<which lanes ran>
BODY
```

With `--stack`, pass `--target` the branch below this one instead of leaving it to the default branch. Run it twice and the second run reports the request the first one opened (`created: false`) rather than failing.

Report `url`, and note `number` for Step 6. Do not merge here. Landing comes after the review, through `/agentic-engineering:delivery land`: it waits on the checks in the background, asks the person for an approval where the repo needs one, and merges the reviewed head on green. A stack lands from the bottom, also through `land`.

*Done when: the URL is reported.*

## Step 6: See the checks watched

Someone has to hear when the checks finish. Which of two cases this is decides who:

- **A GitHub pull request, in a session the desktop app runs.** The app's PR panel, its PR tools, and Auto-fix watch the pull request's checks and wake you when they change. You are in this case only when the host's own instructions say it watches the pull request's CI. Follow them: do not poll, do not start the wait below, do not schedule a wake-up. Say in one line that the app is watching, and the step is done.
- **Every other case: a GitLab merge request in any host, or a GitHub pull request where no app is watching (a terminal session, a headless run).** Those tools read GitHub only and never see a merge request, and the instruction not to poll CI is about the pull requests they watch, so it does not cover this one. Nothing wakes you, so start the watch yourself:

```bash
node "W/scripts/mr.mjs" wait <number> --checks --json
```

Start it as a background command the moment the request is open, say in one line that the checks are being watched, and carry on or end the turn; you are told when it exits. Where the host has no background command, run it in the foreground. `--checks` judges the checks on the head alone, so the approval a fresh request is still missing, or its draft flag, does not end the watch early (`--pipeline` is the same flag). Never tell the person the checks are not being watched, hand them a page to watch, or ask them to say when to check.

| Exit | Means | Do |
| --- | --- | --- |
| 0 | the checks are green | Tell the person, with the URL; the review comes next, then `/agentic-engineering:delivery land`. |
| 1 | the checks failed or were canceled | The branch is yours: read `checks.failed` and `checks.url`, fix the cause, then Steps 2 to 4 again, and watch again. |
| 3 | no answer yet at the timeout | Run it again. If `checks.state` is still `none` the second time, the repo may run no checks on a request: say so and stop. |
| 6 | the request was closed or merged, or a check is waiting on a person | Tell the person the `reason`. |
| 7 | the forge could not be asked | See below. |

*Done when: the app is watching, or the watch exited 0 and the person was told, or failed checks are being fixed, or the person knows what stopped it.*

## When the forge cannot be asked

`mr.mjs` exits 7 and says which of these it is, with the one line that fixes it: the forge is not known (pass `--forge github` or `--forge gitlab`), its CLI is not installed or not signed in, the network or a proxy is in the way, or the account may not do this here. Relay the line and stop; retrying a sign-in or a permission problem fixes nothing.
