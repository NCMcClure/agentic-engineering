---
name: land
description: "Use when a reviewed pull request or merge request should land: its checks are waited on in the background and it is merged on green. Reads the request, waits only on states that resolve by themselves, merges only the head that was reviewed and removes the source branch, then brings the base checkout level; red checks go back to the branch's owner and a missing approval to the person. Also how to merge a stack from the bottom. To open the request in the first place use ship."
argument-hint: "<number> | --branch <b>"
---

# land

Everything between "the review is done" and "it is on the base branch". `ship` opens the change request; this lands it. The forge half is `scripts/mr.mjs`, which works the same on GitHub and GitLab and reads the repository off the checkout's remote, so run it from inside the repo. Every verb takes `--json`. `<n>` is the pull request number or the merge request iid.

## Step 1: Read it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mr.mjs" status <n> --json
```

`--branch <b>` finds the open request from a branch instead. Note `sha`, the head. It has to be the head the review read: if commits arrived after the review, read them before going on, and take the new head as the reviewed one only once you have.

*Done when: the reviewed head sha is known and equals `sha`.*

## Step 2: Wait, in the background

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mr.mjs" wait <n> --json
```

Run it as a background command and carry on; you are told when it exits. It re-reads every 10 seconds for up to 9 minutes (`--interval`, `--timeout`), keeps waiting only while the forge is still computing the merge status or the checks are queued or running, and starts the checks itself, once, when the forge wants them and the head has none. It stops at once on a blocker no check result clears. Never poll the checks by hand, schedule wake-ups, or hand the person a page to watch.

*Done when: wait exited with a code other than 3.*

## Step 3: Act on the exit code

| Exit | Means | Do |
| --- | --- | --- |
| 0 | mergeable, and green where there are checks | Step 4. |
| 1 | the checks failed or were canceled | Send `checks.url` and `checks.failed` to whoever owns the branch: the session that pushed it, or the person. Do not fix someone else's branch from here. Wait again after their push, and read what it changed. `mr.mjs retry <n>` reruns the failed checks, for a failure the owner calls a flake. |
| 3 | still waiting at the timeout | Run wait again. |
| 4 | needs an approval | Ask the person to approve. Run `mr.mjs approve <n>` only when the person said the agent may approve as them, for this request or this round: it approves under their account. Then wait again. |
| 5 | conflicts, or the branch is behind its target | Sync the branch with its base: `git fetch origin && git merge origin/<target>` on the branch, resolve, commit, and push (ask first, as for any push). Never rebase a pushed branch or force push. The sync moves the head, so read the resolution, take the new head as reviewed, and wait again. |
| 6 | any other blocker | Tell the person the `reason`: a draft, a block, a check waiting on a person, or a request already merged or closed. |
| 7 | the forge could not be asked | Relay the message: it names the cause (unknown forge, CLI missing or signed out, network, not found, forbidden) and the fix. Stop; retrying will not help. |

*Done when: wait exited 0, or the blocker is with the person or the branch owner who can clear it.*

## Step 4: Merge the reviewed head

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mr.mjs" merge <n> --sha <full reviewed head sha> --json
```

It refuses unless the request is mergeable and its head is `--sha`, then merges with a merge commit, removes the source branch, and prints `mergeSha`. The sha is the full 40 characters; a forge refuses a short one. `--method squash` or `--method rebase` when the repo's own rules say so; `--keep-branch` to leave the source branch.

A refusal exits 1 and says why. A moved head means unread commits: go back to Step 1. On GitLab, squash still reading on after the script turned it off means the project requires squash, which the person has to know before a stack lands through it.

*Done when: `merged` is true and the merge sha is reported.*

## Step 5: Bring the base checkout level

Fast-forward the local checkout of the base, only when it is clean and on the base branch (`git status --porcelain` prints nothing). In a worktree session that checkout is the main one, the first entry of `git worktree list`:

```bash
git -C <base checkout> pull --ff-only origin <target>
```

A dirty checkout, or one on another branch, is left alone and named to the person. Then tell every session still working on a branch off the old base that the base moved, so it syncs and re-runs its lanes.

*Done when: the base checkout is at the merge commit, or the person knows why it is not.*

## Step 6: Tag the release, where the repo releases by tag

Only where the repo's own rules say a release is a tag. Tag the merge commit the way those rules name it, and ask before pushing the tag: a tag leaving the machine is a push like any other.

*Done when: the tag is on the merge commit and pushed after a yes, or the repo does not release by tag.*

## Merging a stack

Merge from the bottom. Once the request below merges with its source branch removed, the forge retargets the next one to the base; run wait on the next one before merging it, since its merge status is recomputed after the retarget.

- **Do not squash a stack.** A squashed bottom request leaves the next one in conflict. `mr.mjs merge` uses a merge commit by default, and on GitLab turns the request's own squash flag off and reads it back first.
- **If one was squashed anyway**, and `git diff <original commit> <squash commit>` is empty, run `git merge -s ours origin/<base>` on the next branch and push it normally. Never force push.
- **A retarget can drop the checks**, leaving the forge waiting on checks the head does not have. wait starts them itself, once.
