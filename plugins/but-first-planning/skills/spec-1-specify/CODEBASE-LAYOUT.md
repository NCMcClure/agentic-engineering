# Codebase layout for agents — the repository-layout page and AGENTS.md hubs

Progressive disclosure isn't just how the spec is organized
([PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md)) — it's how the
*built source tree* should read too. An agent dropped into the repo should
learn what to read before it reads: orient at the root, descend one hub at a
time, open only the files that matter. Two things make that true: a mandatory
spec page that draws the tree before code exists, which this file owns, and
the AGENTS.md hub rules the built tree must satisfy, which belong to the
`agent-works` plugin and are summarised here.

## The mandatory page: `repository-layout.md`

A content file named exactly `repository-layout.md` (the exact filename is
the machine contract — `verify-spec-tree.py` warns when it's missing), in
whichever category fits (a platform/engineering category is the usual home).
Nothing on it is a new decision: the layout is *derived* from decisions the
spec already made, which is exactly why it belongs in the spec — two
implementers starting from these pages should produce the same tree. It
carries:

- **Organizing rules** — a handful, stated as rules with consequences. The
  first is always some form of *the source tree mirrors the spec*: one module
  directory per spec category (or an explicit, justified mapping), so a
  reader goes from any spec page to the directory that implements it without
  a mapping document.
- **The top-level tree** — a fenced tree of the repo root with a one-line
  comment per entry, including where AGENTS.md hubs sit (see the rules
  below).
- **The module map** — a table: directory → spec category → what lives
  inside. This is the 1:1 map the mirror rule promises.
- **Thin entrypoints** — where the `main`s live and the rule that they carry
  wiring only; logic in an entrypoint is a layout bug.

`spec-3-architect` pressure-tests this page like any interface: does each
module have locality (one place per concern), do the hub rules below hold on
the drawn tree, would a change ripple across module boundaries?

## AGENTS.md hubs — five rules, owned by agent-works

An `AGENTS.md` is to a source directory what a category `index.md` is to the
spec: a short orientation hub. The contract, its exemptions and its checker
belong to the `agent-works` plugin: read `agent-works:hubs` when it is
installed. The five rules, for drawing the tree on `repository-layout.md` and
for working without agent-works:

1. **Hub isolation.** A directory with an `AGENTS.md` holds no source files of its own; code lives in subdirectories (manifests, README, LICENSE, dotfiles, CI config and package markers such as `__init__.py` are exempt).
2. **Direct children only.** One line per child: what it holds, when to descend; never two levels deep.
3. **Leaf code directories carry no hub.** The parent's line covers them.
4. **Every non-leaf code directory has a hub**, the repo root included.
5. **Update on change.** A hub is updated in the same change that adds, moves, renames or repurposes something below it.

The **root AGENTS.md** is scaffolded by `spec-0-init` (stub:
`spec-0-init/assets/stubs/agents-root.md`) and states these rules and docs
currency (end-user docs follow each verified sprint via `build-user-docs`) for
every agent session. Its Layout section starts empty and is filled by builders
as the tree from `repository-layout.md` materializes.

## CLAUDE.md siblings (opt-in)

AGENTS.md is unconditional. Whether the repo also carries `CLAUDE.md` files
is the **agent-context posture** (`reference/adr/0004-agent-context-files.md`,
asked exactly once by `spec-0-init`). When opted in, every AGENTS.md has a
sibling `CLAUDE.md` whose entire content is `@AGENTS.md`, and no CLAUDE.md
stands without its AGENTS.md. With agent-works installed the siblings are its
generated twins (`aw twins`): not written by hand, not committed.

## Checking the hubs

`aw hubs` (agent-works) is the check: exit 0 clean, 1 warnings, 2 critical.
This plugin ships no verifier of its own. When agent-works is available,
`spec-0-init` writes a stub at `.agents/plan/plan/verify-agents-tree.py` that
calls `aw hubs` and passes its exit code through. The "Codebase hubs current"
row of the sprint/epic checkpoint tables, `build-sprint`'s exit,
`build-next-issue`'s reconcile, `build-tdd`'s done-when and `spec-4-edit`'s
re-verify all run that path **when the file exists** and skip the check when
it does not. Without agent-works the five rules are kept by hand: hub
structure is not verified.
