# AGENTS.md orientation hubs: the contract

A well-organized tree tells you where things live; it still cannot tell an agent
what each subtree is for or which file to open. AGENTS.md hubs add that layer: a
concise orientation file in every non-leaf code directory, so an agent or a
newcomer orients at the root, descends hub by hub, and opens only the files the
hubs point at. This is philosophy principle 9's mechanism, and this file is how
the organizer applies it when it writes hubs onto a repo that never had them.

## The four rules

1. **Hubs stay isolated.** A directory carrying an `AGENTS.md` holds no source
   files directly; code lives in subdirectories. Exempt: non-code files
   (manifests and lockfiles such as `package.json`, `pyproject.toml`,
   `Cargo.toml`, plus `README.md`, `LICENSE`, dotfiles, CI config), tool config
   files matching `*.config.{js,ts,mjs,cjs}` whose tools pin that location, and
   package markers (`__init__.py`, `__init__.pyi`), because a Python package
   directory cannot exist without one; keep it a thin marker, not a module.
   Break this rule and the hub stops being a cheap read: orientation and content
   collapse into one directory listing.
2. **Every non-leaf code directory has a hub**, describing its direct children,
   one line each: what it holds, when to descend. A hub never reaches two levels
   deep. The repo root always carries one.
3. **Leaf code directories carry no hub.** A directory holding source files is a
   leaf; its parent's line covers it.
4. **Update hubs in the same change.** Files added, moved, renamed, or a child's
   purpose shifted means its governing `AGENTS.md` is updated in the same commit.
   A stale hub routes agents wrong silently, which is worse than no hub. The root
   hub states this rule itself, so every later session in the repo inherits it.

Rule 1 is philosophy principle 1 generalized: a hubbed root is forced to hold
only intent, and every internal hub level gets the same property. When planning a
reorg, the target tree must satisfy isolation, so a directory that will be a
non-leaf code directory and currently holds loose source files needs the nesting
moves that fix it, in the plan.

A Layout line is a bullet that opens with a backticked path, because that is the
shape the verifier reads:

```
- `src/parsers/` - one module per input format; start here for a new file type.
```

## The CLAUDE.md twin

Claude Code reads `CLAUDE.md`, most other agents read `AGENTS.md`, and the repo
keeps one file: beside a hub, `CLAUDE.md` is its twin, a **symlink** to the
sibling `AGENTS.md`. In a checkout that cannot hold a symlink (Windows without
`core.symlinks`), the twin is a file whose whole content is the one line
`@AGENTS.md`. Either way it has no content of its own, so it cannot drift from
the hub it stands beside.

The apply phase writes a twin beside every hub it writes and stages it with the
hub, so a clone has both. Whether it writes them is read from the repo, not
asked:

- a root `AGENTS.md` with no root `CLAUDE.md` is a repo that chose to go without
  twins, and none are written;
- any other repo gets them;
- `claudeMd: true` or `claudeMd: false` on the planning workflow overrides the
  reading.

Where a `CLAUDE.md` with content of its own already exists, leave it alone and
report it. Moving that content into `AGENTS.md` is the owner's call, and the
verifier's `claude-md-not-twin` finding is how they hear about it.

## Deriving hub content for an existing repo

Hubs describe what IS: the tree as it will exist immediately after the planned
moves land, never aspiration and never a roadmap. To draft one:

- Start from the repo scan's facts for each direct child (file counts, common
  prefixes, ecosystem).
- Open one to three representative files per child to confirm what it actually
  holds.
- Write one honest line per child: what it holds, when to descend.
- A child whose purpose cannot be stated in one honest line is a design smell.
  Report it as a finding, because the directory probably needs splitting. Do not
  fake a line.

## Brownfield merge rules (never clobber)

- **Existing `AGENTS.md`:** refresh or append its Layout lines for changed
  children, and add the rules section (root only) if absent. Never rewrite or
  delete the owner's prose.
- **Existing `CLAUDE.md`:** if it is already a twin (a symlink to `AGENTS.md`, or
  the one line `@AGENTS.md`), leave it. If it has content of its own, leave it
  and report it; see above.

## The verifier: `verify-hubs.mjs`

`scripts/verify-hubs.mjs` (sibling of `repo-scan.mjs`) checks the rules
mechanically.

