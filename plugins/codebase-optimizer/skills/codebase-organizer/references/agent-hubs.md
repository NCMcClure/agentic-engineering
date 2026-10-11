# AGENTS.md orientation hubs

A tidy tree says *where* things live; a hub says *what each subtree is for*.
An `AGENTS.md` in the root and in every non-leaf code directory lets an agent
orient at the root, descend hub by hub, and open only the files the hubs point
at. This is philosophy principle 9's mechanism.

**The hub contract, its templates and its verifier are agent-works' job
(`agent-works:hubs` / `aw hubs`). Without it: the organizer still drafts and
writes hubs from the five rules and the notes below, and the run's report says
"hub structure not verified: agent-works not installed".**

## The five rules

1. **Hub isolation.** A directory with an `AGENTS.md` holds no source files of its own; manifests, README, LICENSE, dotfiles, CI config and package markers (`__init__.py`) are exempt.
2. **Direct children only.** One line per child: what it holds, when to descend. Never two levels deep.
3. **Leaf code directories carry no hub.** The parent's line covers them.
4. **Every non-leaf code directory has a hub.** The root always does.
5. **Update on change.** A change to a subtree updates its governing hub in the same commit; a stale hub misleads silently.

Rule 1 shapes the plan: a directory that will carry a hub and holds loose
source files needs the nesting moves that fix it in the move list.

## Deriving hub content for an existing repo

A hub describes the tree as it will exist right after the planned moves land,
never a roadmap. Per direct child: start from the scan's facts, open 1–3
representative files, write one honest line (`- `src/parsers/` — one module
per input format; start here for a new file type`). A child that cannot be
described in one honest line is a finding to report (it probably needs
splitting), not a line to fake.

## Brownfield merge rules (never clobber)

- **Existing `AGENTS.md`:** refresh or add the Layout lines of changed children; add the rules section (root only) if absent; never rewrite or delete the owner's prose.
- **Existing `CLAUDE.md`:** prepend the `@AGENTS.md` import if it is missing; never delete its other content.

## CLAUDE.md siblings

A sibling `CLAUDE.md` whose whole content is `@AGENTS.md` makes Claude Code
load a hub natively. In a repo set up with agent-works
(`.agents/agent-works.json` exists) its `claude.twins` setting decides: nothing
is asked and the organizer writes no sibling itself. Otherwise the question is
asked once per repo, and the answer is read back from the repo afterwards: a
root `CLAUDE.md` containing `@AGENTS.md` means yes, a root `AGENTS.md` without
it means no.
