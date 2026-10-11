---
name: setup
description: Use to set a repository up for agent work, adopt its agent files, or install aw.
---

# setup

`aw setup` writes what is missing and never overwrites what is there. On a repository that already has agent
files it keeps the prose, reports what is in the wrong place, and leaves every move to you and the owner.

## Step 1 — Plan

```
aw setup --plan
```

It writes nothing. Read every line: `create`, `add to`, `regenerate`, `move`, `twins` are what `--apply` will do;
`keep` is yours and stays; `REPORT` is something in the wrong place, with the commands that move it.

*Done when: you can say whether the repository is fresh or adopted, and you have the list of REPORT lines.*

## Step 2 — Interview the owner

Ask only what the plan and the tree did not answer, in one batch:

1. **CLAUDE.md twins:** `generated` (git-ignored, healed at session start; the default), `committed`, or `off`.
2. **The kanban board:** `tracked` (committed, shared through git; the default) or `ignored` (local, or synced
   with GitHub or GitLab issues from the `/kanban` pane).
3. **Owner files:** files local to the owner's machine that must never be staged or edited by an agent.
4. **Generated files:** paths written by a tool, and the command that writes them.
5. **Scarce resources:** applications or devices of which one runs at a time, the commands that start them, and
   whether one exists per project or per machine.
6. **Expensive runs:** commands whose cost grows with a count (a test matrix, a render suite), and how many items
   are free.
7. **Shared counters:** numbers several branches bump (a schema or format version).
8. **For each REPORT line**, what to do now:
   - decision records under the user docs (`docs/adr`), a glossary at the root or under the docs: move with
     `git mv`, or leave for later;
   - an old `.agents/board`: move it (it keeps working until then);
   - a `.plan/` workspace: but-first-planning 4.0 moves it to `.agents/plan/` itself;
   - a `.perceptual-loop/` folder: its applications become `resources` in the config;
   - a root `CLAUDE.md` with content of its own: move the content into `AGENTS.md`;
   - an `.agents/README.md` this plugin did not write: merge it into `AGENTS.md`, or delete it.

*Done when: every question has an answer or an explicit "later", and each "later" is a line in your report.*

## Step 3 — Apply

```
aw setup --apply --twins <generated|committed|off> --kanban <tracked|ignored>
```

Then, for each move the owner agreed to, run the `git mv` the plan printed (a tracked `.agents/board` moves with
`git mv .agents/board .agents/kanban`; an untracked one with `--move-board`), then `aw decisions index` and
`aw links` to find what the moves broke. Fill answers 3 to 7 into `.agents/agent-works.json`: that is the `guard`
skill's Step 2, and `${CLAUDE_PLUGIN_ROOT}/core/references/guard-config.md` documents every key.

`aw setup --apply` fills the templates of `${CLAUDE_PLUGIN_ROOT}/assets/templates/`: `config.json`,
`agents-readme.md`, `agents-root.md`, `memory-index.md`, `status.md`, `glossary.md`, `gitignore-twins`,
`gitignore-kanban`. Do not write those files by hand.

*Done when: a second `aw setup --plan` shows no `create` line and only the REPORT lines the owner deferred.*

## Step 4 — Fill what only a reader of the code can write

- A new root `AGENTS.md` has four placeholders in angle brackets: what the project is, the repo map, the
  commands, the rules. Fill them from the code and the README. 200 lines at most.
- The status memory's Goal, from the owner.
- Hubs for the non-leaf code directories: the `hubs` skill.
- An existing root `AGENTS.md` is not rewritten here. Slimming it is the `doctor` skill.

*Done when: no `<…>` placeholder is left in the root `AGENTS.md` or the status memory.*

## Step 5 — The launcher and the permission rule

Both change the owner's own machine. **Ask before each; do neither unasked.**

- `aw setup --install-launcher [DIR]` writes `aw` and `aw.cmd` into a folder on the PATH (default `~/.local/bin`),
  so `aw` also runs in PowerShell, in hooks and in the owner's terminal. The Bash tool needs none.
- One allow rule lets agents and sub-agents run `aw` without a prompt: `Bash(aw:*)` in `permissions.allow` of the
  owner's Claude Code settings. Everything outside the repository goes through that one command, so one rule
  covers it. Show the owner the line; add it only on a yes.

*Done when: the owner has answered both, and `aw --help` runs in the shell the owner uses.*

## Step 6 — Baseline

```
aw doctor --baseline
```

It records today's sizes and finding counts; later runs print what moved. Report the counts and the files to
commit (everything under `.agents/`, the root `AGENTS.md`, `.gitignore`). Do not commit unless asked. Findings on
an adopted repository are the `doctor` skill's work, not a failure of setup.

*Done when: the baseline is written, and the owner has the finding counts and the list of files to commit.*
