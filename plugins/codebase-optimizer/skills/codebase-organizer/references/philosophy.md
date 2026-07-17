# Organization philosophy

This is the taste the organizer applies. It is opinionated on purpose — a repo
without a point of view drifts back into a junk drawer — but every rule is a
heuristic in service of one goal: **a newcomer should be able to read the root,
form a correct mental model in thirty seconds, and know where to look next
without opening files.** That is "progressive disclosure" applied to a file
tree. When a rule and that goal conflict, the goal wins.

The rules were distilled from comparing a messy repo against a tidy one. Useful
mental anchors:

- **Messy:** ~40 loose files at the root, a dozen-plus top-level source files
  (one 14k lines), single directories holding 80–340 sibling files, backup and
  migration files left in place, the same concept (e.g. Docker) split between a
  root file and a directory.
- **Tidy:** a handful of root files that are *all* intent (README, manifest,
  lockfile, CI config, installer, `.gitignore`), ~10 top-level directories each
  naming a clear concern, and real detail nested three to four levels down.

## The principles

### 1. The root holds intent, not implementation

The root is the most-read directory in any repo, so it should answer "what is
this and how do I engage with it?" — not "where is feature X implemented?" Only
these belong loose at the root:

- **Orientation:** `README`, `LICENSE`, `CHANGELOG`, `CONTRIBUTING`.
- **Contract / manifest:** `pyproject.toml`, `package.json`, `go.mod`,
  `Cargo.toml`, and their lockfiles.
- **Whole-repo config:** `.gitignore`, `.editorconfig`, CI config, formatter/
  linter dotfiles.
- **User-facing entry:** installers (`install.sh`), a top-level `Makefile`, a
  `Dockerfile` / `docker-compose.yml`.

Everything else loose at the root — application source, one-off scripts,
scattered docs, example configs, helper utilities — is a candidate to nest.
A loose top-level source file is the single strongest "this repo grew without a
plan" signal, so treat root `*.py` / `*.js` / `*.go` (other than a genuine
single entry point like `main.py`) as move candidates by default.

### 2. Group by concern first, then by lifecycle

Top-level directories should name coarse, stable concerns: the application
source, shared/common libraries, platform- or target-specific code, developer
tooling, documentation, and build outputs. Within that, let lifecycle show as a
gradient — source flows to artifacts flows to distributables (`src/` → `build/`
→ `dist/`), and that ordering should be legible from the directory names.

A good top level reads like a table of contents. If you cannot write a
one-sentence purpose for a proposed top-level directory, it is either too vague
("misc", "stuff", "common" used as a dumping ground) or it belongs nested under
something else.

### 3. No overstuffed directories — add a second organizing layer

A directory with dozens of sibling files forces the reader to scan filenames
linearly; the directory has stopped disclosing structure. When a directory
holds more source files than the flat-max threshold (the canonical default,
`FLAT_MAX_DEFAULT`, lives in `scripts/repo_scan.py`), give it a second layer.
Two ways to split,
and the existing names usually tell you which:

- **By feature/domain** when filenames cluster around nouns
  (`auth_*.py`, `billing_*.py` → `auth/`, `billing/`). Prefer this — it groups
  things that change together.
- **By type/layer** when the dir mixes kinds (`models.py`, `views.py`,
  `serializers.py`, handlers, utils) → `models/`, `views/`, etc.

`repo_scan.py` reports `common_prefixes` per overstuffed dir precisely to reveal
which split the names are begging for. Recurse: a freshly created subdir that is
*still* overstuffed gets split again. But don't invent structure that isn't
there — three files do not need three subdirectories.

### 4. Directories are nouns; files are verbs or states

Predictable, idiomatic names. Directories name *things* (`agents/`, `parsers/`,
`transports/`); files name *actions or states* (`build`, `verify`, `config`).
This mirrors how people describe code out loud and makes paths guessable. Avoid
redundant stutter (`parsers/parser_json.py` → `parsers/json.py`) and
abbreviations a newcomer wouldn't expand.

