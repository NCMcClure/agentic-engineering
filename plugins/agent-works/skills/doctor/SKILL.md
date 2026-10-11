---
name: doctor
description: Use when AGENTS.md, memory or status bloats, rules repeat, or ./docs holds agent files.
---

# doctor

`aw doctor` finds what has grown, repeated, gone stale or landed in the wrong place. Repairs come in two kinds:
those a command does, and those that need a reader. Do the first kind first; it clears noise from the second.

## Step 1 — Audit

```
aw doctor
```

`--all` lists every finding (the default shows eight per code), `--json` is for scripts, `--html <file>` writes a
page for the owner (outside the repository: a report is not a repo file). If the last lines show no "since the
baseline", record one first with `aw doctor --baseline`.

*Done when: you have the finding counts by code, and a baseline exists from before your first repair.*

## Step 2 — Mechanical repairs

| Finding | Command |
|---|---|
| `MEM_INDEX_STALE` | `aw memory index`. On indexes written by hand, read the diff first: it replaces every list line with the memory's `description`, so what a line said beyond that moves into the description (160 characters) or the memory before you run it. |
| `DEC_INDEX_STALE` | `aw decisions index` |
| `GEN_TWIN_MISSING`, `CLAUDE_CHAIN` (a missing twin) | `aw twins` |
| `CONTRACT_MISSING`, `CONTRACT_STALE` (another version) | `aw setup --apply` |
| `MEM_FRONTMATTER` (the file's date and `updated` differ) | `aw memory touch <slug>` |

*Done when: `aw doctor` no longer prints any of these codes.*

## Step 3 — Repairs that need a reader

Work by code, largest files first, critical findings before all (`HUB_ISOLATION`, `CONFIG_INVALID`, a status
memory over three times its budget). **Never delete the owner's prose without showing it:** move text with its
wording intact, and quote in your report every passage you removed rather than moved.

| Finding | Repair |
|---|---|
| `ROOT_SIZE`, `ROOT_STATUS_PROSE` | Slim the root `AGENTS.md`: keep what the project is, the repo map, the commands, and each rule in five lines. Move a rule's why to a decision or a memory and link it; status to the status memory and cards; a folder's detail to that folder's hub; generic contract text out (it is in `.agents/README.md`). |
| `HUB_*` | The `hubs` skill. |
| `STATUS_*`, `MEM_FILE_SIZE`, `MEM_FOLDER_OVER`, `MEM_HOOK_LONG` | Consolidation, in `${CLAUDE_PLUGIN_ROOT}/core/references/memory.md`: split by topic, split the folder, rewrite the description, compact status to Goal, Current focus and Known issues. |
| `MEM_SLUG_DUP`, `MEM_NAME_MISMATCH`, `MEM_ROOT_LOOSE`, `MEM_LINK_DANGLING` | Rename to `<date>-<slug>.md` with `git mv`, move into a category folder, fix or drop the link. |
| `MEM_SHARED_CANDIDATE` | If it holds on any project: `aw learn add`, then delete the memory or leave one line pointing at the learning. |
| `DUP_RULE` | Choose the single home with `${CLAUDE_PLUGIN_ROOT}/core/references/homes.md` (a rule: the root `AGENTS.md`). Keep that copy; replace the other with a link. If the copies disagree, ask the owner which is right. |
| `DOCS_AGENT_FILE` | `git mv` the file or folder to the home the finding names, then `aw decisions index` and `aw links`, and fix every link and path the move broke (code comments too: search for the old path). |
| `GLOSSARY_*`, `DEC_*` | The `decisions` skill. |
| `LINK_BROKEN`, `PATH_MISSING` | Fix the link or the path. A path named before it exists goes into `links.planned` of the config; build output into `links.notChecked`. |
| `KANBAN_OLD_FOLDER` | `git mv .agents/board .agents/kanban` (untracked: `aw setup --apply --move-board`). |
| `KANBAN_UNTRACKED` | Ask the owner: commit the folder (a shared board) or git-ignore it (a local or synced one). |
| `TASKS_TWO_HOMES`, other `KANBAN_*`, `GATE_OWED_OLD` | The `kanban` skill. |
| `BRIEF_UNTRACKED`, `BRIEF_SIZE` | Track the brief; move rules that bind beyond a round into the root `AGENTS.md` and link them. |
| `CONFIG_INVALID` | The `guard` skill. |

*Done when: each remaining finding is either repaired, or listed in your report with the reason it stays.*

## Step 4 — Compare with the baseline

```
aw doctor
```

Its last lines print what moved since the baseline: sizes and counts per code. Report those lines, the passages
removed, and the questions that wait for the owner. Record a new baseline only when the owner accepts the state.

*Done when: no critical finding is left, and your report holds the before → after lines from `aw doctor` itself.*
