# Idiomatic target layouts by ecosystem

Choose the target tree from what the repo's manifests reveal, not from personal
preference (philosophy principle 7). `repo_scan.py` reports `ecosystems` from the
manifest files it finds; use that, and when a repo is genuinely multi-language,
keep each language in its own idiomatic subtree rather than blending them.

For each ecosystem below: how to recognize it, the layout its community expects,
and the moves that usually get a messy repo there. These are defaults — a repo
with a deliberate, working layout that differs is not "wrong"; don't churn it
just to match a template.

## Python

**Recognize:** `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`,
`Pipfile`, `uv.lock`.

**Target (src-layout, preferred for libraries/apps that ship):**

```
repo/
├── pyproject.toml          # single source of build/deps config
├── README.md
├── src/
│   └── <package>/          # the importable package; was loose modules at root
│       ├── __init__.py
│       ├── cli/            # was a flat cli.py / many cli_*.py
│       ├── core/           # foundational modules others import
│       └── <feature>/      # by-feature subpackages
├── tests/                  # mirrors src/<package>/ structure
├── scripts/                # dev/ops scripts that are NOT importable code
└── docs/
```

**Common moves:**
- Loose root `*.py` that form a package → `src/<package>/` (keep a real entry
  point reachable via a `[project.scripts]` console-script in `pyproject.toml`).
- A flat module dir with 100+ files → split by feature (preferred) or by layer.
- A giant module (thousands of lines) → a *package* directory of focused modules
  with the public surface re-exported from its `__init__.py` (this is a refactor;
  flag it as higher-risk and optionally defer to the human).
- `tests/` should mirror the package tree so a test's location is predictable.

If the project already uses a flat top-level-package layout (`<package>/` at the
root instead of under `src/`) and it works, keeping that is fine — don't force a
`src/` migration purely for fashion; the win is internal grouping, not the prefix.

## Node / TypeScript

**Recognize:** `package.json` (check `workspaces` for a monorepo), `tsconfig.json`,
lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`).

**Target (single package):**

```
repo/
├── package.json
├── tsconfig.json
├── src/                    # all source; was loose .js/.ts at root
│   ├── index.ts            # entry / barrel
│   ├── components/
│   ├── lib/
│   └── <feature>/
├── test/ or __tests__/     # follow whatever the project already uses
├── scripts/
└── dist/                   # build output — .gitignore, never organize
```

**Target (workspace monorepo — `package.json` has `workspaces`):**

```
repo/
├── package.json            # workspace root
├── packages/
│   ├── <pkg-a>/{src,package.json}
│   └── <pkg-b>/{src,package.json}
├── apps/                   # deployable apps, if distinct from libraries
└── tooling/ or config/     # shared eslint/tsconfig bases
```

**Common moves:** loose root source → `src/`; respect the existing
`workspaces` globs — never move a file out of the path a workspace glob expects.

## Go

**Recognize:** `go.mod`, `go.sum`.

**Target:**

```
repo/
├── go.mod
├── cmd/<binary>/main.go    # one dir per executable; was loose main packages
├── internal/               # private packages (compiler-enforced privacy)
├── pkg/                    # public, importable-by-others packages (only if truly public)
└── <domain>/               # domain packages at the top level are idiomatic too
```

Go discourages deep nesting and a catch-all `src/`. Prefer `cmd/` for entry
points and `internal/` for everything not meant to be imported externally. Don't
invent `pkg/` unless the code is genuinely meant for external import.

## Rust

**Recognize:** `Cargo.toml`, `Cargo.lock`.

**Target:** `src/main.rs` or `src/lib.rs`, additional binaries under `src/bin/`,
integration tests under `tests/`, a workspace `Cargo.toml` with `members` for
multi-crate repos. Cargo's conventions are strict — follow them exactly.

## Ruby / PHP / Java / JVM / Elixir (brief)

- **Ruby:** `lib/`, `bin/`, `spec/` or `test/`; `Gemfile` at root.
- **PHP:** `src/` with PSR-4 autoload from `composer.json`; `tests/`.
- **Java/Kotlin (Gradle/Maven):** `src/main/<lang>/...`, `src/test/<lang>/...`
  — the build tool *requires* this; never deviate.
- **Elixir:** `lib/`, `test/`, `config/`; `mix.exs` at root.

## Mixed / polyglot repos

Many real repos are a primary language plus a UI plus infra. Don't blend them —
give each its own idiomatic subtree and keep the boundary obvious:

```
repo/
├── <primary-lang src per its idiom>
├── web/ or frontend/       # the JS/TS app, with its own package.json + src/
├── deploy/ or infra/       # Dockerfiles, compose, k8s, terraform
├── scripts/                # cross-cutting dev/ops scripts
└── docs/
```

The signal to keep things separate is a nested manifest: a directory with its
own `package.json` / `go.mod` / `Cargo.toml` is a self-contained unit — organize
*within* it by that language's idiom, but don't hoist its files into the parent.

## When the ecosystem is unclear

If no manifest is found, or the repo is mostly scripts/config/docs, fall back to
the language-agnostic version of the philosophy: intent-only root, group loose
files by concern into a handful of well-named directories, break up any
overstuffed directory, and isolate ephemera. The principles in `philosophy.md`
don't depend on a specific language.
