# Finding and fixing references after a move

Moving a file is the easy half. The hard half is that other files *point at* the
moved file — by import path, by config string, by build rule — and those
pointers break the moment the path changes. A reorg that leaves the build red
has failed (philosophy principle 8). This reference is how the plan phase
*predicts* breakage per move and how the apply phase *fixes* it.

The governing idea: **for every move, enumerate the kinds of reference that
could point at the old path, locate the concrete ones, and pair the move with an
exact edit recipe.** Predict during planning (read-only); apply after approval.

## The categories of reference

### 1. Code imports (the big one)

How a moved module is referred to depends on the language:

- **Python:** `import a.b.c`, `from a.b import c`. Moving
  `pkg/foo.py` → `pkg/sub/foo.py` changes `pkg.foo` to `pkg.sub.foo`
  everywhere. Watch relative imports (`from . import x`, `from ..util import y`)
  — their meaning shifts with the file's depth. Adopting a `src/` layout can
  change the top-level import name; account for that across the whole tree.
- **Node/TS:** relative `import './x'` / `require('../y')` break by relative
  position; path aliases (`@/foo`) are defined in `tsconfig.json`
  `paths` / bundler config — update those too. Re-exporting barrels
  (`index.ts`) often need editing.
- **Go:** imports are by module path; moving a package changes its import path
  for every importer. `internal/` has compiler-enforced visibility rules.
- **Rust:** `mod` declarations and `use` paths; moving a file changes the module
  tree.

**Find them:** grep for the old module name / path across the repo *before*
moving. For Python, search both dotted (`pkg.foo`) and `from pkg import foo`
forms. For relative imports, you must reason about each importer's new relative
distance, not just string-replace.

### 2. Build, packaging, and tooling config

- **Python:** `pyproject.toml` / `setup.py` / `setup.cfg` — `packages`,
  `package-dir`, `[project.scripts]` entry points, `[tool.setuptools]`
  `package-data`, `MANIFEST.in` include paths.
- **Node:** `package.json` `main`, `bin`, `exports`, `files`, `workspaces`
  globs; `tsconfig.json` `include` / `paths`; bundler config (vite/webpack/
  rollup) entry and alias paths.
- **Go:** rarely path-config-driven, but check `//go:embed` directives whose
  patterns are path-relative.
- Test runner config: `pytest.ini` / `tool.pytest` `testpaths`, `jest`
  `roots` / `moduleNameMapper`.

### 3. CI / automation

`.gitlab-ci.yml`, `.github/workflows/*.yml`, `Makefile`, shell scripts: look for
hard-coded paths in `script:` steps, `cd` commands, coverage/include globs,
artifact paths, and cache keys.

### 4. Containers / deploy

`Dockerfile` (`COPY`/`ADD` source paths, `WORKDIR`, `CMD`/`ENTRYPOINT` script
paths), `docker-compose*.yml` (`build.context`, `volumes`, `dockerfile`),
k8s/terraform file references.

### 5. Docs and in-repo links

Markdown links and code-fence paths in `README`/docs that point at moved files.
Lower stakes (won't break a build) but a broken README link erodes the very
navigability the reorg is for — fix the obvious ones.

### 6. Runtime/dynamic references (the dangerous tail)

The references a grep for an import won't catch:

- String paths: `open("config/settings.yaml")`, `Path(__file__).parent /
  "templates"`, `os.getcwd()`-relative paths.
- Dynamic import / reflection: `importlib.import_module("pkg.foo")`,
  `__import__`, `require(variable)`, plugin registries that scan a directory,
  Django/Flask app paths, entry-point strings in config.
- Anything that computes a path from `__file__` — moving the file changes what
  that resolves to.

**These cannot be found by import-grep alone.** Grep for the *filename* and the
*directory name* as bare strings too, and flag anything dynamic as a manual-
review risk in the plan rather than auto-editing it. It is better to tell the
human "this move may affect a dynamic import here" than to silently break it.

## The plan-phase recipe (read-only)

For each proposed move `old_path → new_path`:

1. Grep the repo for: the dotted/module form of the old path, relative-import
   fragments that target it, the bare filename, and the bare directory name.
2. Bucket the hits by category above.
3. For each hit, write a concrete fix: file, the old string, the new string.
4. Rate confidence: **mechanical** (plain import/string swap), or **risky**
   (relative-import depth change, dynamic path, build-config semantics). Risky
   items get surfaced for human attention even if auto-fixable.

Record this as the move's `ref_impact` so the apply phase has an exact to-do
list and the human can see the blast radius before approving.

## The apply-phase recipe (mutating, post-approval)

1. **`git mv` every file** so history follows it (never delete-then-create).
2. **Apply the mechanical fixes** from each move's recipe — precise string
   edits, not blind global search-and-replace (a global replace of a short
   module name will corrupt unrelated matches).
3. **Re-grep after moving** to catch references the plan missed, especially bare
   filename/dirname strings.
4. **Verify** with the project's own tooling (see below). Verification is not
   optional — it is how you know the references were actually fixed.

## Verifying behavior is preserved

Detect and run whatever the repo already uses; let exit codes be the judge:

- **Python:** `python -c "import <package>"` as a fast smoke test, then
  `pytest` (or `pytest --co` just to confirm collection succeeds if a full run
  is too slow). `ruff`/`flake8` for unresolved imports.
- **Node:** `npm run build` / `tsc --noEmit` for type/path resolution, then
  `npm test`.
- **Go:** `go build ./...` then `go test ./...`.
- **Rust:** `cargo build` then `cargo test`.
- Fall back to a `Makefile` target (`make test`, `make check`) or CI script
  commands if present.

A clean build/test after the moves is the success criterion. If it goes red,
report exactly what failed and the suspected missed reference — the user is on a
branch (or has a clean tree), so reverting is a `git reset`/`git checkout` away;
do not attempt clever partial rollbacks that muddy the history.