```bash
node verify-hubs.mjs [dir]                  # one line per finding, exit 1 on any
node verify-hubs.mjs [dir] --json           # {ok, root, hubs, findings:[{finding, hub, detail}]}
node verify-hubs.mjs [dir] --require-hubs   # also report non-leaf code directories with no hub
```

Whole repo by design and read-only. It judges the tree a commit of the work tree
would hold: tracked files plus new ones git does not ignore, so build output
never counts and a hub written a moment ago does. Exit 2 means `dir` is not
inside a git work tree.

| Finding | What to do |
| --- | --- |
| `missing-line` | Add a Layout line for that child directory to the named hub. |
| `stale-line` | The path is gone: delete the line, or fix it if the directory moved. |
| `loose-code` | Move the file into a subdirectory, or exempt it when a tool pins its location. |
| `claude-md-not-twin` | Move its content into the sibling `AGENTS.md`, then replace it with the symlink or the one line `@AGENTS.md`. |
| `missing-hub` | Only with `--require-hubs`: write the hub (rule 2), or `skip` the tree if it is not this repo's own structure. |

Hub scope (a line per direct child, never two levels deep) and staleness of the
prose itself stay human-enforced: mechanical checks for them would be noise.

## Exceptions

Exceptions live in the root hub, not in the verifier. One marker line, anywhere
in the root `AGENTS.md`:

```markdown
<!-- verify-hubs: exempt entrypoint.sh main.go; skip generated/ archive/ -->
```

`exempt` lists basenames allowed to sit loose beside a hub: the right home for
an entry file whose location the toolchain pins (`main.go`, `lib.rs`, `mod.rs`,
`setup.py`, `manage.py`). `skip` lists path prefixes dropped from the check
entirely, for a tree that is generated output or a template rather than this
repo's own structure, and for the organizer's `archive/` quarantine when a run
produces one. Directives are separated by `;`.

Keep the exempt list short. Every entry is a rule that no longer holds somewhere,
and the reason belongs in the hub's prose next to the marker.

## The gate: which findings fail a stage

A stage's verdict does not come from `verify-hubs.mjs` raw. It comes from
`scripts/verify-structure.mjs`, which grades the hub findings together with the
scan's and exits on the worst one: 0 clean, 1 warnings only, 2 a critical
finding.

| Check | Severity | From |
| --- | --- | --- |
| `MISSING_INIT` | CRITICAL | scan: a directory under `--subtree` with `.py` modules and no `__init__.py` (Python repos) |
| `HUB_LOOSE_CODE` | CRITICAL, WARNING while the repo has no root hub | `loose-code` |
| `HUB_MISSING_LINE` | WARNING | `missing-line` |
| `HUB_STALE_LINE` | WARNING | `stale-line` |
| `HUB_MISSING` | WARNING | `missing-hub` |
| `CLAUDE_MD_NOT_TWIN` | WARNING | `claude-md-not-twin` |
| `FLAT_DIR_BLOAT` | WARNING | scan: a directory at or over the flat-max |
| `CRUFT_PRESENT` | WARNING | scan: a backup, old, copy or `.orig` file |
| `OVERSIZED_MODULE` | INFO | scan: a source file at or over `--module-max` lines |
| `EPHEMERA_UNIGNORED` | INFO | scan: a build artifact or a stray cache directory |

A critical finding fails the stage that ran the gate; a warning is reported and
never fails one. A legacy repo with no root hub is warned and not failed: the
first run's job is to write the hubs, not to fail on their absence.

`--strict` is what the organize apply's Verify runs. It has just written the
hubs, so `HUB_MISSING_LINE`, `HUB_STALE_LINE` and `HUB_LOOSE_CODE` are critical
there whatever the root holds: an inconsistency in hubs written a moment ago is
the apply's own mistake. `CLAUDE_MD_NOT_TWIN` (the owner's file) and
`HUB_MISSING` (a directory the plan chose not to hub) stay warnings.

```bash
node verify-structure.mjs [repo] [--subtree src] [--flat-max N] [--module-max 1500] \
     [--exclude PATH]... [--strict] [--json]
```

The scan's findings are kept to `--subtree` (default `src`; `--subtree ""` for
the whole repo); hub findings are always whole-repo. `--json` prints
`{root, subtree, strict, hubs, notes, summary: {critical, warning, info},
findings: [{severity, check, path, message}]}`.
