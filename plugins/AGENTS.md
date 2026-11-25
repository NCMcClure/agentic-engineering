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
    own `README.md` and, under `history/<old-name>.md`, the changelog of
    each plugin it was made from, which takes no new line.
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

- `agents` - a kanban board the person and the agents share, a goal run from
  it as subagents or child sessions in their own worktrees, machine-wide
  locks and leases, and the `aw` CLI with every agent-works hook, lib, and
  reference behind it (harness's setup routes run on the same CLI). Descend
  to change a check, the card format, the board pane, or what a session is
  told.
- `delivery` - team git conventions: hooks that judge a commit, a
  push and a stop, a scaffold, and routes to ship, land and test. Descend to
  change a rule, the scaffold a repo gets, or how a change request is landed.
- `planning` - spec, plan, build, as files under `.agents/plan/` (the
  project's) and `.agents/plans/<name>/` (one feature's or task's).
  Descend to change a phase of that workflow or its status scripts.
- `code` - write only what the task needs, reuse before building,
  delete the rest behind validate-or-revert, and track debt; and reorganize a
  drifted repo in stages, each validated and reverted on red. Descend to
  change the ladder line, a scan, a stage, or the recon a stage reasons from.
- `docs` - user docs that move in the same change as the code, one checker
  for missing, stale and broken pages, and a README check (`references/`,
  `scripts/docs-check.mjs`, `scripts/readme-check.mjs`); a system map
  extracted from `@system` annotations and checked against the import graph,
  with the Miro board loop that draws it (`scripts/system-map.mjs`, the
  `miro` route's generators, lint, live check, pull); and animated figures:
  a kit of shapes copied into the repo (`kit/`, `blank/`), studies
  (`studies/`), a studio that renders drafts and stills (`app/`), and the
  `pt` CLI (`scripts/pt.mjs`). Descend to change the writer contract, a
  checker, what the map checks, how a board is built, the kit, or the studio.
- `design` - checks for work judged by eye or ear: reproducible shots,
  metrics, sheets, a blind critic, and a review queue for the person.
  Descend to change what a number means or how the gate decides.
- `harness` - what shapes what an agent knows and may do: make, score and
  fix plugins against one rubric (`core/`); read a session's transcript for
  what entered the agent's context, from which area, and what a compaction
  dropped (`scripts/`); a node-canvas editor for Claude Code workflows
  (`app/`, launched by `scripts/launch-studio.mjs`), plus a hand-authoring
  route; and a repo's agent-facing setup (hubs, memory, decisions, the
  guard, the doctor), whose routes run on the `aw` CLI in `agents/`.
  Descend to change a grade, a finding or threshold, the app, or a route.
- `writing` - a calibrated voice profile, AI-tell auditing, and hooks
  that learn from style feedback. Descend to change the profile or the hooks.
