# Test lanes

A plugin's hooks are invisible from both ends: the person never sees a
SessionStart briefing, and the agent cannot tell which of its context came from
which plugin. These lanes check what the plugins actually do, not what their
source says they should.

Node 22, no dependencies. Nothing here ships with a plugin.

## Unit lane: `npm test`

Runs every `*.test.mjs` under this folder. Free, fast, and what CI runs.

`hooks.test.mjs` spawns each hook through the command the plugin's `hooks.json`
registers, with one JSON payload on stdin, and checks stdout and the exit code.
A case is one file, `cases/<owner>/<hook>.<n>.json`: `cases/agentcraft/` for the
plugin's own two session commands, `cases/<area>/` for a hook in an area's
`hooks/` folder. The format is at the top of `hooks.test.mjs`. Every Node hook
the hook map runs needs three: a real payload, empty stdin, and malformed JSON. On Windows only Node hooks run; a shell or Python hook's
cases are skipped there.

A case with a `gap` line states the behavior wanted for a known defect. It is
expected to fail, and it fails the lane the day it passes, so the fix has to
delete the line.

## Live lane: `npm run test:live`

Starts real headless Claude Code sessions with this checkout's plugins
(`claude -p --plugin-dir plugins`, on haiku), one per fixture repo: a prompt, a
forced `/compact`, then a prompt that starts three kinds of subagent. It reads
each transcript back through plugin-workbench's context lens and prints, per
plugin, what reached the model at the start, after the compaction, and in each
subagent.

It also asks whether a session still reaches the right skill. Each prompt in
`live/triggers.mjs` is written the way a person would ask, names no skill by
address, and runs as its own session at two context windows: the login's
default, and 200k, where a plugin's skills are listed by name with no
description. `live/reach.mjs` reads the transcript for whether the session
opened that skill, by calling it or by reading its file. One more session
works inside a skill, compacts, and carries on, to see that the skill comes
back. These sessions get four read-only tools and no MCP server, because the
prompts ask for work with side effects.

It spends model quota, so it is opt-in and never runs in CI: about 20 cents
for the seven fixtures, plus 60 trigger sessions capped at five cents each. Run
it after changing a hook, a skill description, or anything else that alters
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

One session is one sample, so the skills part is recorded over three passes
and a plain run is one. A prompt fails only when the baseline reached its skill
in every pass and this run reached it in none, after two reruns. A session cut
off before it reached anything was not measured, which is not a miss.

A recording that would hide a problem is refused: nothing is written when a
session was not measured, when one was offered a tool outside its four, or when
a prompt the old baseline always reached is now never reached. That last one is
the restructuring bar: a change to how skills are laid out lands only if reach
is no worse. If the cause is understood and accepted, change that cell of
`baseline.json` by hand in the same change, and say why in a comment beside
the prompt in `live/triggers.mjs`.

The totals print apart for prompts that name their skill and those that do not,
and for skills a session can call and those only a person can start
(`disable-model-invocation`), since the host refuses a call on the second kind.

## Layout

- `fixtures.mjs` - the fixture repos both lanes use, written as static trees.
- `hooks.test.mjs`, `cases/` - the hook cases.
- `unit/` - tests of the repo's own tooling (the validator and the installer,
  each run against a throwaway copy; the generator and the script that moves a
  plugin into the one plugin, each on a fixture marketplace), one suite per
  file in `plugins/agentcraft/lib/`, and `critical-context.test.mjs` for the
  session helper and its two commands. `area-session.mjs` runs one area's part
  of those commands alone, for the suites about a single area.
- `live/live.mjs` - the lane; `session.mjs` its side effects, `measure.mjs` its
  arithmetic, `checks/` one file per check, `triggers.mjs` the prompts, and
  `reach.mjs` what counts as reaching a skill. The transcript reader is
  `plugins/agentcraft/skills/context-doctor/scripts/`.
- `fixtures/live-lane/` - recorded transcripts the reach tests read, cut down
  to the fields the detector uses.
