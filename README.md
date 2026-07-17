# Agentic Engineering

A personal marketplace of Claude Code plugins. Each one solves a problem
I kept hitting while engineering with agents, from code getting written
before the spec was settled to drafts that ship in someone else's voice.

> The premise: agents didn't make the fundamentals optional.
> They made them enforceable.

## Install

Add the marketplace once:

```text
/plugin marketplace add NCMcClure/agentic-engineering
```

Then install whichever plugins you want:

```text
/plugin install but-first-planning@agentic-engineering
```

Skills arrive namespaced: `/but-first-planning:spec-0-init`,
`/agentic-teamwork:teamwork-init`, and so on.

## The plugins

### but-first-planning

Code written before the spec is settled is a loan against your future self.
A numbered planning pipeline (spec → grill → architect → plan → publish)
plus a build loop of coordinated TDD agents, all landing in one `.plan/`
directory, with an autopilot that runs the whole graph hands-off.
[Read more →](plugins/but-first-planning/README.md)

### agentic-teamwork

Mixed-skill teams shouldn't rely on discipline to keep prototypes off main.
Deterministic guardrails block commits to protected branches, force-pushes,
secrets, junk files, and failing tests. The hooks run inside Claude Code and
again in the terminal, with CI as the backstop for anything that slips
through. GitHub and GitLab are both first-class. [Read more →](plugins/agentic-teamwork/README.md)

### codebase-optimizer

A staged, autonomous optimizer for whatever language your repo speaks
(Python, JS/TS, Go, and Rust are detected out of the box). It organizes the
file tree into an AGENTS.md-hubbed progressive-disclosure layout (orientation
hubs an agent reads before descending), decomposes god-files, and deepens
shallow architecture, though every change sits behind CI-faithful validation
with revert-on-red and nothing is ever pushed.
[Read more →](plugins/codebase-optimizer/README.md)

### workflow-studio

Claude Code dynamic workflows are programs; you should be able to see them.
An Unreal-Blueprint-style node canvas that compiles graphs to runnable
`.claude/workflows/*.js` and round-trips them back, plus a skill for
hand-authoring without the GUI. [Read more →](plugins/workflow-studio/README.md)

### animated-storytelling

Most ideas don't fail because they're wrong; they fail because they're
presented in bullet points. Craft knowledge for the alternative: how
narrative arc, visual design, and motion combine so the audience follows
the idea instead of reading past it.
[Read more →](plugins/animated-storytelling/README.md)

### write-like-me

Everything an agent drafts for you ships in someone else's voice. A
calibrated, tightly line-budgeted profile of how *you* write auto-loads into
every session, skills audit text for AI tells by hunting clusters of
co-occurring patterns rather than lone buzzwords, and reflective hooks fold
your style feedback back into the profile.
Prose only: code and commit messages stay out of scope.
[Read more →](plugins/write-like-me/README.md)

### code-diet

Every line an agent writes gets paid for more than once: at generation, at
review, and in every future session that loads it as context. code-diet makes
the agent build at the lowest rung that works (a 7-rung ladder with hard
safety carve-outs, injected as a token-budgeted kernel), reviews diffs with
script-located candidates and cuts applied behind revert-on-red, and tracks
every deliberate shortcut as a `debt:` marker with an expiry trigger. Evolved
from the MIT-licensed ponytail plugin; borrowed stays labeled as borrowed.
[Read more →](plugins/code-diet/README.md)

### plugin-workbench

A plugin's true cost is invisible until it's installed, and authoring a good
one means guessing at standards nobody wrote down. This is both halves of
that problem on one rubric: create-plugin interviews you, scaffolds the
layout, and authors against the six evaluation dimensions; evaluate-plugin
scores any path or git URL into an HTML scorecard with an adopt/rework
verdict; improve-plugin applies the fixes ranked by how many points each one
buys back.
[Read more →](plugins/plugin-workbench/README.md)

## Working in this repo

The contribution contract (layout invariants, the versioning rule, how to
add or update a plugin) lives in [.claude/rules/dev-rules.md](.claude/rules/dev-rules.md).
`bash scripts/validate.sh` checks the enforceable parts; CI runs it on every
push. Agents maintaining this repo read the same rules you do.

## License

MIT; see [LICENSE](LICENSE).
