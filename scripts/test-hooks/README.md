# Test lanes

A plugin's hooks are invisible from both ends: the person never sees a
SessionStart briefing, and the agent cannot tell which of its context came from
which area. These lanes check what the plugin actually does, not what its
source says it should.

Node 22, no dependencies. Nothing here ships with the plugin.

## Unit lane: `npm test`

Runs every `*.test.mjs` under this folder. Free, and what CI runs. The whole
lane takes ten minutes or so, most of it the gate's own suite, which copies the
checkout once per case; run one suite while you work on it
(`node --test scripts/test-hooks/unit/<suite>.test.mjs`).

`hooks.test.mjs` spawns each hook through the command the plugin's `hooks.json`
registers, with one JSON payload on stdin, and checks stdout and the exit code.
A case is one file, `cases/<owner>/<hook>.<n>.json`: `cases/agentic-engineering/` for the
plugin's own two session commands, `cases/<area>/` for a hook in an area's
`hooks/` folder. The format is at the top of `hooks.test.mjs`. Every Node hook
the hook map runs needs three: a real payload, empty stdin, and malformed JSON.
On Windows only Node hooks run; a shell or Python hook's cases are skipped
there.

A case with a `gap` line states the behavior wanted for a known defect. It is
expected to fail, and it fails the lane the day it passes, so the fix has to
delete the line.

`unit/` holds the rest:

- `areas.test.mjs` pins the plugin's skills: `start-here` and the ten
  areas, and that no other directory sits under `plugins/`.
- `<area>-skills.test.mjs` pins one area's route list and what its routes say,
  through `area-routes.mjs`, which reads an area as a model does (its
  `SKILL.md`, its `door.json`, each `routes/<route>/ROUTE.md`). The other
  `<area>-*.test.mjs` suites test that area's scripts and hooks.
- `validate.test.mjs`, `gen-guide.test.mjs` and `install.test.mjs` test the
  repo's own tooling, each against a throwaway copy or a fixture marketplace.
- One suite per file in `plugins/agentic-engineering/lib/`, and
  `critical-context.test.mjs` for the session helper and its two commands.
  `area-session.mjs` runs one area's part of those commands alone, for the
  suites about a single area.
- `live-lane.test.mjs` tests the live lane's pure half, on recorded
  transcripts.

A test that needs an address nothing ships at (an old plugin's skill, a
route that is not there) builds it from its parts: the gate reads test files
too, and holds every address written out to what the plugin ships.

## Live lane: `npm run test:live`

Starts real headless Claude Code sessions with this checkout's plugin
(`claude -p --plugin-dir plugins/agentic-engineering`, on haiku), one
per fixture repo: a prompt, a forced `/compact`, then a prompt that starts
three kinds of subagent, the plugin's own `agentic-engineering:vision-critic` among
them. It reads each transcript back through the harness area's lens and
prints, per area, what reached the model at the start, after the compaction,
and in each subagent. The plugin speaks through one command for every area, so
a row is an area's by the block of that command's output its heading names.

It also asks whether a session still reaches the right route. Each prompt in
`live/triggers.mjs` is written the way a person would ask, names no skill by
address, and runs as its own session at two context windows: the login's
default, and 200k, where a listing may hold names with no descriptions.
`live/reach.mjs` reads the transcript for whether the session got there: it
called the area and read the route's `ROUTE.md`, or, for the entry skill and
an area's own page, called or read that. One more session works inside a
route, compacts, and carries on, to see that its instructions come back.
These sessions get four read-only tools and no MCP server (the plugin's own
tools are denied by name, `mcp__agentic-engineering`), because the prompts ask for work
with side effects.

It spends model quota, so it is opt-in and never runs in CI: about 20 cents
for the seven fixtures, plus 64 trigger sessions capped at five cents each. Run
it after changing a hook, a description, a cue, or anything else that alters
what an agent sees.

```bash
npm run test:live                               # run, check, print the before/after tables
npm run test:live -- --only adopted             # one fixture, and the prompts that run in it
npm run test:live -- --keep                     # leave the fixtures and transcripts for a look
npm run test:live -- --write-baseline           # record both parts of live/baseline.json
npm run test:live -- --write-baseline=skills    # record the skills part alone
npm run test:live -- --write-baseline=fixtures  # record the token sizes alone, from one pass
```

`live/baseline.json` has two parts, each with its own stamp: `fixtures`, the
token sizes, and `skills`, what each prompt reached. It also holds
`expectedFailures`, the check failures known when a part was recorded. The lane
fails only on a failure the baseline does not list, and prints `fixed:` when a
listed one stops happening. Record a new baseline in the same change that fixes
one.

A row is keyed by its route's name, which is the name it had as a skill, so a
baseline from before the plugins became areas still reads against a run after
it. Two rows are in no such baseline: `lens`, which was plugin-workbench's
`context-lens` before it left for the context-doctor area, and
`plugin-create` (then `create-plugin`), the row plugin-workbench got in its
place. All three areas are `harness` now, and a baseline recorded before that
regroup names its rows by the old areas and routes.

One session is one sample, so the skills part is recorded over three passes
and a plain run is one. A prompt fails only when the baseline reached its route
in every pass and this run reached it in none, after two reruns. A session cut
off before it reached anything was not measured, which is not a miss.

A recording that would hide a problem is refused: nothing is written when a
session was not measured, when one was offered a tool outside its four, or when
a prompt the old baseline always reached is now never reached. That last one is
the restructuring bar: a change to how the plugin is laid out lands only if
reach is no worse. If the cause is understood and accepted, change that cell of
`baseline.json` by hand in the same change, and say why in a comment beside
the prompt in `live/triggers.mjs`.

The totals print apart for prompts that name their route and those that do
not, and for routes an agent may start and those only a person starts (an
area's `door.json` says `"starts": "person"`): the second kind were skills the
host refused a call on, and are documents an agent may open now, so they moved
for a reason that is not routing.

## Layout

- `fixtures.mjs` - the fixture repos both lanes use, written as static trees.
- `hooks.test.mjs`, `cases/` - the hook cases.
- `unit/` - the suites above.
- `live/live.mjs` - the lane; `session.mjs` its side effects, `measure.mjs` its
  arithmetic, `checks/` one file per check, `triggers.mjs` the prompts, and
  `reach.mjs` what counts as reaching a route. The transcript reader is
  `plugins/agentic-engineering/skills/harness/scripts/`.
- `fixtures/live-lane/` - recorded transcripts the reach tests read, cut down
  to the fields the detector uses. They are recordings, and keep the names
  they were made with.
