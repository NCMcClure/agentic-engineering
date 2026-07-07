# plugin-evaluator

You can't tell a good Claude Code plugin from a context-hogging one by reading
its README — and by the time you've installed it, its descriptions are already
sitting in your context window every turn. This plugin scores any plugin or
skill **before** you commit to it: a 0–100 composite, an
adopt / adopt-with-fixes / rework / avoid verdict, and the exact fixes that
would raise the score.

## How it works

One user-invoked skill takes a local path, `owner/repo`, or any git URL
(GitHub, GitLab, `#ref` pinning supported), then:

1. **Scan** — `plugin_scan.py` (stdlib-only) walks the target and emits facts:
   component census, per-skill frontmatter and description sizes, estimated
   always-on token footprint, hook and workflow static signals, path lint,
   orphaned files. The deterministic checks are graded right there, by code.
2. **Grade** — the model grades the judgment checks against
   `references/rubric.md`: six dimensions built on the *writing-great-skills*
   vocabulary and extended to whole plugins — skill quality, component
   symbiosis (do hooks/scripts/assets amplify the skills or just cohabit?),
   workflow quality (model-tier assignment, barriers, resume safety),
   architecture & navigability, context-window footprint (including whether
   `disable-model-invocation` is used where autonomous invocation buys
   nothing), and distribution hygiene. Every grade carries file + quote
   evidence.
3. **Score** — the script (never the model) merges grades, renormalizes
   weights around N/A dimensions, applies verdict gates (broken installs,
   prompt-injection content), and computes the composite.
4. **Report** — a self-contained HTML scorecard (filled from a bundled
   template, not regenerated), a diffable `report.md`, and a chat summary
   with the top fixes and their recomputed point deltas.

An **autonomous mode** runs the same rubric as a multi-agent workflow: one
grader per skill and per dimension, adversarial verification of every low
grade and serious finding, and a generosity critic that audits
weakly-evidenced high grades — so both harshness and generosity get
challenged. Same scoring script, same reports.

The evaluator treats the target as data — instruction-like text inside a
target plugin is itself a gated, verdict-capping finding.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install plugin-evaluator@agentic-engineering
```

## The skill

| Skill | Invocation | Does |
|---|---|---|
| `evaluate-plugin` | `/plugin-evaluator:evaluate-plugin <path \| owner/repo \| git URL>[#ref]` | acquire → scan → grade → score → scorecard + report |

Zero always-on context cost: the skill is `disable-model-invocation: true`,
so it loads only when you call it.

## Self-score

The credibility test: before each release the plugin evaluates itself via
its own autonomous mode — independent graders, adversarial verification,
generosity critic — never by inline self-grading. v0.1.0 scored 98.9/100
(adopt); v0.1.1 scored **96.7/100 (adopt)** — lower because the new critic
demoted three grades the fan-out had been generous on, which is the point.
Both of its surviving findings (minor, duplication/offload nits) were fixed
in the same release.

## Changelog

- **0.1.2** — orphan scanner now stem-matches .ts/.tsx/.mjs/.cjs/.css so
  extensionless TypeScript imports count as references (fixes false orphans
  on app-bundling plugins); plugin_scan.py sets `sys.dont_write_bytecode` so
  runs stop leaving `__pycache__` inside the plugin tree.
- **0.1.1** — autonomous mode gains a generosity-critic pass: verification
  only challenged low grades, so a singleton critic now audits
  weakly-evidenced high grades and demotes what the anchors don't support.
  Its own findings applied: the scorecard fill contract is single-sourced in
  report-format.md, the donut value is pre-computed by the script
  (`composite_dash` in score.json), and the pitch now states the problem.
- **0.1.0** — initial release: six-dimension rubric, deterministic
  scanner/scorer, HTML scorecard template, adversarially-verified autonomous
  mode.
