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
- Lead each line with the child's name in a code span or a link. That is how `aw hubs` matches lines to folders.
- A child whose purpose does not fit one honest line is a finding, not a writing problem: the directory probably
  wants splitting. Report it instead of faking the line.
- Rules, commands and reasons stay out of a sub-directory hub: they live in the root file and in memory.

Start a new hub from `assets/templates/agents-hub.md`. A directory that mixes loose source files with code
sub-directories cannot take a hub until the files move down a level; moving code is a reorganisation, with imports
and build files to fix, and belongs to a tool made for it (in this marketplace: codebase-optimizer).

## CLAUDE.md twins

The guidance is tool-neutral (`AGENTS.md`); Claude Code reads `CLAUDE.md`. A twin is a one-line `CLAUDE.md` beside
each `AGENTS.md` whose whole content is `@AGENTS.md`. One source, no copy. `claude.twins` in the config chooses:

| Mode | Twins are | Written by |
|---|---|---|
| `generated` (default) | git-ignored | the session-start hook and `aw twins`, so a fresh clone or worktree heals itself |
| `committed` | tracked | `aw twins` |
| `off` | absent | nobody |

A root `CLAUDE.md` with content of its own is never overwritten: move its content into `AGENTS.md`, leave the one
line, run `aw twins`. A twin whose `AGENTS.md` is gone is an orphan to delete.

## Leaving a tree out

Never walked: dot-directories (so `.agents/` and `.git/`), dependency and build folders (`node_modules/`,
`build/`, `dist/`, `target/`, `out/`, `vendor/`, virtual environments), and an `archive/`. For a generated or data
tree that follows its own layout, put one marker line in the root `AGENTS.md`:

```markdown
<!-- verify-agents-tree: skip generated/ data/fixtures/ -->
```

or pass `--exclude <prefix>` for one run.

## The verifier: `aw hubs`

`aw hubs [path] [--json] [--exclude PREFIX …]`: the whole tree, read-only. Exit 0 clean (also when there is no
code yet), 1 warnings, 2 critical.

| Code | Level | Meaning | Fix |
|---|---|---|---|
| `HUB_ROOT_MISSING` | warning | source files, no root `AGENTS.md` | write the root (`aw setup --plan`) |
| `HUB_ISOLATION` | critical once a root exists, warning before | source files beside an `AGENTS.md` (rule 1) | move the code into sub-directories, or remove the hub if the directory is a leaf |
| `HUB_MISSING` | warning | a non-leaf code directory without a hub (rule 4) | write it |
| `HUB_MIXED_DIR` | warning | loose source files beside code sub-directories | move the files down a level, then add the hub |
| `HUB_SIZE`, `ROOT_SIZE` | warning | over `budgets.hubLines` / `budgets.rootAgentsLines` | a hub: back to one line a child; the root: move the why into decisions and memory |
| `HUB_STALE_CHILD` | warning | a line leads with a child that is not there (rule 5) | fix or delete the line |
| `HUB_UNLISTED_CHILD` | warning | a code sub-directory the hub does not name (rule 5) | add its line |
| `CLAUDE_CHAIN` | warning | only where the root `CLAUDE.md` imports `@AGENTS.md`: a hub without its twin, a twin with other content, an orphan | `aw twins` |

A legacy tree ramps in: before a root `AGENTS.md` exists nothing is critical. Whether a line is *true* stays a
matter of reading; the verifier checks that the lines and the folders match.
