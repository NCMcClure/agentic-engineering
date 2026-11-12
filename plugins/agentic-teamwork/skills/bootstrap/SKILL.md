---
name: bootstrap
description: "Put a new or not-yet-set-up repo on the team conventions before any code is written in it: three questions, one local run, and the rules, lanes and checks are live for everything written after. Use when the session briefing says the repo is not on the team conventions yet, or when starting a project in an empty folder. Nothing is created on a forge and nothing is pushed. For the full set of options use init-project; to check a repo already set up use audit-project."
disable-model-invocation: true
---

# bootstrap

A repo is cheapest to set up before its first commit, and that is the moment everyone forgets. This is the short path: read the folder, ask what cannot be read, run `init-project.mjs` once.

## Step 0: Is there anything to do?

If `.agents/manifest.json` exists, stop: the repo is set up, and `/agentic-teamwork:audit-project` checks it. Otherwise read before asking: the folder's name, any README or package manifest, its `origin` remote, and whether it has files of its own yet.

## Step 1: Ask only what you cannot read

1. **One line on what it is**, 120 characters or fewer. It becomes the first line of the README and the hub. Offer a draft from what you read.
2. **Template**, only when the folder has no source yet: `library` (a zero-dependency Node package) or `node-service` (a Node 22 service with a Dockerfile). A repo with code of its own keeps its code and gets the conventions around it.
3. **Forge**, only when there is no remote yet or its host name says neither: GitHub or GitLab. "Not decided" is an answer: the CI gate is added later.

The name is the folder's name unless the person says otherwise.

*Done when: the person has confirmed the description, and the template and forge where they were asked.*

## Step 2: Dry run, then run

From the repo root. An empty folder (nothing but dotfiles or `.git`) takes the full scaffold; a folder with files of its own takes `--upgrade`, which never overwrites a file it did not write.

```bash
# empty folder: the conventions plus the template's starter source
node "${CLAUDE_PLUGIN_ROOT}/scripts/init-project.mjs" --target . --name <name> --template <t> --description "<one line>" [--forge github|gitlab] --dry-run

# files already here: the conventions only, around them
node "${CLAUDE_PLUGIN_ROOT}/scripts/init-project.mjs" --upgrade --description "<one line>" [--forge github|gitlab] --dry-run
```

Read the plan, then drop `--dry-run`. A fresh scaffold refuses a folder that has files in it, so a wrong guess fails instead of overwriting. The run ends with the repo's own check; a finding on an upgrade is the repo's to fix, and the message names it.

*Done when: the run printed `verify-standard.mjs: conventions ok` and `.agents/manifest.json` exists.*

## Step 3: Commit

A repo with no commits yet takes its first commit on the default branch; the git guard allows exactly that one, since there is no base to branch from. A repo with history commits on a branch (`git switch -c chore/team-conventions`) and lands it like any other change.

From the next session on, the working rules arrive from the plugin's session hook and the lane commands from the marker's `lanes`. Write tests first (`/agentic-teamwork:tdd`).

## Step 4: The forge, when the person asks

Never push on your own. This skill creates no remote repository: the person makes one (the forge's site, or its CLI) and adds it as `origin`. Then:

- If no CI gate was written because the forge was not known, run `init-project.mjs --upgrade` again; it reads the forge off the remote.
- `/agentic-teamwork:ship` pushes the branch, after asking, and opens the change request.
