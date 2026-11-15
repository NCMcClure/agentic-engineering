# agentcraft

Engineering with agents keeps hitting the same problems: code written before
the spec was settled, a round of parallel work that dies with its
conversation, docs that ship after the code, a picture nobody looked at. Each
has a fix here. As twelve separate plugins those fixes listed about eighty
skills, and a job does not say which one it needs: a person had to remember
the name, and an agent had to pick it out of a listing too long to show in
full.

This is the twelve as one plugin. A person remembers one thing,
`/agentcraft:start-here`. An agent sees fourteen names.

## How it works

- **One skill a person types.** `start-here` asks which areas they want,
  explains each one they chose, asks how they want to use it, and hands off.
  Given a task after its name (`/agentcraft:start-here ship this change`), or
  run where nobody can answer, it asks nothing and hands the task to the area
  and route that fit. It is the only entry in the slash menu.
- **Thirteen areas an agent calls.** An area is a skill named for a body of
  work. An agent calls it with a route as the first word of its arguments, or
  with the task alone, and the area picks. A person does not type an area:
  they ask for the work in words, or go through `start-here`.
- **Routes read as documents.** What used to be a skill is a `ROUTE.md` under
  its area. It is never listed and costs nothing until its area reads it, so
  the listing holds fourteen names where it held about eighty. An area's
  table of routes is generated from its `door.json` and each route's own
  frontmatter, so a route in the table is one that is there.
- **Hooks that speak once.** One session hook prints each area's critical
  lines, and only in a repo that has opted in; the guards and checks an area
  ships run from that same plugin.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install agentcraft@agentic-engineering
```

Each old plugin name still installs: it is now a stub that depends on
`agentcraft` and brings it in (Claude Code 2.1.321 or later). Install `agentcraft` by name all the
same, so it stays when the stubs are retired.

## The areas

Each area keeps its own README under `skills/<area>/`, with what it is for and
how its routes work.

| Area | Use it to |
|---|---|
| [agent-works](skills/agent-works/README.md) | run several tasks at once as child sessions from a kanban board, and keep a repo's agent-facing facts in one home each |
| [agentic-teamwork](skills/agentic-teamwork/README.md) | set a repo up on the team's git conventions, test across its lanes, ship a pull or merge request, and land it |
| [but-first-planning](skills/but-first-planning/README.md) | turn an idea into a spec, a backlog, and issues built test-first |
| [code-diet](skills/code-diet/README.md) | keep new code at the simplest rung that holds, and cut what is not needed |
| [codebase-optimizer](skills/codebase-optimizer/README.md) | restructure a codebase that has grown messy, in stages behind its own tests |
| [context-doctor](skills/context-doctor/README.md) | read a session's transcript for what entered the agent's context, what went wrong with it, and the fix |
| [docs-parity](skills/docs-parity/README.md) | keep user docs and their screenshots level with the code, in the same change |
| [perceptual-loop](skills/perceptual-loop/README.md) | check work judged by eye or ear with shots, gates, and a look at the picture |
| [picture-this](skills/picture-this/README.md) | draw how something works as an animated figure, with stills for a README |
| [plugin-workbench](skills/plugin-workbench/README.md) | make, score, and fix a plugin against one rubric |
| [system-map](skills/system-map/README.md) | keep a system map the code checks, and draw it on a Miro board |
| [workflow-studio](skills/workflow-studio/README.md) | build a Claude Code workflow on a canvas or by hand |
| [write-like-me](skills/write-like-me/README.md) | write prose in your own voice, free of AI tells |

## The skills

| Skill | Started | Does |
|---|---|---|
| `start-here` | by a person, or by an agent asked what the plugin offers | Asks what is wanted, explains the area, and hands off to the route that does it |
| the thirteen areas | by an agent | Each reads the route that fits the task and follows it |
