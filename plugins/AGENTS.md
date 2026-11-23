# plugins: what the agents load

One plugin ships everything: `agentic-engineering`, installed as
`agentic-engineering@agentic-engineering`. It is the only directory here: what is new
goes in as one of its areas.

A plugin never references a file outside its own directory: installs are
cached copies, so `../` paths out of it break.

## Layout

- `agentic-engineering/` - the plugin. `.claude-plugin/plugin.json` carries the one
  version, and `CHANGELOG.md` has it as its top entry.
  - `skills/start-here/` - the entry skill, the only one a person types. It
    asks what they want, explains the area, and hands off to a route. Its
    areas section is generated from `start-here.json`. Descend to change what
    a person is asked or where a use hands off.
  - `skills/<area>/` - an area: a skill an agent calls with a route as the
    first word of its arguments. `door.json` says which routes it has and the
    cue for each; `SKILL.md`'s frontmatter and `## Route` table are generated
    from it. `routes/<route>/ROUTE.md` is a route, a document the area reads
    by path. The area's scripts, hooks, and assets sit beside them, with its
    own `README.md` and the `CHANGELOG.md` it had as a plugin, which takes no
    new line.
  - `hooks/` - the one hook map (`hooks.json`), the session helper that
    prints every area's critical lines (`critical-context.mjs`,
    `session-start.mjs`), and the briefing. An area's own guards and checks
    stay in `skills/<area>/hooks/` and are registered here.
  - `lib/` - the one copy of what several areas use: `provider.mjs` (GitHub
    and GitLab through `gh` and `glab`), `shell-words.mjs` (the command lexer
    the guards read a Bash call with), `verify-hubs.mjs`, `data-home.mjs`
    (an area's folder in the plugin's data directory).
  - `agents/`, `.mcp.json`, `bin/` - the subagents, the MCP server, and the
    `aw` launcher, each the plugin's own and named with no area.

## The areas

Each is `agentic-engineering/skills/<name>/`.

- `agent-works` - one home per kind of agent-facing fact under `.agents/`, a
  kanban board that runs a goal as child sessions, a guard, and machine-wide
  locks and leases through the `aw` CLI. Descend to change a check, the card
  format, the board pane, or what a session is told.
- `agentic-teamwork` - team git conventions: hooks that judge a commit, a
  push and a stop, a scaffold, and routes to ship, land and test. Descend to
  change a rule, the scaffold a repo gets, or how a change request is landed.
- `but-first-planning` - spec, plan, build, as files under `.agents/plan/` (the
  project's) and `.agents/plans/<name>/` (one feature's or task's).
  Descend to change a phase of that workflow or its status scripts.
- `code-diet` - write only what the task needs, reuse before building,
  delete the rest behind validate-or-revert, and track debt. Descend to change
  the ladder line or a scan.
- `codebase-optimizer` - reorganize a drifted repo in stages, each validated
  and reverted on red. Descend to change a stage or the recon it reasons from.
- `context-doctor` - read a session's transcript for what entered the agent's
  context, from which area, and what a compaction dropped, and raise what went
  wrong as findings with fixes. Descend to change what the lens reports, a
  finding, or a threshold.
- `docs-parity` - user docs that move in the same change as the code, one
  checker for missing, stale and broken pages, and a README check. Descend to
  change the writer contract, the capture harness, or a checker.
- `perceptual-loop` - checks for work judged by eye or ear: reproducible
  shots, metrics, sheets, a blind critic, and a review queue for the person.
  Descend to change what a number means or how the gate decides.
- `picture-this` - a description or a codebase feature drawn as an animated
  figure designed from the subject: a kit of shapes copied into the repo,
  studies to learn from, a studio that renders drafts and stills, and the
  `pt` CLI. Descend to change the kit, the studio, a study, the lens method,
  or the house style.
- `plugin-workbench` - make, score and fix plugins against one rubric, in
  either shape. Descend to change what a grade means, a shape's rules, or
  what the scaffolder writes.
- `system-map` - a system map extracted from `@system` annotations, committed
  as a file and checked against the import graph, with a whole-repo sweep; and
  the Miro board loop that draws it (generators, lint, live check, pull).
  Descend to change what the map checks or how a board is built.
- `workflow-studio` - a node-canvas editor for Claude Code workflows, plus a
  hand-authoring route. Descend to change the app (`app/`) or the route.
- `write-like-me` - a calibrated voice profile, AI-tell auditing, and hooks
  that learn from style feedback. Descend to change the profile or the hooks.
