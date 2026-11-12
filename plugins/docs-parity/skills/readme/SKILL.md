---
name: readme
description: "Rewrite a README so it tells a person what the project is, why to use it, and how, in at most 800 words and standard-readme's section order, and move everything else to its proper home (CONTRIBUTING.md, docs/, AGENTS.md, CHANGELOG.md). Use when readme-check.mjs, the Stop hook, or CI reports a readme-* finding or warning, when a README is over the limit, and when writing or reviewing a README."
---

# readme

A README is the first thing a person reads to learn what a project is, why they would use it, and how. In a
repo agents build, it grows into agent context: pasted prompts, rule restatements, build plumbing, and
history. `readme-check.mjs` holds the line mechanically, and this skill does the rewrite that gets a README
past it without losing a sentence.

## Which READMEs

The root `README.md` always. Any other README only when the repo opts it in: the `readme` block in
`.agents/docs-parity.json` carries `"paths": ["packages/*/README.md"]`, and each opted-in README is named for
its directory. Run the check to see the list and the findings:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/readme-check.mjs"          # or --json
```

It needs no config: with none, it checks the root README and names it for the repository. The Stop hook runs
it on a README a turn changed only in a repo whose config carries a `readme` block.

*Done when: you know which files fail, and why, finding by finding.*

## Step 1: Inventory before you cut

Read the whole README and sort every section and paragraph into one of five piles, by who reads it and when:

1. **The README keeps it**: what the project is, why it exists, how to install it, the shortest working
   usage, and anything a person needs before their first run.
2. **CONTRIBUTING.md**: building, testing, branching, pull requests, releasing, operations runbooks.
3. **docs/**: user depth past 800 words, such as per-platform install detail, deeper usage, and known limits.
4. **AGENTS.md or `.agents/rules/`**: anything written for an agent, prompts included.
5. **CHANGELOG.md**: history.

The full map, with the edge cases, is in `${CLAUDE_PLUGIN_ROOT}/skills/readme/references/content-map.md`.
Nothing is deleted: each sentence leaves for a pile or stays.

*Done when: every paragraph of the old README has a pile.*

## Step 2: Rewrite to the skeleton

Title, one-liner, why paragraph, Install, Usage, the repo's own sections, Contributing, License when a LICENSE
sits beside it. The exact rules (word count, title form, section names and order) are in
`${CLAUDE_PLUGIN_ROOT}/skills/readme/references/skeleton.md`. Write the why paragraph from what the project
solves, not what it contains. The Contributing section becomes one to three lines pointing at CONTRIBUTING.md.

When the repo carries `.agents/docs-parity.json`, a page moved to `docs/` follows the audiences and the page
shape (`audiences.md` and `page-shape.md` in `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/`); a page
the README links to replaces the depth it used to carry.

*Done when: the README is the skeleton and every moved section exists in its new home.*

## Step 3: Plumbing that has to stay

A README that must name `.claude`, `AGENTS.md`, or another plumbing term (an install that writes a person's
own settings file, say) keeps it with an accept entry that says why. One entry clears one term in one file,
and an entry with no `why` is itself a finding. The format is at the end of `content-map.md`. Prefer moving
the sentence; an accept is for the mention a person cannot do without.

## Step 4: Check, and land it with the change

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/readme-check.mjs"
wc -w README.md
```

Both must hold: the check exits 0 and the count is 800 or fewer. The warnings (`readme-agent-prose`) never
fail, but read each one: a long `text` block or a sentence addressed to an agent is usually a prompt that
belongs in a skill or AGENTS.md.

The rewritten README lands in the same pull request as the change that needed it: a new feature, or the
README edit itself. Diff the old README against the new one and its new homes before you commit, so the
reviewer can see nothing was lost.

*Done when: the check passes, nothing from the old README is lost, and it is committed with the change.*
