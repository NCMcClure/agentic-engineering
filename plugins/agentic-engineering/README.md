# agentic-engineering

Ten fixes for problems that keep turning up when engineering with agents, behind one skill a person types.

Engineering with agents keeps hitting the same problems: code written before
the spec was settled, a round of parallel work that dies with its
conversation, docs that ship after the code, a picture nobody looked at. Each
has a fix here. As twelve separate plugins those fixes listed about eighty
skills, and a job does not say which one it needs. This is the twelve as one
plugin: a person remembers one thing, and an agent sees eleven names.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install agentic-engineering@agentic-engineering
```

The areas were plugins of their own once, and the catalog no longer lists
those. If one is still installed, install `agentic-engineering` by name, then remove
the old one with `/plugin uninstall <old-name>@agentic-engineering`.

Version 1.x was named `agentcraft`. Install this one and open a session before
`/plugin uninstall agentcraft@agentic-engineering`, which deletes the data each
area copies on its first run. `userConfig` values do not carry over.

## Usage

Type `/agentic-engineering:start-here`, or ask for the work in plain words. Given a
task after its name (`/agentic-engineering:start-here ship this change`), it asks
nothing and hands the task to the area and route that fit.

## How it works

- **One skill a person types.** `start-here` asks which areas they want,
  explains each one they chose, asks how they want to use it, and hands off.
  Given a task after its name (`/agentic-engineering:start-here ship this change`), or
  run where nobody can answer, it asks nothing and hands the task to the area
  and route that fit. It is the only entry in the slash menu.
- **Ten areas an agent calls.** An area is a skill named for a body of
  work. An agent calls it with a route as the first word of its arguments, or
  with the task alone, and the area picks. A person does not type an area:
  they ask for the work in words, or go through `start-here`.
- **Routes read as documents.** What used to be a skill is a `ROUTE.md` under
  its area. It is never listed and costs nothing until its area reads it, so
  the listing holds eleven names where it held about eighty. An area's
  table of routes is generated from its `door.json` and each route's own
  frontmatter, so a route in the table is one that is there.
- **Hooks that speak once.** One session hook prints each area's critical
  lines, and only in a repo that has opted in; the guards and checks an area
  ships run from that same plugin.

## The areas

Each area keeps its own README under `skills/<area>/`, with what it is for and
how its routes work.

| Area | Use it to |
|---|---|
| [agent-works](skills/agent-works/README.md) | run several tasks at once from a kanban board, and keep a repo's agent-facing facts in one home each |
| [code](skills/code/README.md) | keep new code at the simplest rung that holds, cut what is not needed, and restructure a codebase that has grown messy, in stages behind its own tests |
| [delivery](skills/delivery/README.md) | set a repo up on the team's git conventions, test across its lanes, ship a pull or merge request, and land it |
| [docs-parity](skills/docs-parity/README.md) | keep user docs and their screenshots level with the code, in the same change |
| [harness](skills/harness/README.md) | make, score, and fix a plugin against one rubric, read a session's transcript for what went wrong, and build a Claude Code workflow on a canvas or by hand |
| [perceptual-loop](skills/perceptual-loop/README.md) | check work judged by eye or ear with shots, gates, and a look at the picture |
| [picture-this](skills/picture-this/README.md) | draw how something works as an animated figure, with stills for a README |
| [planning](skills/planning/README.md) | turn an idea into a spec, a backlog, and issues built test-first |
| [system-map](skills/system-map/README.md) | keep a system map the code checks, and draw it on a Miro board |
| [writing](skills/writing/README.md) | write prose in your own voice, free of AI tells |

## The skills

| Skill | Started | Does |
|---|---|---|
| `start-here` | by a person, or by an agent asked what the plugin offers | Asks what is wanted, explains the area, and hands off to the route that does it |
| the ten areas | by an agent | Each reads the route that fits the task and follows it |

## Contributing

Changes go through the marketplace repository this plugin ships from:
[NCMcClure/agentic-engineering](https://github.com/NCMcClure/agentic-engineering),
whose CONTRIBUTING.md has the dev loop and the rules.
