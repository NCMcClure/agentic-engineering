# AGENTS.md orientation hubs: the contract

A tidy tree says where things are. It does not say what each folder is for or which file to open. Hubs add that: a
short `AGENTS.md` in the root and in every non-leaf code directory, so an agent orients at the root, descends hub by
hub, and opens only the files the hubs point at. Read the map, then the one file.

## The five rules

1. **A hub directory holds no source files.** Where an `AGENTS.md` sits, code lives in sub-directories. Allowed
   beside a hub: manifests and lockfiles (`package.json`, `pyproject.toml`, `Cargo.toml`, `CMakeLists.txt`),
   `README.md`, `LICENSE`, dotfiles, CI config, data files, and Python package markers (`__init__.py`,
   `__init__.pyi`, kept thin). Break this and orientation and content collapse into one listing.
2. **A hub lists its direct children only, one line each:** what the child holds and when to open it. It never
   reaches two levels down; what lies below a child is found by descending.
3. **A leaf code directory carries no hub.** A directory that holds source files is a leaf; its parent's line
   covers it.
4. **Every non-leaf code directory has a hub.** The root always; below it, every directory whose sub-directories
   hold code. No level an agent has to guess through.
5. **A hub is updated in the same change** that adds, moves, renames or repurposes something in its directory. A
   stale hub misleads silently, which is worse than none.

The root `AGENTS.md` is the first hub and more: what the project is, the repo map, how to build and test, and the
project's rules (`homes.md` says what else it must not hold). Sub-directory hubs are only the list.

## Drafting a hub line

A hub describes the tree **as it is**, never a plan.

- Open one to three representative files of the child before writing its line.
- One honest line: `` - `parsers/`: one module per input format; start here to add a file type ``.
- Open each line with the child's path in a code span: `` - `parsers/` - … ``. That is the shape `aw hubs` reads; a
  child described in prose, in a table or behind a link counts as unnamed in a git repository.
- A child whose purpose does not fit one honest line is a finding, not a writing problem: the directory probably
  wants splitting. Report it instead of faking the line.
- Rules, commands and reasons stay out of a sub-directory hub: they live in the root file and in memory.

Start a new hub from `assets/templates/agents-hub.md`. A directory that mixes loose source files with code
sub-directories cannot take a hub until the files move down a level; moving code is a reorganisation, with imports
and build files to fix, and belongs to a tool made for it (in this marketplace: codebase-optimizer).

## CLAUDE.md twins

The guidance is tool-neutral (`AGENTS.md`); Claude Code reads `CLAUDE.md`. A twin makes the two one file: a
`CLAUDE.md` beside each `AGENTS.md` that is a symlink to it, or a one-line file whose whole content is
`@AGENTS.md`. One source, no copy. Either form that is already there counts, whatever the mode. `claude.twins` in
the config chooses what `aw twins` writes:

| Mode | Twins are | Written by |
|---|---|---|
| `link` (when the config does not say) | tracked symlinks to `AGENTS.md`; the one-line file on Windows, or where a symlink is refused | `aw twins` |
| `generated` | one-line files, git-ignored | the session-start hook and `aw twins`, so a fresh clone or worktree heals itself |
| `committed` | one-line files, tracked | `aw twins` |
| `off` | absent | nobody |

A `CLAUDE.md` with content of its own is never overwritten: move its content into `AGENTS.md`, delete it (or leave
the one line), run `aw twins`. A twin whose `AGENTS.md` is gone is an orphan: removed where twins are generated,
reported elsewhere.

## Leaving a tree out

Never walked: dot-directories (so `.agents/` and `.git/`), dependency and build folders (`node_modules/`,
`build/`, `dist/`, `target/`, `out/`, `vendor/`, virtual environments), and an `archive/`. For a generated or data
tree that follows its own layout, put one marker line in the root `AGENTS.md`:

```markdown
<!-- verify-agents-tree: skip generated/ data/fixtures/ -->
```

or pass `--exclude <prefix>` for one run. In a git repository a second marker is read too, for what a hub's own
directory may hold: `exempt` names files that may sit loose beside a hub, `skip` drops path prefixes from the
per-hub checks.

```markdown
<!-- verify-hubs: exempt entrypoint.sh; skip generated/ -->
```

## The verifier: `aw hubs`

`aw hubs [path] [--json] [--exclude PREFIX …]`: the whole tree, read-only. Exit 0 clean (also when there is no
code yet), 1 warnings, 2 critical.

It works in two layers. What the tree owes as a whole (a root file, a hub in every non-leaf code directory, no
directory that mixes loose source with code folders, the size budgets) is read from the files on disk. What a hub
says about its own directory (its lines, the files beside it, its `CLAUDE.md`) is read in a git repository from
what git would commit, so build output and ignored folders never count, and a line that names a git-ignored path
is not stale. Outside a repository, or for a path below its top, those checks run from the files on disk too,
and there a list item, a link or a table row that leads with the child still names it.

| Code | Level | Meaning | Fix |
|---|---|---|---|
| `HUB_ROOT_MISSING` | warning | source files, no root `AGENTS.md` | write the root (`aw setup --plan`) |
| `HUB_ISOLATION` | critical once a root exists, warning before | source files beside an `AGENTS.md` (rule 1); tool config files (`*.config.js`, `*.config.ts`), dotfiles and the marker's `exempt` names are let be | move the code into sub-directories, or remove the hub if the directory is a leaf |
| `HUB_MISSING` | warning | a non-leaf code directory without a hub (rule 4) | write it |
| `HUB_MIXED_DIR` | warning | loose source files beside code sub-directories | move the files down a level, then add the hub |
| `HUB_SIZE`, `ROOT_SIZE` | warning | over `budgets.hubLines` / `budgets.rootAgentsLines` | a hub: back to one line a child; the root: move the why into decisions and memory |
| `HUB_STALE_CHILD` | warning | a line opens with a child that is not there (rule 5) | fix or delete the line |
| `HUB_UNLISTED_CHILD` | warning | a sub-directory no line of the hub opens with (rule 5): in a git repository every folder git would commit, code or not | add its line |
| `CLAUDE_CHAIN` | warning | a `CLAUDE.md` beside a hub with content of its own; and, where the root `CLAUDE.md` imports `@AGENTS.md`: a hub without its twin, an orphan | `aw twins` |

A legacy tree ramps in: before a root `AGENTS.md` exists nothing is critical. Whether a line is *true* stays a
matter of reading; the verifier checks that the lines and the folders match.
