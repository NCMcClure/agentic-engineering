---
name: guard
description: Use when the agent guard refuses a command, or a mistake must not happen again.
---

# guard

The guard is a hook that reads each command and edit before it runs and refuses the mistakes this project has
already paid for: staging the whole tree, touching the owner's own files, hand-editing generated files, starting
a scarce application without its lock, an expensive run without its reason. It is on when
`.agents/agent-works.json` exists, and does nothing without it. Every key of that file is documented in
`${CLAUDE_PLUGIN_ROOT}/core/references/guard-config.md`.

**Boundary.** Protected branches, force pushes, secrets, junk files and failing tests as a *team* policy, in the
terminal and in CI, belong to the agentic-teamwork plugin. This guard's own `default-branch-commit` and
`force-push` are questions put to the owner, an aid for one agent. The two plugins are meant to run together.

## Step 1 — Ask the guard

```
python -B "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py" --explain '<the command>'
python -B "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py" --explain --file <path>
```

It prints what would be decided (deny, ask, warn, allow), by which rule and with which message, and runs and logs
nothing. `--cwd <dir>` and `--json` are there too.

When the guard refused **you**: do what the message says. Do not rephrase the command to get past it, and do not
change the config to let your own command through. A rule that is wrong is the owner's to change.

*Done when: you know which rule answered and why.*

## Step 2 — Change the config

Edit `.agents/agent-works.json`. Each need has one key:

| The need | Key | Note |
|---|---|---|
| Files local to the owner's machine: never staged, edits asked | `guard.ownerFiles`, `guard.ownerFilesEdit` | literal paths; a trailing slash is a folder |
| Files a tool writes: never edited by hand | `guard.generated` | a regex on the path, and `how`: the command to run instead |
| Staging the whole tree; unreadable pathspecs | `guard.staging` | `deny` by default |
| Commits on the default branch, forced pushes | `guard.defaultBranch` | `ask` by default |
| One instance at a time of an application or device | `resources.<name>`, `lockOrder` | `match`: the commands that start it; `scope`: `project` or `machine` |
| A run whose cost grows with a count | `runs` | how many items are free, and the variable that carries the reason |
| A number several branches bump | `counters.<name>` | claimed with `aw claim` |
| The variable that carries an agent's name | `guard.agentVar` | default `AW_AGENT` |
| Anything else this project learned the hard way | `guard.rules` | data only: `id`, `decision`, `match`, `unless`, `message` |

A rule's `message` is what the agent reads at the moment of the mistake: say the rule, why, and what to do
instead. Start a new rule at `warn` or `ask`; make it `deny` once it has refused nothing it should not have.

Rules are patterns and a message. The plugin never runs code from a repository: a rule that needs code is a hook
in the project's own `.claude/settings.json`, and stays there.

*Done when: the config holds the change, and nothing in it restates a rule another key already covers.*

## Step 3 — Prove the rule both ways

Run `--explain` (Step 1) on one command the rule must stop and on two it must let through: a near miss, and a
command that only mentions the words (a commit message, an `echo`, a search). Then:

```
aw doctor
```

`CONFIG_INVALID` is critical: the file does not parse, a key has the wrong shape, or a pattern is not a regular
expression. A broken config never blocks work; the guard falls back to the defaults until it is fixed.

*Done when: the three explanations are as intended, and `aw doctor` prints no `CONFIG_INVALID`.*

## Step 4 — Write the rule down once

A guard rule is the enforcement of a project rule. The rule itself lives in the root `AGENTS.md` (five lines, with
a link to the memory or decision that holds the incident), marked as enforced by the guard. The guard's message
and any brief point at it and do not restate it. Tell the owner what changed: every deny, ask and warn is logged
for them in the machine's store, per project.

*Done when: the root `AGENTS.md` names the rule once, and `aw dup` finds no second copy.*
