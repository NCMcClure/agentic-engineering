# Agentic Engineering

A personal marketplace of Claude Code plugins, each built to solve a
foundational problem of engineering with agents: planning before code,
teams that can't break main, workflows you can see, and ideas that
actually land.

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

A staged, autonomous optimizer for whatever language your repo speaks —
Python, JS/TS, Go, and Rust detected out of the box. Organize the file tree,
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

### write-like-me

Everything an agent drafts for you ships in someone else's voice. A
calibrated ≤60-line profile of how *you* write auto-loads into every
session, skills audit text against a research-backed catalog of AI tells,
and reflective hooks fold your style feedback back into the profile —
prose only; code and commit messages stay out of scope.
[Read more →](plugins/write-like-me/README.md)

### plugin-evaluator

A plugin's true cost — context burned every turn, mechanical work dumped on
the model, workflows with judgment on the cheapest tier — is invisible until
it's installed. Point this at any path or git URL and get a scored verdict:
a deterministic scanner grades what code can grade, the model grades the
rest against an evidence-backed rubric, and it all lands in an HTML
scorecard with the fixes that would raise the score.
[Read more →](plugins/plugin-evaluator/README.md)

## Working in this repo

The contribution contract — layout invariants, the versioning rule, how to
add or update a plugin — lives in [.claude/rules/dev-rules.md](.claude/rules/dev-rules.md).
`bash scripts/validate.sh` checks the enforceable parts; CI runs it on every
push. Agents maintaining this repo read the same rules you do.

## License

MIT — see [LICENSE](LICENSE).
