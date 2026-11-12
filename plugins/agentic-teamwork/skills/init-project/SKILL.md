---
name: init-project
description: "Put a repo on the team conventions: scaffold a new one from a template, or run --upgrade to put the marker, the hub, the CI gate, the permission rules and the pre-commit hook around a repo that already exists, or to bring an earlier scaffold forward. Use when starting a new repo, when the session briefing or audit-project says to run the upgrade, or to turn on the strict test gate with --strict. Local only: it creates nothing on a forge and pushes nothing. To check a repo that is already set up use audit-project."
disable-model-invocation: true
argument-hint: "[--upgrade] [--name <n>] [--template library|node-service] [--forge github|gitlab|none] [--strict] [--dry-run]"
---

# init-project

Two jobs behind one script. A fresh scaffold lays down a starter and the conventions together. `--upgrade` puts the conventions around a repo that already has files, or brings an earlier scaffold up to this version, and writes nothing the second time it runs. Either way everything stays on this machine: no repository is created anywhere, nothing is committed, nothing is pushed.

What a repo gets: `.agents/manifest.json` (the marker that turns the plugin's rules on for everyone who opens the repo), the root `AGENTS.md` hub and its `CLAUDE.md` link, three small scripts in `.agents/scripts/`, a managed block in `.gitignore`, the CI gate for its forge, the shared permission rules in `.claude/settings.json`, and `.githooks/pre-commit` for commits made outside an agent.

## Step 1: Ask only what you cannot read

Read the folder first: its name, any README or package manifest, its `origin` remote.

1. **One line on what it is**, 120 characters or fewer, no double quotes. It becomes the first line of the README and the hub. Offer a draft; never leave it blank on a new repo.
2. **Template**, for a new repo only: `library` (a zero-dependency Node package with one unit lane) or `node-service` (a Node 22 service with unit and integration lanes, an optional browser lane, a Dockerfile). A repo with code of its own takes `--upgrade` and no template.
3. **Forge**, only when the folder has no remote yet, or its host name says neither: GitHub or GitLab. With neither known the script writes no CI gate and says so; `--upgrade` adds it once the remote exists.
4. **The strict test gate?** Off unless asked for. `--strict` writes a `teamwork` block into the marker that makes a failing test command refuse a commit and hold a stop. Offer it; do not assume it.

*Done when: the description is confirmed, and for a new repo the name and template are too.*

## Step 2: Dry run

```bash
# a new repo, in ./<name> (or --target <dir>)
node "${CLAUDE_PLUGIN_ROOT}/scripts/init-project.mjs" --name <name> --template <t> --description "<one line>" [--forge github|gitlab] --dry-run

# a repo that already has files, from its root
node "${CLAUDE_PLUGIN_ROOT}/scripts/init-project.mjs" --upgrade [--description "<one line>"] [--forge github|gitlab] --dry-run
```

It writes nothing and prints every path it would write. On an upgrade, read the `keep` lines: a file the scaffold did not write is never overwritten, and a file it wrote that somebody edited is kept with the diff shown.

*Done when: the plan has been read and the person has confirmed it.*

## Step 3: Run it

Drop `--dry-run`. The run ends by running the repo's own `verify-standard.mjs`. On a fresh scaffold a finding is a defect in the template. On an upgrade it is the repo's own to fix, usually a `CLAUDE.md` that has content beside an `AGENTS.md`, or a `.gitlab-ci.yml` whose `include:` the script would not rewrite; the message names it.

Other flags, when the person asks for what they do:

| Flag | Does |
| --- | --- |
| `--strict` | Writes `"teamwork": { "requireTestsPass": true, "test": { "command": ... } }` into the marker. The command is `--test-command "<cmd>"`, else the unit lane, else what the repo's manifests say. |
| `--default-branch <b>` | Names the branch every change lands on, when it is not the remote's default. |
| `--claude-md import` | Makes `CLAUDE.md` a one-line `@AGENTS.md` file instead of a symlink. The default on Windows. |
| `--hooks-path` | Also runs `git config core.hooksPath .githooks` in this clone. Ask first: it changes how the person's own commits behave. |
| `--no-plugin-check` | Leaves out the session hook that offers the plugin to a teammate who does not have it. |
| `--force` | On upgrade, overwrites files edited since they were written. On a fresh scaffold, writes into a folder that has files. Only on an explicit yes. |

*Done when: the run printed `verify-standard.mjs: conventions ok`, or the person knows which findings are theirs.*

## What an upgrade does to a repo that was already set up

- A repo whose instructions live in `CLAUDE.md` keeps every word: the file is renamed to `AGENTS.md` and `CLAUDE.md` becomes the link to it.
- A repo on the plugin's first layout (`.claude/teamwork.json`) has every rule that file enforced written into the marker's `teamwork` block, so nothing loosens. Its shell pre-commit hook is replaced by the one-file hook and parked under `.agents/retired/agentic-teamwork/`, in case the team added steps to it. The next session with the plugin enabled retires the rest of the old files.
- A script or rule the marker owns that this version no longer ships is removed if untouched, and kept as the repo's own if edited.
- The second run prints `nothing to do`. If it writes something, the first run left the repo in a shape worth reading before going on.

## After it finishes

Nothing is committed. Report the template, the forge, the default branch, and the four lane commands from the marker's `lanes`. Then:

- A repo with no commits takes its first commit on the default branch; the git guard allows exactly that one. A repo with history commits the upgrade on a branch (`git switch -c chore/team-conventions`) and lands it like any other change (`/agentic-teamwork:ship`).
- The pre-commit hook does nothing until a clone turns it on: `git config core.hooksPath .githooks`, once per clone. Say so; do not run it unasked.
- The forge's own branch protection (reviews required, checks required) is set in its settings by a person with the rights. The CI gate gives it a check to require.
