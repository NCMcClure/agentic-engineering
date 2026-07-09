# code-diet

Every line an agent writes gets paid for more than once: at generation, again
at review, and again in every future session that loads it as context. Agents
over-build by default, and the surplus compounds. code-diet prices tokens at
all four surfaces so the agent writes only what the task needs and deletes what
it didn't.

## How it works

**Generation time.** The `ladder` skill runs a 7-rung decision ladder (YAGNI →
reuse in the codebase → stdlib → native platform → installed dep → one line →
the minimum that works) before code gets written, with hard safety carve-outs
that never get climbed past: trust-boundary validation, data-loss error
handling, security, and accessibility stay in.

**Instruction carriage.** The plugin budgets its own always-on footprint. The
discipline's kernel is a marked block inside `ladder`'s SKILL.md, held under a
token cap that `${CLAUDE_PLUGIN_ROOT}/skills/ladder/scripts/ladder.py` enforces
mechanically. A fail-open hook (`hooks/kernel_inject.py`) injects that kernel
at SessionStart and SubagentStart, so every session and subagent carries the
reflex at kernel price while the full discipline loads only when the `ladder`
skill actually fires on a coding task.

**Review time.** `/code-diet:review` has `review.py` locate cut candidates
deterministically (diff math, single-caller wrappers, deps that duplicate the
stdlib, dead flags), the model judges only the flagged spots, and findings land
one line each with file:line, the cut, and the replacement. `--apply` lands
every confirmed cut as one commit behind a validate-or-revert loop and reports
"applied and green", never "possible".

**Every future session.** Deliberate shortcuts carry `debt: <ceiling>,
<trigger>` markers that `/code-diet:debt` inventories and re-judges, so
deferrals expire on their trigger instead of rotting unnoticed. An advisory
PostToolUse hook (`hooks/debt_nudge.py`) nudges, never blocks, when a freshly
written marker lacks its trigger; the grammar itself lives in one place,
`skills/debt/scripts/debt.py`, which both the hook and the skill reuse.

One discipline, no intensity modes.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install code-diet@agentic-engineering
```

## Skills

| Skill | Invocation | Does |
|---|---|---|
| `ladder` | model-invoked | The build discipline: climb the 7-rung ladder, mark debt, leave one runnable check, output code first. |
| `review` | `/code-diet:review [repo] [--apply]` | Over-engineering review: script locates, model judges, one line per finding; --apply commits each cut behind revert-on-red. |
| `debt` | `/code-diet:debt [--write <file>]` | Repo-wide debt-marker ledger: which deferrals still hold, which triggers have tripped, which markers lack one. |

## Provenance

The discipline content is evolved from the MIT-licensed
[ponytail plugin](https://github.com/DietrichGebert/ponytail). What was inherited
and what changed is recorded in
`${CLAUDE_PLUGIN_ROOT}/skills/ladder/references/provenance.md`. Borrowed stays
labeled as borrowed.

## Changelog

- **0.1.0**: initial release.
