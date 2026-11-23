# Where moved content goes

A README rewrite moves sentences; it never drops them. Sort by who reads it and when.

| Content | Home | The README keeps |
| --- | --- | --- |
| What it is, why, install, the shortest usage | the README | all of it |
| Building, testing, branching, pull requests, releasing, operations runbooks, credentials a maintainer mints once | root `CONTRIBUTING.md`, which may name AGENTS.md | a Contributing section of one to three lines pointing at it |
| User depth past 800 words: per-platform install detail, deeper usage, configuration, known limits, troubleshooting | `docs/`, one page per topic | a sentence and a link where the depth used to be |
| Anything written for an agent: prompts, rules, the map of the tree, plumbing paths | AGENTS.md or `.agents/rules/` | nothing |
| Release history, per-version notes | `CHANGELOG.md` | nothing |

The checker requires none of these files. Create the one a move needs, and add its line to the root hub's Layout in the same change when the repo keeps one.

## Edge cases

- **An install prompt a person pastes into an agent** is user content, not agent context: the person reads it and chooses to run it. It moves to `docs/install.md` (it is usually long), and the README's Install section says what it does in a sentence and links to it.
- **A command table that is half user, half maintainer** splits: the user half stays in Usage, the maintainer half goes to CONTRIBUTING.md.
- **A plugin, package, or service table** is the repo's own section, between Usage and API. Keep each row to one line; depth goes to that item's own README.
- **A repo that carries `.agents/docs-parity.json`** writes each new `docs/` page to the audiences and the page shape in the `docs-parity` skill's references, and adds it to the nav manifest.

## The accept format

A mention a person cannot do without stays with an entry in the `readme` block of `.agents/docs-parity.json`:

```json
"readme": {
  "accept": [
    { "path": "README.md", "term": ".claude", "why": "Install tells a person where their own settings file lives" }
  ]
}
```

One entry clears one term (`.agents`, `AGENTS.md`, `CLAUDE.md`, or `.claude`) in one file. The `why` says why the person needs it; an entry with an empty or missing `why` clears nothing and is a `readme-accept` finding. `"paths"` sits in the same block and opts other READMEs into the check, and `"name"` says what the root README's title must be when the repository's own name is not it. A repo that carries `.agents/manifest.json` may keep the block there instead; both files are read.
