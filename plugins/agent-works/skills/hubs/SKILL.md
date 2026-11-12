---
name: hubs
description: Use when adding, moving, renaming or removing a directory, when aw hubs reports a finding, or when a tree needs a new AGENTS.md hub.
---

# hubs

A hub is a short `AGENTS.md` that lists a directory's direct children, one line each. The contract is five rules
in `${CLAUDE_PLUGIN_ROOT}/references/hubs.md`; read it before writing your first hub in a repository.

Moving source files to make a directory hub-ready is a reorganisation. That, and deepening architecture, is the
codebase-optimizer plugin's work; this skill verifies and writes the hubs.

## Step 1: Verify

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" hubs
```

`aw` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs"`: call it that way.

Exit 0 clean, 1 warnings, 2 critical. `--json` for scripts; `--exclude <prefix>` leaves a tree out for one run.

*Done when: you have the findings by code and path, or the line "clean".*

## Step 2: Repair by code

| Code | Repair |
|---|---|
| `HUB_ISOLATION` | Source files sit beside a hub. If the directory is a leaf, delete its hub (the parent's line covers it). Otherwise the files move into a sub-directory: a reorganisation, see above. |
| `HUB_MISSING` | Write the hub: Step 3. |
| `HUB_MIXED_DIR` | Report it. It takes a hub only after its loose files move down a level. A directory the owner decides stays mixed goes into `accept` of the config with its why (the `doctor` skill, Step 3). |
| `HUB_STALE_CHILD` | The line names a child that is gone: fix the name or delete the line. |
| `HUB_UNLISTED_CHILD` | Add the child's line: Step 3. In a git repository a child counts as named only by a bullet that opens with its path in a code span; prose, a table or a link does not name it. |
| `HUB_SIZE` | Back to one line per direct child. Rules, commands and reasons move to the root file or to memory. |
| `ROOT_SIZE` | The `doctor` skill slims the root. |
| `HUB_ROOT_MISSING` | Setting the repository up writes the root: ask the person to run `/agent-works:setup`. |
| `CLAUDE_CHAIN` | `aw twins`. A twin with content of its own: move the content into its `AGENTS.md` first. |

A generated or data tree that follows its own layout is left out with the marker line the contract shows, in the
root `AGENTS.md`. Ask before excluding a tree that holds hand-written code.

*Done when: every finding is repaired, or reported with the reason it needs a reorganisation or the owner.*

## Step 3: Write a hub or a line

Start a new hub from `${CLAUDE_PLUGIN_ROOT}/assets/templates/agents-hub.md`. For each direct child: open one to
three representative files, then write one line, a bullet that opens with the child's path in a code span
(`` - `parsers/` - one module per input format ``): what it holds, and when to open it. Describe the tree as it is. A child that does not fit one honest line is a finding to report, not a
line to fake.

*Done when: every direct child that holds code has one line, and no line reaches below a direct child.*

## Step 4: Twins, then verify again

```
aw twins
aw hubs
```

`aw twins` writes the `CLAUDE.md` beside each `AGENTS.md` in the form the project's `claude.twins` says: a tracked
symlink to its sibling unless the config names another (`generated`, `committed`, `off`).

*Done when: `aw hubs` exits 0, or every remaining finding is one you reported in Step 2.*

## Every later change

When your change adds, moves, renames or repurposes something in a directory, update the hub that lists it in the
same commit, then run `aw hubs`.
