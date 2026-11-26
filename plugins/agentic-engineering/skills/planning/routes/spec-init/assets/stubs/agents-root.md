# {{PROJECT_NAME}}: agent orientation

{{ONE_LINE_DESCRIPTION}}

Planning lives under [`.agents/plan/`](.agents/plan/spec/index.md): the spec
site is the source of truth for *what this system is*, the plan tree for *what
work remains*. Read the spec's `repository-layout.md` page before moving
anything.

## Layout

<!-- One line per direct child directory: what it holds, when to descend.
     Builders fill and maintain this as the tree from the spec's
     repository-layout.md materializes. Direct children only: never reach
     two levels deep. -->

- `.agents/plan/` - the planning workspace: the spec site (`spec/`), the epic to issue backlog (`plan/`), and the progress ledgers. Owned by the but-first-planning skills; descend to read the spec or the plan, never to hand-edit a status.

## Rules for working in this repo

These are durable rules for every agent session, not suggestions:

1. **Hubs stay isolated.** A directory carrying an `AGENTS.md` holds no
   source files directly: code lives in subdirectories. Manifests, README,
   LICENSE, dotfiles, and CI config are exempt.
2. **Every non-leaf code directory has an `AGENTS.md`** describing its direct
   children, one line each: what it holds, when to descend. Leaf code
   directories carry no hub; their parent's line covers them.
3. **Update hubs in the same change.** When you add, move, rename, or
   repurpose anything in a directory, update its governing `AGENTS.md` before
   you finish. A stale hub routes the next agent wrong, silently.
4. **Navigate cheap to expensive.** Orient here, descend hub by hub, and open
   only the files the hubs point you at. Do not read the tree; read the map,
   then the one file.
5. **Docs move with the code.** A change to user-visible behaviour updates
   its end-user pages in the same change, against the spec's
   `user-docs-plan.md`. Never document behaviour that has not been verified.
