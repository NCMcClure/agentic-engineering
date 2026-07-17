# {{PROJECT_NAME}} — agent orientation

{{ONE_LINE_DESCRIPTION}}

Planning lives under [`.plan/`](.plan/spec/index.md) — the spec site is the
source of truth for *what this system is*; the plan tree for *what work
remains*. Read the spec's `repository-layout.md` page before moving anything.

## Layout

<!-- One line per direct child directory: what it holds, when to descend.
     Builders fill and maintain this as the tree from the spec's
     repository-layout.md materializes. Direct children only — never reach
     two levels deep. -->

_No source directories yet._

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
5. **Docs follow verified work.** End-user docs are written per verified
   sprint by `build-user-docs` against the spec's `user-docs-plan.md` — don't
   hand-grow them ad hoc, and never document behaviour that hasn't verified.

Run `python .plan/plan/verify-agents-tree.py` to check the hub structure;
`<!-- verify-agents-tree: skip <dir>/ ... -->` here excludes generated trees.
