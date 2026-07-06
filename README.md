# Agentic Engineering

A personal marketplace of Claude Code plugins, each built to solve a
foundational problem of engineering with agents: planning before code,
memory that outlives a session, teams that can't break main, workflows you
can see, and ideas that actually land.

> The premise: agents didn't make the fundamentals optional — they made
> them enforceable. New world, old lesson: the fundamentals still win.

## Install

Add the marketplace once:

```text
/plugin marketplace add NCMcClure/agentic-engineering
```

Then install whichever plugins you want:

```text
/plugin install but-first-planning@agentic-engineering
```

Skills arrive namespaced — `/but-first-planning:plan-0-init`,
`/agentic-teamwork:teamwork-init`, and so on.

## The plugins

### but-first-planning

Code written before the spec is settled is a loan against your future self.
A numbered planning pipeline (spec → grill → architect → plan → publish)
plus a build loop of coordinated TDD agents, all landing in one `.plan/`
directory — with an autopilot that runs the whole graph hands-off.
[Read more →](plugins/but-first-planning/README.md)

### agentic-teamwork

Mixed-skill teams shouldn't rely on discipline to keep prototypes off main.
Deterministic guardrails — commits to protected branches, force-pushes,
secrets, junk files, and failing tests are blocked by hooks in Claude Code,
mirrored in the terminal, and backstopped in CI. GitHub and GitLab,
first-class. [Read more →](plugins/agentic-teamwork/README.md)

### codebase-optimizer

A staged, autonomous optimizer for Python repos: organize the file tree,
decompose god-files, deepen shallow architecture — every change behind
CI-faithful validation with revert-on-red, nothing ever pushed.
[Read more →](plugins/codebase-optimizer/README.md)

### workflow-studio

Claude Code dynamic workflows are programs; you should be able to see them.
An Unreal-Blueprint-style node canvas that compiles graphs to runnable
`.claude/workflows/*.js` and round-trips them back — plus a skill for
hand-authoring without the GUI. [Read more →](plugins/workflow-studio/README.md)

### animated-storytelling

Most ideas don't fail because they're wrong — they fail because they're
presented in bullet points. Craft knowledge at the intersection of
narrative arc, visual design, and motion: what order things land in, what
the eye believes, what change feels like.
[Read more →](plugins/animated-storytelling/README.md)

### strata

A file-based agent harness that wraps Claude Code with persistent project
memory and a knowledge-capture pipeline — what the agent learns today, it
still knows next month. Lives in [its own repo](https://github.com/NCMcClure/strata);
installs here resolve from that repo's CI-built `claude-code` branch.

## Working in this repo

The contribution contract — layout invariants, the versioning rule, how to
add or update a plugin — lives in [.claude/rules/dev-rules.md](.claude/rules/dev-rules.md).
`bash scripts/validate.sh` checks the enforceable parts; CI runs it on every
push. Agents maintaining this repo read the same rules you do.

## License

MIT — see [LICENSE](LICENSE). Strata carries its own license in its repo.
