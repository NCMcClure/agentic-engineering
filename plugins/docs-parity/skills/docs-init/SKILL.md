---
name: docs-init
description: "Adopt docs-parity in a repo: detect the stack and the docs target, then write .agents/docs-parity.json (with a first code-to-docs surface map) and the writer contract .agents/docs-contract.md. Use when a repo with user docs should get the docs rule in every session, the Stop check, and the checker in CI."
disable-model-invocation: true
argument-hint: "[target: site | docs-folder | wiki | readme] [audiences]"
---

# docs-init

Adoption writes two files and overwrites nothing: the config `.agents/docs-parity.json` and the writer
contract `.agents/docs-contract.md`. Nothing else has to be installed in the repo. The rule arrives through
the plugin's session hook in any repo that carries the config, the Stop hook checks each turn against it, and
the checker runs from the plugin: `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs"`. Investigate first,
propose, write only after the user agrees.

## Step 1: Detect what exists

Read the tree before asking anything. Follow the first docs convention that exists:

| Found | Target | Pages live in | Nav manifest |
|---|---|---|---|
| `source.config.ts` with fumadocs, or `content/docs/**/meta.json` | `site:fumadocs` | `content/docs/` | `meta.json` per folder |
| `docusaurus.config.*` | `site:docusaurus` | `docs/` | `sidebars.*` (checker: `none`) |
| `.vitepress/config.*` | `site:vitepress` | the folder holding `.vitepress/` | the config's `sidebar` (checker: `none`) |
| `astro.config.*` with `@astrojs/starlight` | `site:starlight` | `src/content/docs/` | the config's `sidebar` (checker: `none`) |
| `mkdocs.yml` | `site:mkdocs` | its `docs_dir` (default `docs/`) | `nav:` in `mkdocs.yml` |
| `conf.py` beside `index.rst` | `site:sphinx` | that folder | `toctree` (checker: `none`) |
| `book.toml` | `site:mdbook` | `src/` | `src/SUMMARY.md` |
| a `<repo>.wiki` remote, or a `wiki/` folder with `Home.md` | `wiki:github` or `wiki:gitlab` | `wiki/` in the code repo | `_Sidebar.md` / `_sidebar.md` |
| `docs/` or `doc/` of markdown | `docs-folder` | that folder | an index page's links, or `none` |
| only a README | `readme` | `README.md` | none |

A wiki's source of truth moves into the code repository (`targets.md` says why and gives the publish job).
Then find the product's surfaces: the UI's routes or screens, the CLI's commands, the public API's routes,
the config schema, the install/deploy docs. Note the language and build of each, since that picks the capture
recipe.

*Done when: you can name the target, the pages folder, the nav manifest, and every surface a reader meets.*

## Step 2: Ask only what the tree did not answer

- **Audiences.** One root, or two or three (Guide, Developers, Admin)? Which root is private? (`audiences.md`)
- **Screenshots.** Light and dark pairs (the product themes), single images, or none (a library, an API)?
- **Target, only when nothing exists.** Default to a `docs/` folder of markdown with an index page; a site
  only when the user wants one, a wiki only when the team already reads one.
- **The README check.** Off unless asked for. With a `readme` block in the config, the Stop hook also holds
  a README the turn changed to 800 words and standard-readme's sections (the `readme` skill has the rules).
- **CI.** Whether the pipeline should run the checker; it needs a copy in the repo (Step 3).

## Step 3: Propose, then write

Show the user the config and the contract, then write them:

1. `.agents/docs-parity.json` from `${CLAUDE_PLUGIN_ROOT}/skills/docs-init/assets/docs-parity.json`, filled in. One
   **surface** per thing a reader meets, with code globs narrow enough that a change to it really is a change
   to its pages (a surface per screen family or command group, not `src/**`). Field reference:
   `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/config.md`.
2. `.agents/docs-contract.md` from `${CLAUDE_PLUGIN_ROOT}/skills/docs-init/assets/docs-contract.md`, with the
   project's roots, components, image paths and capture command. It lives under `.agents/` because it is
   written for agents; nothing agent-facing goes into the user docs folder.
3. If the repo keeps a hub that lists what `.agents/` holds (`.agents/AGENTS.md`, or the root `AGENTS.md`),
   one line there for each of the two files. Do not copy the rule into `AGENTS.md`: the session hook delivers
   it, and a second copy drifts. A rule like it that is already there stays only if people work in the repo
   without the plugin.
4. If the docs are a site package with its own build, its folder is ordinary code: it gets a hub `AGENTS.md`
   that maps its directories, like any other.
5. CI, when the user wants it: copy `${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs` to
   `.agents/scripts/docs-check.mjs` (one file, Node stdlib only, so the runner needs no plugin) and add the job
   from `targets.md`, which has the GitHub Actions and GitLab CI forms and the wiki publish job. With the
   README check on, `readme-check.mjs` is copied the same way. A repo whose pipeline still runs a
   `docs_check.py` from an earlier adoption keeps working on the same config; replace it with the Node copy
   when the user agrees.

Never overwrite an existing file; a conflict is a report line.

*Done when: `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs"` runs in the project and prints its summary,
and every finding it prints is either fixed, accepted in `accept` with a why, or listed for the user.*

## Step 4: The harness

If the product has anything to photograph and no capture harness exists, say so and open `docs-shots`, or,
if the user wants it later, add it as a task in the project's tracker (with agent-works, a card:
`aw kanban add`). Adoption does not wait for the harness; the checker and the rule work without one.
