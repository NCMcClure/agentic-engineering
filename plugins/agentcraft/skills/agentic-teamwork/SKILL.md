---
name: agentic-teamwork
description: "Use for the team's git conventions: setting a repo up or auditing it, writing tests across the lanes, and taking finished work to an open pull or merge request and then to merged. Routes are its arguments, not skills: tdd (tests: red, green, refactor, across the repo's lanes); ship (commit, push, open the pull or merge request); land (merge a reviewed request once its checks are green); audit-project (check this repo against the conventions, repair drift); bootstrap (put a new repo on the conventions before code is written); init-project (scaffold a repo from a template, or upgrade one in place)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# agentic-teamwork

"Please don't push to main" is a wish, not a control. The failures are always the same: a commit lands on the default branch, a force push rewrites shared history, an API key ends up in a diff, a change merges on checks nobody ran. This area holds a repo to the team's git conventions whoever is typing. A repo opts in with one committed file, `.agents/manifest.json`. From then on session hooks judge each commit and push before it runs, a pre-commit hook and a CI gate apply the same rules outside a session, and the routes here do the work at either end: tests first, then an open pull or merge request, then merged.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **The marker is the source.** The lane commands, the protected branches, and the forge are read from `.agents/manifest.json`, never guessed. A repo without it is not on the conventions, and putting it on them is the person's to start.
- **Nothing leaves the machine unasked.** Never push without the person's yes, never force push, never pass `--no-verify`.
- **A lane that did not run is reported as not run.** Name the lane and its exact command; a test that could not run is never called passing.
- **A credential never reaches git.** One that did is rotated, not rewritten out of history.
- **A route that hands on to another names it through this area**, `/agentcraft:agentic-teamwork <route>`: a file to read next, never a skill to call.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `tdd`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `tdd` | tests: red, green, refactor, across the repo's lanes | Use when writing or changing tests, when a change needs a failing test first, when wiring a new repo's lanes, or when deciding what to mock and what to run for real. |  | agent |
| `ship` | commit, push, open the pull or merge request | Use when the user says ship it, open a PR, open an MR, or push this. | `[--stack] [--draft]` | agent |
| `land` | merge a reviewed request once its checks are green | Use when a reviewed pull request or merge request should land: its checks are waited on in the background and it is merged on green. | `<number> \| --branch <b>` | agent |
| `audit-project` | check this repo against the conventions, repair drift | Use when the guards or the CI gate seem off, after a plugin update, or when asked to audit or verify the setup. | `[--fix]` | agent |
| `bootstrap` | put a new repo on the conventions before code is written | Use when the session briefing says the repo is not on the team conventions yet, or when starting a project in an empty folder. |  | person |
| `init-project` | scaffold a repo from a template, or upgrade one in place | Use when starting a new repo, when the session briefing or audit-project says to run the upgrade, or to turn on the strict test gate with --strict. | `[--upgrade] [--name <n>] [--template library\|node-service] [--forge github\|gitlab\|none] [--strict] [--dry-run]` | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
