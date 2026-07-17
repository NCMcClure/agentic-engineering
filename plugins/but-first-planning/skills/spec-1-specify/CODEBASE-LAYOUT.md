# Codebase layout for agents — the repository-layout page and AGENTS.md hubs

Progressive disclosure isn't just how the spec is organized
([PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md)) — it's how the
*built source tree* should read too. An agent dropped into the repo should
learn what to read before it reads: orient at the root, descend one hub at a
time, open only the files that matter. This contract has two halves: a
mandatory spec page that draws the tree before code exists, and the AGENTS.md
hub rules the built tree must satisfy. Everything else in the suite links
here; this file owns the format.

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

## AGENTS.md hubs — the rules

An `AGENTS.md` is to a source directory what a category `index.md` is to the
spec: a concise orientation hub — what this subtree is for, what each direct
child holds, where to go for a given kind of change. The spec's index rules
transplant directly:

1. **Hub isolation.** A directory containing an `AGENTS.md` holds no source
   files directly — code always lives in subdirectories. Non-code files are
   exempt: manifests and lockfiles (`package.json`, `Cargo.toml`,
   `CMakeLists.txt`, …), `README.md`, `LICENSE`, dotfiles, CI config. Break
   this and the hub stops being a cheap read: orientation and content collapse
   into one directory listing.
2. **Hub scope: direct children only.** One line per child directory (and per
   exempt root file worth naming), what it holds, when to descend. A hub
   never reaches two levels deep — files below its children are found by
   descending, not by reading a manifest at the root.
3. **Leaf code directories carry no hub.** A directory holding source files
   is a leaf; its parent's AGENTS.md describes it in one line. (Corollary of
   rule 1 — the two roles never mix.)
4. **Every non-leaf code directory has a hub.** The repo root always does;
   below that, any directory whose subdirectories contain code carries an
   AGENTS.md. No orphan levels an agent must guess through.
5. **Update on change.** Content in a subtree changes — files added, moved,
   renamed, a child's purpose shifts — its governing AGENTS.md is updated
   **in the same change**. A stale hub routes agents wrong silently, which is
   worse than no hub. This is a durable rule, stated in the root AGENTS.md
   itself so every agent session in the repo inherits it.

The **root AGENTS.md** is scaffolded by `spec-0-init` (stub:
`spec-0-init/assets/stubs/agents-root.md`) and is the one owning home of the
repo's agentic-development rules: the hub rules above, the update-on-change
rule, and docs currency (end-user docs follow each verified sprint via
`build-user-docs`). Its Layout section starts empty and is filled by builders
as the tree from `repository-layout.md` materializes.

## CLAUDE.md siblings (opt-in)

AGENTS.md is unconditional. Whether the repo also carries `CLAUDE.md` files
is the **agent-context posture** (`reference/adr/0004-agent-context-files.md`,
asked exactly once by `spec-0-init`). When opted in:

- Every AGENTS.md has a sibling `CLAUDE.md` whose entire content is
  `@AGENTS.md` — the Claude Code import. One source of truth, zero
  duplication.
- No orphan CLAUDE.md: a CLAUDE.md without a sibling AGENTS.md is a
  violation.
- The machine signal for the opt-in is the root `CLAUDE.md` containing
  `@AGENTS.md` — the verifier keys off that, not off the ADR.

## The verifier: `verify-agents-tree.py`

Shipped by `spec-0-init` into `.plan/plan/`, read-only, stdlib-only, run from
anywhere inside the repo. Exit 0 clean, 1 warnings, 2 critical — same ladder
as its siblings. What it checks:

| Check | Level |
|-------|-------|
| Root AGENTS.md exists (repo has code) | WARN — legacy repos ramp in |
| Hub isolation (rule 1) | CRITICAL once a root AGENTS.md exists; WARN before |
| Every non-leaf code directory has a hub (rule 4) | WARN |
| CLAUDE.md chain complete, no orphans (when opted in) | WARN |

Hub *scope* (rule 2) and staleness (rule 5) stay prose-enforced — mechanical
checks for "describes only direct children" and "still accurate" would be
noise. Default exclusions: dot-directories, `.plan/`, `node_modules/`,
`build/`, `dist/`, `target/`, vendored trees (`third_party/`, `vendor/`),
virtualenvs. To exclude something else (a generated tree, a data directory),
add a marker line to the root AGENTS.md:

```markdown
<!-- verify-agents-tree: skip generated/ data/fixtures/ -->
```

Where it runs: the sprint/epic checkpoint tables carry a row for it (so
`build-sprint` integrators, sprint exit, and `build-next-issue`'s reconcile
re-run it for free), `build-tdd`'s done-when includes no new violations, and
`spec-4-edit` re-runs it when a change touches `repository-layout.md` or
moves module boundaries.
