# code-diet

Every line an agent writes gets paid for more than once: at generation, again
at review, and again in every future session that loads it as context. Agents
over-build by default, and the surplus compounds. code-diet prices the line at
each of those moments, so the agent writes only what the task needs, checks
what already exists before building, and deletes what it did not need.

## How it works

**Before the code.** One ladder line stays in the agent's context: YAGNI, reuse
what the repo already has, stdlib, the platform, an installed dependency, one
line, then the minimum that works, with four carve-outs that are never climbed
past (trust-boundary validation, data-loss handling, security, accessibility).
The `ladder` skill is the full procedure behind that line. `reuse-first` is
rung 2 with a tool: `scripts/reuse-index.mjs` searches this repo, and any other
checkout you list, for a file whose name, opening comment, or definitions
cover the thing about to be built.

**At review.** `/code-diet:review-diet` has `scripts/review-scan.mjs` locate
cut candidates deterministically (single-caller wrappers, abstractions with
one implementation, dependencies that duplicate the platform, dead flags,
uncalled symbols). The model judges only the flagged spots and reports one
line each: file:line, the cut, the replacement. With `--apply`, each confirmed
cut is checked while it is the only change in the tree, committed on green,
and put back on red; the report says what was realized, never what was
possible.

**In every later session.** A deliberate shortcut carries a comment
`debt: <ceiling>, <trigger>`. `/code-diet:debt` inventories the markers and
re-judges each, so a deferral expires on its trigger instead of rotting. A
hook after each edit nudges the agent, and never blocks it, when a marker it
just wrote names a ceiling and no trigger. The grammar lives in one file,
`scripts/debt.mjs`, which the hook and the skill both read.

**On the way out.** `capture-reusable` asks the reuse question the other way
round: what did this work build that another project would want? It writes a
row per candidate in `.agents/reuse-opportunities.md`; nothing is filed or
moved for you.

One discipline, no intensity modes. Node 22, no dependencies.

## Where it speaks

The ladder line and the edit nudge reach the agent only where the repo has
opted in to the agentic-engineering plugins: it carries `.agents/manifest.json`
or one of the plugins' own markers, or you answered the one-time question a
session asks in a repo it has not seen. Answer `off` and code-diet says
nothing there. Where it does speak, the ladder comes back after a compaction
or a `/clear`, and it reaches subagents that write code but not the read-only
agent types (search, planning, and the host's own helpers), which have no use
for build rules.

The skills work in any repo, opted in or not.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install code-diet@agentic-engineering
```

## Skills

| Skill | Invocation | Does |
|---|---|---|
| `ladder` | model-invoked | The build discipline: understand the flow, climb the seven rungs, mark debt, leave one runnable check, output code first. |
| `reuse-first` | model-invoked, or `/code-diet:reuse-first <thing>` | Searches this repo and your listed checkouts for something that already covers the thing; verdict adopt, adapt, or build. |
| `review-diet` | `/code-diet:review-diet [repo] [--base <ref>] [--apply]` | Over-engineering review: the script locates, the model judges, one line per finding; `--apply` lands each cut as its own commit behind validate-or-revert. |
| `debt` | `/code-diet:debt [--write <file>]` | The debt-marker ledger: which deferrals still hold, which triggers have tripped, which markers have none. |
| `capture-reusable` | model-invoked at wrap-up | Finds what this work built that another project would want and records it in `.agents/reuse-opportunities.md`. |

## Pointing it at your other code

`reuse-first` searches the repo you are in. To have it search other checkouts
too (a shared component library, a sibling service), list them once in git
config; the key takes as many paths as you add:

```bash
git config --global --add code-diet.reuse ~/src/shared-ui
```

Use `--local` to keep a path to one clone. A listed directory that is not on
this machine is reported as not searched, never silently skipped. Nothing
leaves the machine: the index reads files and git config.

## `--apply`, exactly

`review-diet --apply` starts from a clean tree: `review-scan.mjs --apply begin`
refuses while tracked files carry uncommitted changes, because a cut landed
over them would carry them into its commit. Commit or stash first; the
findings stand. Then, per cut: the edit, `--apply check` with the repo's own
checks (only the ones that were green before any cut), one commit on green,
one repair attempt and `--apply revert` on red. The script never resets,
cleans, stashes, commits, or pushes, and it refuses to touch a file that is
not in HEAD, so your untracked files are safe by construction. A cut that
landed with no check to run is reported as `applied, not validated`, not as
green.

## Provenance

The discipline is evolved from the MIT-licensed
[ponytail plugin](https://github.com/DietrichGebert/ponytail). What was
inherited and what changed is recorded in
`skills/ladder/references/provenance.md`. Borrowed stays labeled as borrowed.
