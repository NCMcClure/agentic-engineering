# plugins: what the agents load

One self-contained directory per plugin. A plugin never references a file
outside its own directory: installs are cached copies, so `../` paths break.

Each carries `.claude-plugin/plugin.json`, `README.md`, `CHANGELOG.md` (newest
first, its top entry the `plugin.json` version), and `skills/<skill>/SKILL.md`.
A plugin installs as `<name>@agentic-engineering`.

## Layout

- `agent-works/` - one home per kind of agent-facing fact under `.agents/`, a
  kanban board shared with the agents, guards, and machine-wide locks and
  leases through the `aw` CLI. Descend to change a check, the card format, the
  board pane, or what a session is told.
- `agentic-teamwork/` - version-control guardrails as hooks: protected
  branches, force-pushes, secrets, failing tests. Descend to change what a
  commit, a push, or a stop is held to.
- `animated-storytelling/` - narrative arc, visual design and motion recipes
  for explaining an idea. Descend to change a reference or a recipe.
- `but-first-planning/` - spec, plan, build, as files under `.agents/plan/`.
  Descend to change a phase of that workflow or its status scripts.
- `code-diet/` - write only what the task needs, delete the rest behind
  revert-on-red, and track debt. Descend to change the ladder or a scan.
- `codebase-optimizer/` - reorganize a drifted repo in stages, each validated
  and reverted on red. Descend to change a stage or the recon it reasons from.
- `docs-parity/` - user docs that move in the same change as the code, and one
  checker for missing, stale and broken pages. Descend to change the writer
  contract, the capture harness, or the checker.
- `perceptual-loop/` - checks for work judged by eye or ear: reproducible
  shots, metrics, sheets, a blind critic, and a review queue for the person.
  Descend to change what a number means or how the gate decides.
- `plugin-workbench/` - make, score and fix plugins against one rubric, and
  read what a session's context was made of. Descend to change what a grade
  means or what the lens reports.
- `workflow-studio/` - a node-canvas editor for Claude Code workflows, plus a
  hand-authoring skill. Descend to change the app (`app/`) or the skill.
- `write-like-me/` - a calibrated voice profile, AI-tell auditing, and hooks
  that learn from style feedback. Descend to change the profile or the hooks.
