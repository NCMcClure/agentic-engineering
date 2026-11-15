---
name: docs-parity
description: "Routes are its arguments, not skills: docs-audit (); docs-init (); docs-shots (); docs-sync (); readme ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# docs-parity

Docs that ship after the code ship wrong. The fix is not a better docs pass at the end; it is making the
docs part of the change, the same way a test is. The writer contract, the shot contract and the checker are
in the references below and in `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/scripts/docs-check.mjs`.

The rule's short form is a critical line the session hook prints in every repo that carries
`.agents/docs-parity.json`: at session start, after a compaction or a `/clear`, and in every sub-agent that
acts. The long form is `references/rule.md`. This skill is for when the rule comes up: deciding whether a
change is user-visible, and opening the skill that does the work.

## Which skill

| The situation | Open |
|---|---|
| The project has no `.agents/docs-parity.json` yet | `/agentcraft:docs-parity docs-init` |
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

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `docs-audit` |  | Use before a release, after a large change to a user-visible surface, or when the user asks whether the docs are current; to fix what it finds use docs-sync. | `[root or page glob to limit the audit]` | agent |
| `docs-init` |  | Use when a repo with user docs should get the docs rule in every session, the Stop check, and the checker in CI. | `[target: site \| docs-folder \| wiki \| readme] [audiences]` | person |
| `docs-shots` |  | Use when a page needs a new screenshot, a shot is stale or flaky, a project has no capture harness yet, or the user asks to "add a screenshot", "retake the screenshots", or "set up screenshot capture" for a web app, desktop app, CLI, game engine (Unreal), notebook, or mobile app. |  | agent |
| `docs-sync` |  | Use after (or while) changing a user-visible surface, when the Stop hook or CI reports PARITY_MISSING or SHOT_STALE, or when the user says "update the docs for this", "sync the docs", or "retake the screenshots". |  | agent |
| `readme` |  | Use when readme-check.mjs, the Stop hook, or CI reports a readme-* finding or warning, when a README is over the limit, and when writing or reviewing a README. |  | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
