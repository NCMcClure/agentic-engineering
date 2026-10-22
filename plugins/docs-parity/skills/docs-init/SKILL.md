---
name: docs-init
description: "Adopt docs-parity in a project: detect the stack and the docs target, write .agents/docs-parity.json, the writer contract, the root AGENTS.md rule and a first code-to-docs surface map."
disable-model-invocation: true
argument-hint: "[target: site | docs-folder | wiki | readme] [audiences]"
---

# docs-init

Adoption writes four things and overwrites none of them: the config, the writer contract, one rule in the
root `AGENTS.md`, and (when the project has a UI and no harness) a card or a note that the capture harness is
owed. Investigate first, propose, write only after the user agrees.

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

## Step 3: Propose, then write

Show the user the config, the contract and the rule line, then write them:

1. `.agents/docs-parity.json` from `${CLAUDE_PLUGIN_ROOT}/assets/templates/docs-parity.json`, filled in. One
   **surface** per thing a reader meets, with code globs narrow enough that a change to it really is a change
   to its pages (a surface per screen family or command group, not `src/**`). Field reference: `config.md`.
2. `.agents/contracts/docs.md` from `${CLAUDE_PLUGIN_ROOT}/assets/templates/contract-docs.md`, with the
   project's roots, components, image paths and capture command. It lives under `.agents/` because it is
   written for agents; nothing agent-facing goes into the user docs folder.
3. The rule in the root `AGENTS.md`, under its rules, from `${CLAUDE_PLUGIN_ROOT}/assets/templates/agents-rule.md`.
   Five lines at most; the contract holds the detail. If a rule like it already exists, edit that one instead.
4. If the docs are a site package with its own build, its folder is ordinary code: it gets a hub `AGENTS.md`
   that maps its directories, like any other.
5. CI: add `python3 docs_check.py --changed "$BASE"..HEAD --stale` (the script copied or vendored, or the
   plugin's path on a runner that has it) to the pipeline the project already has. `targets.md` has the
   GitHub Actions and GitLab CI forms, and the wiki publish job.

Never overwrite an existing file; a conflict is a report line.

*Done when: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/docs_check.py"` runs in the project and prints its
summary, and every finding it prints is either fixed, accepted in `accept` with a why, or listed for the user.*

## Step 4: The harness

If the product has anything to photograph and no capture harness exists, say so and open `docs-shots` (or,
with agent-works, owe it as a card: `aw kanban add`). Adoption does not wait for the harness; the checker and
the rule work without one.
