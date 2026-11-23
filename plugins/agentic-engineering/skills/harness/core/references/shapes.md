# The two shapes a plugin takes

A plugin is **plain** (each job is a skill) or it is **areas** (each body of
work is one skill, and its jobs are routes that skill reads by path). The
scanner reports which as `components.shape`, and `mixed` where a plugin is
half moved. This file is how to choose, and what each shape costs. The checks
that hold an area to its rules are SQ9, AN6, and CF4, in
[mechanical-checks.md](mechanical-checks.md).

## The rule of thumb

- **Plain** while the plugin is one body of work and lists about eight
  skills or fewer that a person would type. Most plugins are this, and it is
  the default: nothing below is a reason to leave it early.
- **Areas** when the plugin holds several bodies of work, each with jobs of
  its own. One listed name then stands for a body of work, and a person has
  one way in.
- **Never for reach.** Moving skills into areas does not make an agent find
  the right text more often. Measured on two marketplaces, reach came out no
  worse, which is the bar for the change and not a gain to promise. See
  [measuring.md](measuring.md).

A body of work is a set of jobs that share a subject, a vocabulary, and
usually a script or two: "the kanban board", "user docs", "the spec and the
plan". Two skills that would share most of their instructions are one skill
with a branch, in either shape. Eight is where a slash menu stops being
something a person reads and becomes something they search.

## What areas buy

- **One slash entry.** A person types the entry skill and is asked what they
  want. They never have to remember which skill owns a job.
- **One name per body of work.** The listing is the areas, so it stays short
  enough for every description to show at a large window, and a list of names
  a model can choose from at a small one.
- **Routes that cost nothing until read.** A route is a document: never
  listed, never refused, and not in the window until an agent reads it.

## What areas cost

- **A route is named only where you name it.** The listing never shows it.
  At a 200k window the listing is names alone, so a route is found through
  the area's name, a critical line, or a route index a session hook prints.
  Budget for that text: every request carries it.
- **A person cannot type an area.** An area is `user-invocable: false`, and
  the host refuses a person who types one. Nothing written for a person tells
  them to: they type the entry skill, or ask in words.
- **A route read by path gets no variables.** The host fills
  `${CLAUDE_PLUGIN_ROOT}` into a skill it loads, never into a file an agent
  reads. A route declares its directory from its own location and writes
  every path under it (AN6).
- **A compaction drops the route.** The host re-attaches the area it loaded,
  not a file read by path, so the area's body tells the agent to read its
  route again.
- **An area called twice is in the window twice.** Its body is held to 8,000
  characters (CF4), and an agent changes route by reading, not by calling.

## The three kinds of skill, in either shape

| The skill is | Frontmatter | A model can call it | A person can type it |
|---|---|---|---|
| listed and typed (the default) | neither key | yes | yes |
| callable, not typed: an area, or a skill only agents use | `user-invocable: false` | yes | no |
| hidden: only a person starts it | `disable-model-invocation: true` | no, and the call is refused with an order to stop | yes |

Hide a skill only where nothing the plugin prints sends an agent to it. In a
plugin of areas, what only a person starts is a route (its row says so), never
a hidden skill: a route cannot be refused.

## What an areas plugin holds

```text
skills/
  <entry>/SKILL.md              the one skill a person types: asks, explains, hands off once
  <area>/SKILL.md               user-invocable: false; the opening, the route table, the compaction line
  <area>/routes/<route>/ROUTE.md   name, description (when to take it), argument-hint; paths under a named directory
  <area>/routes/<route>/scripts/   what only that route runs
  <area>/scripts/                  what several of its routes run
```

- **The area's description** says when to reach for the body of work, then
  lists its routes as `<route> (<cue>)`. Never `<route>: <cue>`: that is the
  listing's own shape, and a model builds a skill address out of it.
- **The area's body** is short and shared: what its routes have in common, the
  table of routes with who starts each, and the line about a compaction.
- **The entry skill** asks a person which area they want, explains the one
  chosen, and hands off once. Given a task, or with nobody to ask, it asks
  nothing and names the area and route. An agent with a task calls the area
  and does not come here first.

The scaffolder writes all of this from a spec's `areas` and `entry`
(`plugin-scaffold.mjs`, in the plugin-create route's `scripts/`).

## Moving a plain plugin to areas

Only when the rule of thumb says so, and never as a way to raise a score.

1. Record what agents reach today, before anything moves ([measuring.md](measuring.md)).
2. Group the skills into bodies of work. A skill named after its plugin
   usually becomes its area's opening.
3. Move each skill to `routes/<name>/ROUTE.md` under its area, and rewrite
   every `${CLAUDE_PLUGIN_ROOT}` in it to a path under a named directory.
4. A skill only a person started becomes a route whose row says a person
   starts it. Drop `disable-model-invocation`.
5. Rewrite every address the plugin prints (a hook's message, a brief, a
   README) from the old skill to the area and its route.
6. Record again. The change lands when no prompt that was always reached is
   now never reached, and the totals at both windows are no worse.