### 5. Isolate ephemera and quarantine cruft — never delete silently

Build caches, compiled output, and editor junk (`__pycache__/`, `dist/`,
`*.egg-info/`, duplicate cache dirs) should be `.gitignore`d, not organized.
Genuine cruft — `*_backup.py`, `*-old`, `*_migration.py` for a migration long
since done, `.orig` files — should be **moved to a quarantine directory**
(`archive/` or `legacy/`) and **flagged for the human to delete**, never removed
by the tool. You cannot always tell a dead file from a load-bearing one; the
human can, and git history is the safety net either way. Surfacing cruft is
valuable even when you don't act on it.

### 6. Co-locate docs with what they document; keep one home per concern

A doc that explains one subsystem lives with that subsystem; only cross-cutting
docs (architecture overview, contributor guide) belong in a top-level `docs/`.
Likewise, every concern gets exactly one canonical home: if Docker assets are
split between a root `Dockerfile` and a `docker/` directory, consolidate. Two
homes for one concept means the reader has to know both exist.

### 7. Honor the ecosystem's idioms over personal preference

A Python developer expects `src/<package>/` or a top-level package dir and
`tests/`; a Node developer expects `src/` and `packages/*` for a workspace; a Go
developer expects `cmd/` and `internal/`. Detect the ecosystem from the
manifests first, then choose the layout its community already knows. A "clean"
layout that fights the language's conventions is not clean — it's surprising.
See `language-layouts.md` for concrete target trees.

### 8. Preserve behavior and history; moves are mechanical, not creative

Reorganizing must not change what the code *does*. Every move is a `git mv` so
history follows the file, and every move that breaks an import, a config path, a
CI step, or a Docker `COPY` must be paired with the corresponding reference fix
(see `reference-rewriting.md`). A reorg that leaves the build red has failed,
no matter how pretty the tree. When a move's blast radius is large or ambiguous,
prefer the smaller, safer move — or leave it for the human and say why.

### 9. Orientation hubs make the tree self-describing

A well-shaped tree tells the reader where things live; it still can't say what
each subtree is *for* or which file to open first. An `AGENTS.md` orientation
hub in every non-leaf code directory closes that gap: one honest line per
direct child — what it holds, when to descend — so a reader (human or agent)
orients at the root, descends hub by hub, and opens only the files the hubs
point at. This is a maintained *mechanism*, not a shape heuristic: the rules
(hub isolation, direct-children scope, update-on-change), the content
derivation, and the verifier live in `agent-hubs.md` — the owning contract.
Note the synergy with principle 1: a hub may not sit beside loose source
files, so a hubbed root is *forced* to hold only intent, and every internal
hub level inherits the same property.

## How to apply this when planning

1. **Read the scan profile and the manifests before proposing anything.** The
   ecosystem dictates the idiomatic target (principle 7).
2. **Start at the root** (principle 1): sort every loose root entry into
   *intent — keep* vs *implementation — nest*, and decide where each nested
   thing goes.
3. **Then the top level** (principle 2): name the coarse concerns; make sure
   each top-level directory earns its one-sentence purpose.
4. **Then recurse into overstuffed directories** (principle 3), using the
   reported prefixes to pick feature- vs type-based splits.
5. **Sweep for cruft and ephemera** (principle 5) — quarantine vs `.gitignore`.
6. **For every move, record the reference impact** (principle 8) so the apply
   phase can keep the build green.
7. **Place and draft the AGENTS.md hubs from the target tree** (principle 9,
   rules in `agent-hubs.md`): the root always, every non-leaf code directory,
   honest one-liners per direct child — and where the current tree puts loose
   code beside code subdirectories, the nesting moves that fix it belong in
   the move list.

The output of planning is a concrete *target tree* plus an ordered *move list*,
where each move says where a file goes and what references it will break — not a
vague essay about how the repo could be nicer.
