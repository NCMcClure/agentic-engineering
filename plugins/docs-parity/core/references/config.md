# `.agents/docs-parity.json` and the finding codes

One file says where the docs are, who they are for, how pictures are made, and which code each page and shot
describes. `docs_check.py` reads it; the hooks look for it to decide whether the project opted in. Paths and
globs are repo-relative; `**` matches any depth, `*` stays inside one folder.

## Fields

| Field | Default | Meaning |
|---|---|---|
| `target` | `docs-folder` | `site:<generator>`, `docs-folder`, `wiki:github`, `wiki:gitlab`, or `readme` (`targets.md`) |
| `docsRoot` | `docs` | the folder holding the pages |
| `include` | all markdown under `docsRoot` | globs that narrow the pages (`["README.md"]` for README-only) |
| `nav` | `auto` | `meta.json`, `mkdocs`, `summary`, `sidebar`, `none`, or `auto` (detects the first four) |
| `frontmatter` | `[]` | keys every page must carry, such as `["title", "description", "tags"]` |
| `tags` | none | `[min, max]` tag count when pages carry `tags` |
| `summary` | `true` | every page opens with a summary paragraph |
| `pageBudget` | `120` | lines per page before `PAGE_BUDGET`; `0` turns it off |
| `linkBase` | `/` | the URL prefix a root-relative link starts with (`/docs/` when links carry the base path) |
| `siteRoot` | `docsRoot` | where a root-relative image path resolves when `images.urlPrefix` does not match |
| `roots` | `[]` | `{name, path, private?, deny?}`: `path` is relative to `docsRoot`, `deny` a list of regexes (`audiences.md`) |
| `images.dir` | none | the folder holding every docs image; enables the orphan check |
| `images.urlPrefix` | none | the URL prefix pages use for that folder (`/images/` when a site serves `public/images` there) |
| `images.themes` | `["default"]` | the variants of each shot; `["light", "dark"]` requires a dark twin |
| `images.darkSuffix` | `.dark` | the twin's suffix before the extension |
| `images.manifest` | `<images.dir>/shots.json` | the harness's record of the commit each shot was taken at (`shot-contract.md`) |
| `capture` | none | the command that runs one group, with `{group}` where the group's name goes |
| `surfaces` | `[]` | the code-to-docs map, below |
| `ignore` | hubs, `CLAUDE.md`, test files | globs never counted as a surface's code change |
| `accept` | `[]` | `{code, path?, why}`: findings the owner accepted; never a critical one in spirit |

## Surfaces

A surface is one thing a reader meets: a screen family, a command group, an endpoint family, the config file.

```json
{"name": "export", "code": ["src/export/**", "src/cli/export.rs"], "exclude": ["src/export/internal/**"],
 "pages": ["docs/exporting.md"], "shots": ["docs/images/export/**"], "group": "export"}
```

`code` is what, when it changes, may change what the reader sees; `pages` and `shots` are what describes it;
`group` names the capture group to rerun. Keep `code` narrow: a surface of `src/**` reports every refactor,
and a reported refactor teaches everyone to write `Docs: none` without reading.

## Modes and exit codes

```bash
python3 docs_check.py                        # the tree checks
python3 docs_check.py --changed HEAD         # plus parity of the working tree against the last commit
python3 docs_check.py --changed main..HEAD   # plus parity of a branch; reads Docs: lines in its commits
python3 docs_check.py --stale                # plus shots older than their surface's last code change
python3 docs_check.py --no-tree --stale --json
```

`--note TEXT` adds text (a pull request body) to search for a `Docs: none, <why>` line, which turns
`PARITY_MISSING` into info for that range. `--config PATH` reads a config from elsewhere. Exit 0 when only
info remains, 1 on warnings, 2 on a critical finding.

## Finding codes

| Code | Severity | What it means | The fix |
|---|---|---|---|
| `DOCS_ROOT_MISSING` | critical | `docsRoot` does not exist | fix the config |
| `ROOT_LEAK` | critical | a public page links into a private root | reword for the reader, or "ask your administrator" |
| `PARITY_MISSING` | warning | a surface's code changed, its pages and shots did not | `docs-sync`, or `Docs: none, <why>` |
| `SHOT_STALE` | warning | a shot was taken before its surface's code last changed | look; retake the group if the screen moved |
| `IMAGE_MISSING` | warning | a page embeds an image that does not exist | take the shot, or fix the path |
| `IMAGE_NO_DARK` | warning | a themed project's image has no dark twin | retake through the harness |
| `IMAGE_ORPHAN` | warning | an image in `images.dir` no page embeds | delete it, or embed it |
| `LINK_BROKEN` | warning | an internal link resolves to no page | fix the link, or restore the page |
| `NAV_MISSING` | warning | a page the nav manifest does not list | add it in reading order |
| `NAV_DEAD` | warning | a nav entry with no page behind it | remove it, or restore the page |
| `NAV_INVALID` | warning | a nav manifest that does not parse | fix the file |
| `FRONTMATTER_MISSING` | warning | a required frontmatter key is absent | add it |
| `FRONTMATTER_TAGS` | warning | tag count outside the configured range | retag |
| `SUMMARY_MISSING` | warning | the page does not open with a summary paragraph | write two to four sentences up top |
| `PAGE_BUDGET` | warning | the page is over `pageBudget` lines | split by topic |
| `ROOT_DENY` | warning | a root's deny pattern matched outside code | rewrite in the root's terms, or move the passage |
| `SHOTS_UNCHANGED` | info | pages changed with the code, shots did not | retake if the change shows on screen |
