# {{PROJECT_NAME}} — agent orientation

{{ONE_LINE_DESCRIPTION}}

## Layout

<!-- One line per direct child directory: what it holds, when to descend.
     Direct children only — never reach two levels deep. Update these lines
     in the same change whenever a child's contents or purpose shifts. -->

{{LAYOUT_LINES}}

## Rules for working in this repo

These are durable rules for every agent session, not suggestions:

1. **Hubs stay isolated.** A directory carrying an `AGENTS.md` holds no
   source files directly — code lives in subdirectories. Manifests, README,
   LICENSE, dotfiles, and CI config are exempt.
2. **Every non-leaf code directory has an `AGENTS.md`** describing its direct
   children, one line each — what it holds, when to descend. Leaf code
   directories carry no hub; their parent's line covers them.
3. **Update hubs in the same change.** When you add, move, rename, or
   repurpose anything in a directory, update its governing `AGENTS.md` before
   you finish — a stale hub routes the next agent wrong silently.
4. **Navigate cheap-to-expensive.** Orient here, descend hub by hub, and open
   only the files the hubs point you at. Don't read the tree; read the map,
   then the one file.

The codebase-optimizer plugin's `verify_agents_hubs.py` checks this structure
mechanically; to exclude a generated or data tree from its checks, add a
marker line to this file:
`<!-- verify-agents-tree: skip <dir>/ ... -->`
