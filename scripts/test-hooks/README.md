# Test lanes

A plugin's hooks are invisible from both ends: the person never sees a
SessionStart briefing, and the agent cannot tell which of its context came from
which plugin. These lanes check what the plugins actually do, not what their
source says they should.

Node 22, no dependencies. Nothing here ships with a plugin.

## Unit lane: `npm test`

Runs every `*.test.mjs` under this folder. Free, fast, and what CI runs.

`hooks.test.mjs` spawns each hook through the command its `hooks.json`
registers, with one JSON payload on stdin, and checks stdout and the exit code.
A case is one file, `cases/<plugin>/<hook>.<n>.json`; the format is at the top
of `hooks.test.mjs`. Every Node hook needs three: a real payload, empty stdin,
and malformed JSON. On Windows only Node hooks run; a shell or Python hook's
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

It spends model quota, a few cents a fixture, so it is opt-in and never runs in
CI. Run it after changing a hook, a skill description, or anything else that
alters what an agent sees.

```bash
npm run test:live                        # run, check, print the before/after table
npm run test:live -- --only adopted      # one fixture
npm run test:live -- --keep              # leave the fixtures and transcripts for a look
npm run test:live -- --write-baseline    # record this run as live/baseline.json
```

`live/baseline.json` holds the last recorded numbers and `expectedFailures`,
the check failures known at that point. The lane fails only on a failure the
baseline does not list, and prints `fixed:` when a listed one stops happening.
Record a new baseline in the same change that fixes one.

## Layout

- `fixtures.mjs` - the fixture repos both lanes use, written as static trees.
- `hooks.test.mjs`, `cases/` - the hook cases.
- `unit/` - tests of the repo's own tooling (the validator and the installer,
  each run against a throwaway copy) and one suite per file in `scripts/shared/`.
- `live/live.mjs` - the lane; `session.mjs` its side effects, `measure.mjs` its
  arithmetic, `checks/` one file per check. The transcript reader is
  `plugins/plugin-workbench/skills/context-lens/scripts/`.
