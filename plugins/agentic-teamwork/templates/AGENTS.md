# templates: what a repo is scaffolded from

`init-project.mjs` renders `common/` into every repo and, on a fresh scaffold, exactly one starter on top of it. `render.mjs` replaces the `{{TOKEN}}` placeholders in every text file as it copies, and the sha256 of each written file goes into the repo's `.agents/manifest.json`, so `--upgrade` can tell an edited file from an untouched one.

A starter carries a `template.json`: its Layout lines for the root hub and the four lane commands written into the marker's `lanes`.

## Layout

- `common/` - what every repo gets: the root hub, the `.agents/scripts/` it runs itself (`verify-standard.mjs`, `lane.mjs`, `plugin-check.mjs`), and `gitignore.block`, the managed block merged into `.gitignore`. Its `README.md`, `CONTRIBUTING.md` and `.gitattributes` are starter files: a fresh scaffold writes them, an upgrade never does. Descend to change the conventions themselves.
- `library/` - a zero-dependency Node package: one public surface, one unit lane on `node --test`.
- `node-service/` - a Node 22 service with no dependencies: `server/` with the unit and integration lanes, `e2e/` with an optional browser lane, a Dockerfile, and compose for a local database.
- `ci/` - the CI gate, one file per forge: `github.yml` (a workflow), `gitlab.yml` (a local include), and `gitlab-ci.yml`, the pipeline file a GitLab repo gets when it has none. Each runs the repo's own `verify-standard.mjs` and its unit lane.
- `githooks/` - `pre-commit`, installed as `.githooks/pre-commit` for commits made outside an agent.
- `settings.merge.json` - merged into the repo's `.claude/settings.json`: the permission rules, and the session hook that runs `plugin-check.mjs`.
