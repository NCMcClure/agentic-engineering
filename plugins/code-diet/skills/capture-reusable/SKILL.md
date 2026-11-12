---
name: capture-reusable
description: "At the end of a session, find what this work built that another project would want: a component, a repo-agnostic utility, a script, or a pattern worth a plugin. Writes a row in .agents/reuse-opportunities.md for each. Use when wrapping up work that produced something general; reuse-first is the same question pointed the other way."
---

# capture-reusable

`reuse-first` asks what already exists. This asks what is about to be missed. Without it, the second project that needs a markdown renderer writes a second markdown renderer.

## Step 1: Gather the candidates

Four sources, in this order:

1. **`.agents/reuse-opportunities.md`**, if it exists. Every line in it is a deliberate non-reuse somebody already judged: the strongest candidates, already explained.
2. **New components.** Anything this work added under a `components/` directory, or the project's equivalent, that did not come from a library the project already depends on.
3. **Repo-agnostic utilities.** A function or module whose imports are all stdlib or platform, whose name does not mention this project, and which a second repo could paste unchanged. Check the imports rather than guessing from the name.
4. **Scripts.** A tool this work added under `scripts/` or `.agents/scripts/` either does a job every repo has or belongs to this one forever. Say which.

Read the git log for this branch to bound the search to what this work produced; a survey of the whole repo is a different, larger job.

*Done when: each candidate has a path and one line on what it does.*

## Step 2: Judge each one

One verdict each:

- **publish**: another project would use this as it stands. Name where it goes: a shared library (one of the checkouts listed under `code-diet.reuse` in git config, if it fits there), a package, or a plugin when it is a workflow or an agent-facing tool.
- **generalize first**: it would be used elsewhere after one specific thing is lifted out (a hardcoded path, a project name, a config assumption). Name that thing.
- **stays here**: it is genuinely about this repo. Most things are, and saying so is a real answer.

The test for `publish` is whether a second repo would take it *unchanged*. "Could be generalized" is `generalize first`, not `publish`.

*Done when: every candidate carries one verdict.*

## Step 3: Write the ledger row

Append to `.agents/reuse-opportunities.md`, creating it if it is absent:

```
- <date> <what> (<path>). Verdict: publish|generalize first. Where it goes: <destination>. <one clause on why>.
```

Ledger rows are for `publish` and `generalize first`. A `stays here` verdict needs no row; it needs no memory either.

*Done when: a row exists for every candidate that is not `stays here`.*

## Step 4: Hand it to the person

Show the rows. Nothing is filed or moved anywhere: the person decides what leaves this repo. When they want to act on one, and the plugin is installed, `/plugin-workbench:create-plugin` takes a workflow or an agent-facing tool, and `/codebase-optimizer:improve-codebase-architecture` takes a candidate that needs this repo restructured before it can be lifted out.

*Done when: the person has seen every row.*
