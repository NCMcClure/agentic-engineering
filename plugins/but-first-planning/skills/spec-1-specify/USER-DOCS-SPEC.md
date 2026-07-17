# End-user docs plan, scaled by posture

The spec site documents the *design* for the people building the system;
`build-user-docs` documents the *product* for the people who'll use it. Left
unplanned, that second body of docs becomes one rushed pass at the end — a
README that grew by accretion instead of a docs set with a shape. This
contract makes the shape a spec-phase decision: every spec carries a
**`user-docs-plan.md`** content page that pins the docs stack and the page
map before the first sprint builds anything.

How much docs machinery the project carries follows the recorded **user-docs
posture** (`reference/adr/0003-user-docs-posture.md`, asked once by
`spec-0-init`):

- **docs-site** (the default) — end-user docs are a structured multi-page
  site: a `docs/` directory of logically paced pages plus a static-site
  config (MkDocs unless the user names another generator). Pick this whenever
  the product has more than one thing to explain.
- **readme-only** — a single README carries install + usage. For tiny tools
  where a second page would be padding. The page map below collapses to a
  section map of the README.
- **existing-convention** — a brownfield project already has a docs
  convention (a `docs/` tree, a Docusaurus site, man pages); the spec captures
  *what exists* as the constraint and plans pages in those terms.
  `build-user-docs`'s detection order (its
  [DOCS-STATE.md](../build-user-docs/DOCS-STATE.md)) stays the mechanism for
  finding it.

## The mandatory page: `user-docs-plan.md`

A content file named exactly `user-docs-plan.md` (the exact filename is the
machine contract — `verify-spec-tree.py` warns when it's missing, and
`plan-0-decompose` anchors the docs-skeleton issue to it), living in whichever
category fits the project. Normal frontmatter, normal size rules. It pins
three things:

### 1. The stack

One short section restating the posture concretely: generator and theme (or
"README only"), where the config lives, where pages live, how the site is
served/published if that's decided. Nothing here is prose about documentation
philosophy — it's the answer to "what files exist and what builds them".

### 2. The page map

The load-bearing section. A table of the end-user pages, **logically paced**
— the order a new user meets the product: install → quickstart → one page per
topic → reference. One topic per page, same discipline as spec content files.

```markdown
| Page | Purpose | Fed by epic |
|------|---------|-------------|
| `index.md` | what this is, install, 5-minute quickstart | E01 |
| `importing.md` | getting data in: sources, formats, failure modes | E02 |
| `queries.md` | the query language, one worked example per verb | E03 |
| `reference/cli.md` | every command and flag, generated tone | all |
```

The map is a plan, not a promise — pages appear when the behaviour they
document verifies (the gate rule in
[build-user-docs](../build-user-docs/SKILL.md) is unchanged). But the *shape*
is decided here, so each sprint's docs pass slots pages into a structure
instead of inventing one per pass.

### 3. Epic contributions

One line per epic naming which page(s) its user-facing surfaces land in (the
`Fed by` column above, or a short list). This is what lets
`plan-0-decompose` write honest `**User-facing**` lines and what
`spec-4-edit` greps when a spec change ripples into shipped docs.

## Who consumes this page

- **`plan-0-decompose`** cuts an early AFK **docs-skeleton issue** — site
  config + landing page per the stack section — anchored to this page, so the
  docs stack exists from sprint one and every later docs pass has a home to
  write into. Every issue carries a `**User-facing**` line (its format is
  owned by [PLAN-FORMAT.md](../plan-0-decompose/PLAN-FORMAT.md)).
- **`build-user-docs`** reads the page map as intent before its layout
  detection — when this page exists, it pins the layout; detection is the
  fallback for brownfield and pre-3.7 trees.
- **`spec-4-edit`** treats an edit to this page, or to behaviour already
  documented, as a docs ripple (its [SYNC.md](../spec-4-edit/SYNC.md) says
  how).

## The test

The page is done when a stranger handed only the page map could say, for any
behaviour in the spec, *which docs page will explain it to an end user* — and
when the docs-skeleton issue could be built from the stack section alone.
