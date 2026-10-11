<!-- Root hub stub. The full template is agent-works' (`agent-works:hubs`); this is the fallback the organizer fills in. -->
# {{PROJECT_NAME}} — agent orientation

{{ONE_LINE_DESCRIPTION}}

## Layout

<!-- One line per direct child: what it holds, when to descend. Direct children only. -->

{{LAYOUT_LINES}}

## Rules for working in this repo

1. **Hubs stay isolated.** A directory with an `AGENTS.md` holds no source files of its own; code lives in subdirectories. Manifests, README, LICENSE, dotfiles and CI config are exempt.
2. **Every non-leaf code directory has an `AGENTS.md`** listing its direct children, one line each. Leaf code directories carry none; the parent's line covers them.
3. **Update hubs in the same change.** Add, move, rename or repurpose something, and its governing `AGENTS.md` changes with it.
4. **Navigate cheap to expensive.** Orient here, descend hub by hub, open only the files the hubs point at.
