# agentcraft

The agentic-engineering plugins hold twelve areas of work and about eighty
skills between them, and a job does not say which one it needs. A person
either remembers that shipping is `/agentic-teamwork:ship` and a spec is
`/but-first-planning:spec-write`, or goes without. This plugin is the one
thing to remember: type `/agentcraft:start-here`.

## How it works

`start-here` settles one thing first: whether a person is there to answer.

- **With a person and no argument** it asks which areas they want, in up to
  four grouped multi-select questions, explains each one they chose in a few
  lines, asks how they want to use it, and hands off to the skill that does
  the work. One run makes one hand-off; the rest it names for later.
- **With a task as its argument, or with nobody to ask** (a child session, a
  headless run, a subagent) it asks nothing: it names the area and the skill
  that fit, and hands off.

It routes and explains, and does none of the work itself. A skill only a
person can start is never called for them: `start-here` gives the address to
type. A plugin that is not installed is named with its install command.

The area tables in the skill are generated from `start-here.json` beside it
and from each skill's own frontmatter, so an address in them is one that
exists.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install agentcraft@agentic-engineering
```

Install the plugins it hands off to the same way; `start-here` says which one
a job needs when it is missing.

## The skills

| Skill | Started | Does |
|---|---|---|
| `start-here` | by hand, or by the agent when asked what the plugins offer | Asks what a person wants to do, explains the area, and hands off to the skill that does it |
