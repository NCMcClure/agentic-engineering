---
name: create-plugin
description: Author a new plugin end to end: interview for intent, scaffold the layout with a script, write the skills against the evaluation rubric, then score and fix until the verdict is adopt. Use when someone wants to make a plugin, turn existing skills or scripts into one, or asks what a good plugin needs.
argument-hint: "<plugin idea | existing dir to wrap> [--dir <parent>] [--bar <composite>]"
---

# create-plugin

Author one new plugin, then prove it: the same rubric that scores plugins is
the spec you write against, and the same scanner that grades them is the
referee that says you're done. Core dir below means
`${CLAUDE_PLUGIN_ROOT}/core`; this skill's dir means
`${CLAUDE_PLUGIN_ROOT}/skills/create-plugin`.

**Safety rule:** never scaffold into a directory that already contains a
plugin unless the user explicitly confirms overwriting; the scaffolder
refuses authored files without `--force`, and you don't pass `--force`
without that confirmation.

## Step 1: Interview

Collect the spec, in one round of questions where possible:

1. **The problem, in one sentence.** This becomes the plugin's pitch. If it
   can't be said in a sentence, the plugin isn't scoped yet.
2. **The distinct jobs** the user wants done → the skill list. One skill per
   genuinely distinct job; every extra skill is context the user pays for.
3. **Per skill: who fires it?** Model-invoked (the model should reach it from
   natural conversation, so the description must say *when*) or user-invoked
   (`disable-model-invocation: true`: a hand-run entry point with zero
   passive cost).
4. **Components:** map what the user described onto scripts, assets,
   hooks, and workflows with `references/authoring-notes.md`'s
   interview-to-design table. Read it rather than re-deriving the mapping.
5. **Distribution target:** personal use, the user's own marketplace, or a
   marketplace repo they name. This decides Step 5's branch.

Wrapping an existing directory: read it first, then propose the mapping
(which files become which skills/scripts) instead of asking abstract
questions about content that already exists.

Write the confirmed spec as `spec.json` per the shape documented at the top
of `scripts/plugin-scaffold.mjs`.

*Done when: the user has confirmed a spec: name, pitch, author, skills with
invocation modes, components, target directory.*

## Step 2: Scaffold

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/create-plugin/scripts/plugin-scaffold.mjs" <target-dir> --spec <spec.json>
```

The script validates the spec (name == dir basename, semver, slug rules),
fills the bundled stubs, refuses to overwrite authored files, and prints the
created tree as JSON. What it writes already meets a marketplace's
structural gate: a manifest, a README with no changelog in it, a
`CHANGELOG.md` whose top entry is the manifest version, SKILL.md frontmatter
of four keys at most, and a Node script stub. Don't hand-write boilerplate
the scaffolder emits.

*Done when: the script exits 0 and every skill has its SKILL.md stub.*

## Step 3: Author

The rubric is the spec. Before writing each SKILL.md, read the core rubric's
SQ, CS, and CF sections in full (`core/references/rubric.md`); before
writing any workflow, its WQ section; before adding a hook, CS7.
`references/authoring-notes.md` covers only what the rubric doesn't: the
interview-to-design mapping, stub conventions, and the authoring order.
Follow its order, and replace every `TODO(author)` marker; the scaffolder
treats a file without markers as authored and protects it.

*Done when: no `TODO(author)` marker remains in the target tree.*

## Step 4: Self-eval loop

Score what you built, with the same tools the evaluate-plugin skill uses:

1. `node "${CLAUDE_PLUGIN_ROOT}/core/scripts/plugin-scan.mjs" <target-dir> > scan.json`
2. Grade every applicable judgment check per the grading contract at the end
   of `core/references/rubric.md`, evidence quotes and all.
3. `plugin-scan.mjs <target-dir> --score grades.json > score.json`. The
   script owns the arithmetic.
4. Below the bar? score.json's `fix_deltas` ranks every improvable check by
   the composite gain of fixing it. Apply the biggest, re-scan, re-grade
   only touched checks, re-score.

**Bar: verdict `adopt`, zero gates, zero critical findings**, or the
`--bar` composite the user set. Spend at most 3 fix rounds, then report the
residual findings honestly instead of grinding.

*Done when: the bar is met, or 3 rounds are spent and residuals are listed
in chat.*

## Step 5: Ship (by distribution target)

- **Personal use:** run `claude plugin validate <target-dir>`, then give the
  user the two local-install commands (`/plugin marketplace add <dir-parent>`
  works with local paths).
- **A marketplace repo:** add the catalog entry (name, source, one-sentence
  pitch, category, and **no version field**: the plugin.json version is the
  only version), a root-README section if the repo has one, then run that
  repo's validation before handing off. Later releases bump `plugin.json`
  and add one line on top of the plugin's `CHANGELOG.md`.

*Done when: validation passes for the chosen target and the user knows how
to install.*

## Autonomous mode

For multi-skill plugins where inline authoring would grind, run the bundled
workflow after Step 1. The interview stays with you; the workflow takes the
confirmed spec.

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/create-plugin/workflows/create.js",
  args: {
    spec: <the confirmed spec object from Step 1>,
    targetDir: "<absolute plugin dir to create>",
    coreDir: "${CLAUDE_PLUGIN_ROOT}/core",
    createSkillDir: "${CLAUDE_PLUGIN_ROOT}/skills/create-plugin",
    outDir: "<absolute dir for scan/grades/score artifacts>",
    dateToday: "<YYYY-MM-DD, run date +%F yourself>",
    bar: 85,
    context: "<optional notes for the authors>"
  }
})
```

It blueprints per-skill briefs, scaffolds deterministically, fans out one
author per skill, then loops scan → rubric reviewers → score → targeted
fixers until the bar or round limit. Its internal grades steer fixes only.
For a scorecard worth publishing, follow with the evaluate-plugin skill's
autonomous mode: an independent audit, not the author grading itself.

**Where there is no Workflow tool:** run the same phases with parallel
subagents instead. The contract is in
[../../core/references/subagent-fallback.md](../../core/references/subagent-fallback.md):
phases stay sequential barriers, fan out only where the workflow calls
`parallel()`, the parent owns every shared file, and the score still comes
from `plugin-scan.mjs --score` rather than from prose.
