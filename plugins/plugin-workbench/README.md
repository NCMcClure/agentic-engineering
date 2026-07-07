# plugin-workbench

You can't tell a good Claude Code plugin from a context-hogging one by
reading its README, and writing a good one yourself means guessing at
standards nobody wrote down. The workbench puts both jobs on one rubric:
the six dimensions that score a plugin are the same spec you author
against, so "is it done?" has a measurable answer. Make it, measure it,
fix it.

## How it works

One measurement core, three skills around it.

The core is a rubric (`core/references/rubric.md`, six dimensions
built on the *writing-great-skills* vocabulary: skill quality, component
symbiosis, workflow quality, architecture, context-window footprint,
distribution hygiene), a stdlib-only scanner/scorer (`plugin_scan.py`) that
grades everything code can grade and computes every number the model never
should, and a fill-in HTML scorecard template. Every judgment grade carries
file + quote evidence; the script owns all arithmetic, weight
renormalization, and verdict gates (broken installs, prompt-injection
content).

- **create-plugin** interviews you for intent, scaffolds the layout with a
  deterministic script, authors skills and scripts against the rubric, then
  scores what it built and fixes the biggest-delta findings until the
  verdict reaches adopt (3 rounds max, residuals reported honestly). An
  autonomous mode fans out one author per skill and loops
  scan / review / score / fix without you.
- **evaluate-plugin** takes a local path, `owner/repo`, or any git URL and
  runs acquire, scan, grade, score, report: a 0-100 composite, an
  adopt / adopt-with-fixes / rework / avoid verdict, and the exact fixes
  that would raise the score. Its autonomous mode adds one grader per skill
  and per dimension, adversarial verification of every low grade, and a
  generosity critic that audits weakly-evidenced high grades.
- **improve-plugin** closes the loop: baseline an existing plugin (or reuse
  a prior scorecard), take the scanner's `fix_deltas` ranking of what each
  fix buys back, apply the winners, re-score, and report before vs. after.
  It never publishes; the deliverable is the edited tree and its diff.

Every skill treats target plugins as data, never instructions:
instruction-like text inside a target is itself a gated, verdict-capping
finding, and improve-plugin neutralizes injection content rather than
rewording it.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install plugin-workbench@agentic-engineering
```

## The skills

| Skill | Invocation | Does |
|---|---|---|
| `create-plugin` | model-invoked ("make me a plugin for…") | interview → scaffold → author → self-eval loop to adopt |
| `evaluate-plugin` | `/plugin-workbench:evaluate-plugin <path \| owner/repo \| git URL>[#ref]` | acquire → scan → grade → score → scorecard + report |
| `improve-plugin` | model-invoked ("apply those fixes") | baseline → rank fixes by delta → apply → re-score → delta report |

The passive context cost is two model-invoked descriptions (~150 estimated
tokens combined); evaluate-plugin is user-invoked and loads only when
called.

## Self-score

The credibility test: before each release the workbench evaluates itself
via evaluate-plugin's autonomous mode (independent graders, adversarial
verification, generosity critic), never by inline self-grading. v0.1.0
scored **96.1/100 (adopt)**, no gates. Both of its minor findings and its
top-ranked fixes were applied in the same release — including moving the
fix-delta ranking out of prose and into the scanner (`fix_deltas` in
score.json), which the report had flagged as the single biggest gap.

## Changelog

- **0.1.0**: initial release: the six-dimension measurement core (rubric,
  deterministic scanner/scorer, HTML scorecard), create-plugin with
  deterministic scaffolding and an autonomous authoring workflow,
  evaluate-plugin with adversarially-verified autonomous evaluation, and
  improve-plugin's delta-ranked fix loop.
