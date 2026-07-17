# AGENTS.md orientation hubs — the contract

A well-organized tree tells you *where* things live; it still can't tell an
agent *what* each subtree is for or which file to open. AGENTS.md hubs add
that layer: a concise orientation file in every non-leaf code directory, so
an agent (or a newcomer) orients at the root, descends hub by hub, and opens
only the files the hubs point at. This is philosophy principle 9's mechanism,
and this file owns its rules.

> Provenance: this contract is kept in intentional sync with the
> but-first-planning plugin's CODEBASE-LAYOUT.md (which applies the same
> rules to greenfield projects). Divergence between the two is a bug in
> whichever file drifted.

## The five rules

1. **Hub isolation.** A directory carrying an `AGENTS.md` holds no source
   files directly — code always lives in subdirectories. Exempt: non-code
   files (manifests and lockfiles — `package.json`, `pyproject.toml`,
   `Cargo.toml`, `CMakeLists.txt`, … — plus `README.md`, `LICENSE`, dotfiles,
   CI config) and **package markers** (`__init__.py` / `__init__.pyi` — a
   Python package directory cannot exist without one; keep it a thin marker,
   not a module). Break this and the hub stops being a cheap read:
   orientation and content collapse into one directory listing.
2. **Hub scope: direct children only.** One line per child directory (and
   per exempt root file worth naming): what it holds, when to descend. A hub
   never reaches two levels deep — files below its children are found by
   descending, not by reading a manifest at the root.
3. **Leaf code directories carry no hub.** A directory holding source files
   is a leaf; its parent's AGENTS.md describes it in one line.
4. **Every non-leaf code directory has a hub.** The repo root always does;
   below that, any directory whose subdirectories contain code carries an
   AGENTS.md. No orphan levels an agent must guess through.
5. **Update on change.** Content in a subtree changes — files added, moved,
   renamed, a child's purpose shifts — its governing AGENTS.md is updated
   **in the same change/commit**. A stale hub routes agents wrong silently,
   which is worse than no hub. This durable rule is stated in the root
   AGENTS.md itself, so every future session in the repo inherits it.

Rule 1 is philosophy principle 1 generalized: a hubbed root is *forced* to
hold only intent, and every internal hub level gets the same property. When
planning a reorg, the target tree must satisfy isolation — a directory that
will be a non-leaf code directory and currently holds loose source files
needs the nesting moves that fix it in the plan.

## Deriving hub content for an existing repo

Hubs describe **what IS** — the tree as it will exist immediately after the
planned moves land — never aspiration or a roadmap. To draft a hub:

- Start from the repo scan's facts for each direct child (file counts,
  common prefixes, ecosystem).
- Open 1–3 representative files per child to confirm what it actually holds.
- Write one honest line per child: *what it holds, when to descend*
  (`- `src/parsers/` — one module per input format; start here for a new
  file type`).
- A child whose purpose can't be stated in one honest line is a design smell
  — report it as a finding (the directory probably needs splitting), don't
  fake a line.

## CLAUDE.md siblings (opt-in)

AGENTS.md is unconditional. Whether the repo also carries `CLAUDE.md` files
is asked **once per repo**:

- When opted in, every AGENTS.md has a sibling `CLAUDE.md` whose entire
  content is `@AGENTS.md` — the Claude Code import. One source of truth,
  zero duplication. No orphan CLAUDE.md (one without a sibling AGENTS.md).
- The machine signal for the opt-in is the **root `CLAUDE.md` containing
  `@AGENTS.md`** — detection and the verifier key off that, never off memory.
  A root AGENTS.md *without* that signal means the question was answered
  "no"; don't re-ask.
- Brownfield root CLAUDE.md files may carry other user content around the
  import line — that's fine; only non-root siblings must be exactly the
  import.

## Brownfield merge rules (never clobber)

- **Existing `AGENTS.md`**: refresh or append its Layout lines for changed
  children, and add the "Rules for working in this repo" section (root only)
  if absent. Never rewrite or delete the owner's prose.
- **Existing `CLAUDE.md`**: prepend the `@AGENTS.md` import if it's missing.
  Never delete its other content.

## The verifier: `verify_agents_hubs.py`

`scripts/verify_agents_hubs.py` (sibling of `repo_scan.py`) checks the rules
mechanically: `python3 verify_agents_hubs.py <repo> [--json]`. Whole-repo by
design (no `--subtree`), stdlib-only, read-only. Exit 0 clean, 1 warnings,
2 critical.

| Check | Level |
|-------|-------|
| `HUB_ROOT_MISSING` — code exists, no root AGENTS.md | WARNING (legacy repos ramp in) |
| `HUB_ISOLATION` — source files beside an AGENTS.md | CRITICAL once a root AGENTS.md exists; WARNING before |
| `HUB_MISSING` — non-leaf code dir without a hub | WARNING |
| `HUB_MIXED_DIR` — loose files + code subdirs in one dir | WARNING |
| `CLAUDE_CHAIN` — missing/orphan/wrong-content sibling (opted-in repos) | WARNING |

Hub scope (rule 2) and staleness (rule 5) stay prose-enforced — mechanical
checks for them would be noise. Default exclusions: dot-directories,
`node_modules/`, `build/`/`dist/`/`target/`, vendored trees, virtualenvs,
and **`archive/`** (the organizer's quarantine is deliberately
non-navigable). Extra exclusions via `--exclude` or a marker line in the
root AGENTS.md — the marker name is shared with but-first-planning on
purpose, so a repo that graduates from one tool to the other keeps one
marker:

```markdown
<!-- verify-agents-tree: skip generated/ data/fixtures/ -->
```

## Enforcement ladder

Warn-ramp before a root AGENTS.md exists (nothing about hubs can red a
legacy repo's gates); strict after — hub isolation becomes CRITICAL, and the
organize apply's Verify treats a critical hub finding as its own failure
(it just wrote the hubs; inconsistency there is its bug, not the repo's).
