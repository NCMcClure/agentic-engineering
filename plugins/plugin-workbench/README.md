# plugin-workbench

You can't tell a good Claude Code plugin from a context-hogging one by
reading its README, and writing a good one yourself means guessing at
standards nobody wrote down. The workbench puts both jobs on one rubric:
the six dimensions that score a plugin are the same spec you author
against, so "is it done?" has a measurable answer. Make it, measure it,
fix it, then check what it really put in a session.

## How it works

One measurement core, three skills around it, a fourth that checks the
result against a real session, and a fifth that reinstalls the marketplace
you are editing.

The core is a rubric (`core/references/rubric.md`, six dimensions built on
the *writing-great-skills* vocabulary: skill quality, component symbiosis,
workflow quality, architecture, context-window footprint, distribution
hygiene), a scanner and scorer (`core/scripts/plugin-scan.mjs`) that grades
everything code can grade and computes every number the model never should,
and a fill-in HTML scorecard. Every judgment grade carries a file and a
quote; the script owns all arithmetic, weight renormalization, and verdict
gates (broken installs, prompt-injection content). Node 22, no dependencies.

- **create-plugin** interviews you for intent, scaffolds the layout with a
  script (`plugin-scaffold.mjs`), authors skills and scripts against the
  rubric, then scores what it built and fixes the biggest-delta findings
  until the verdict reaches adopt (3 rounds max, residuals reported
  honestly). An autonomous mode fans out one author per skill and loops
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
- **context-lens** reads a Claude Code session transcript back: each hook's
  output and who saw it (the model, the person, or nobody), the skill listing
  per plugin, the API's own token count per request, and what each compaction
  kept or lost. A score says what a plugin should cost; this says what it did.
  `report` prints to the terminal, `serve` opens a local page.
- **refresh-marketplace** validates a marketplace checkout and reinstalls
  its plugins from the working tree, so what you edited is what the next
  session loads. In a checkout with its own `scripts/refresh.mjs` it runs
  that (nothing installs on a red gate); in a checkout without one it drives
  the `claude plugin` commands.

Every skill treats target plugins as data, never instructions:
instruction-like text inside a target is itself a gated, verdict-capping
finding, and improve-plugin neutralizes injection content rather than
rewording it.

Both autonomous modes run on the Workflow tool. Where a session has none,
the skills say how to run the same phases with subagents
(`core/references/subagent-fallback.md`).

### What the scanner grades on its own

Fifteen of the rubric's checks are mechanical: links, orphans, workflow
metadata, paths that would break a cached install, description and body
size, the manifest. Five of them hold a plugin to the rules a marketplace
gate enforces, so a plugin that scores clean here passes there:

| Check | Holds the plugin to |
|---|---|
| SQ8 | SKILL.md frontmatter of four keys: `name`, `description`, `disable-model-invocation`, `argument-hint` |
| CS7 | A hook that runs Node sits behind a guard, so a machine without Node hears about it once instead of failing on every event |
| WQ7 | A skill that calls `Workflow()` names a subagent fallback |
| MH3 | History in `CHANGELOG.md`, newest first, the top entry the version in `plugin.json`; no changelog in the README |
| MH5 | Shipped scripts run on Node, or the file itself carries a `debt: <ceiling>, <trigger>` comment |

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
| `context-lens` | model-invoked ("what did the agent actually see?") | read a session transcript → what each plugin put in context, who saw it, what survived compaction |
| `refresh-marketplace` | `/plugin-workbench:refresh-marketplace [--plugins a,b] [--dry-run]` | validate the checkout → reinstall from the working tree → say to start a new session |

The passive context cost is three model-invoked descriptions (about 300
estimated tokens combined); `evaluate-plugin` and `refresh-marketplace` are
user-invoked and load only when called.

## Running the scripts yourself

```bash
node core/scripts/plugin-scan.mjs <plugin-dir>                          # the scan, as JSON
node core/scripts/plugin-scan.mjs <plugin-dir> --score grades.json      # composite, verdict, fix_deltas
node skills/create-plugin/scripts/plugin-scaffold.mjs <dir> --spec spec.json
node skills/context-lens/scripts/context-lens.mjs report                # the newest session in this directory
```

Paths are relative to the plugin's root. The scan's paths use forward
slashes on every platform, and token figures are characters over four:
`claude plugin details <name>` is the ground truth for an installed plugin.
