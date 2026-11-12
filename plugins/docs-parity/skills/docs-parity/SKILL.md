---
name: docs-parity
description: >
  Keep user-facing documentation in the same change as the code it describes:
  pages, screenshots, and the nav move with the commit that changes a screen,
  label, flow, command, flag, config key, endpoint, permission, error message,
  or install/deploy step. Use whenever an edit touches something a user,
  integrator, or operator sees or depends on, when the user says "update the
  docs", "document this", "add a screenshot", "retake the screenshots", or
  "are the docs current", and when unsure which docs skill fits. Works
  for any stack and any docs target (a site, a docs/ folder, a wiki, a README).
---

# docs-parity

Docs that ship after the code ship wrong. The fix is not a better docs pass at the end; it is making the
docs part of the change, the same way a test is. The writer contract, the shot contract and the checker are
in the references below and in `${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs`.

The rule's short form is a critical line the session hook prints in every repo that carries
`.agents/docs-parity.json`: at session start, after a compaction or a `/clear`, and in every sub-agent that
acts. The long form is `references/rule.md`. This skill is for when the rule comes up: deciding whether a
change is user-visible, and opening the skill that does the work.

## Which skill

| The situation | Open |
|---|---|
| The project has no `.agents/docs-parity.json` yet | `/docs-parity:docs-init` |
| You changed (or are about to change) a user-visible surface | `docs-sync` |
| A page needs a screenshot, a shot is stale, or there is no capture harness | `docs-shots` |
| "Are the docs current?", before a release, or after a long stretch without docs work | `docs-audit` |
| A README is being written, is over 800 words, or fails `readme-check.mjs` | `readme` |
| The checker printed a finding you do not recognise | `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/config.md` |

## What counts as user-visible

A change needs docs when a reader of any root (`audiences.md`) would notice it: a new or renamed screen,
button, label, menu, field or message; a flow that takes different steps; a command, flag, option, default or
exit code; a config key, environment variable or file format an operator sets; an endpoint, payload, status
code or event an integrator calls; a permission or role rule; an install, upgrade or deploy step; a limit or a
price. It does not need docs when nothing a reader can observe moved: a refactor, a test, a performance change
with no visible effect, an internal rename. Say which in the `Docs:` line either way.

## Without the config

In a repo with no `.agents/docs-parity.json` the plugin's hooks are silent. The rule still holds if the
project's `AGENTS.md` states it: follow the references by hand and skip the checker. Do not create the config
unasked; `docs-init` is the user's call.

## The references

- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/rule.md`: the rule in full.
- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/audiences.md`: the roots, what each may and may not contain.
- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/page-shape.md`: frontmatter, the opening summary, budgets, nav order, voice.
- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/targets.md`: sites, `docs/` folders, GitHub and GitLab wikis, README-only, and the CI job.
- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/shot-contract.md`: what every screenshot must satisfy, in any language.
- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/capture-recipes.md`: a harness per stack, web to Unreal.
- `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/config.md`: `.agents/docs-parity.json` and every finding code.
