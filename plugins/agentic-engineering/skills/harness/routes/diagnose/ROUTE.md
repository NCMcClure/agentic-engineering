---
name: diagnose
description: "Find what went wrong with a session's context and name the fix: a hook over the host's cap, start context a compaction did not bring back, a skill call the host refused, output that reached only the person, text injected twice or on every turn, skills listed by name only, a searcher subagent that was given the build rules. Use when a session ignored a rule, forgot its instructions after a compaction, stopped at a skill, or ran short of room, and after changing a hook, a critical line, or a skill description."
argument-hint: "[session id or transcript path] [--json]"
---

# diagnose

A plugin fails quietly. A hook that printed too much, a matcher that leaves
out `compact`, a skill the host would not let the model call: none of them
raises an error anyone sees. The agent just acts as if it had never been
told, and the plugin's source reads fine. The transcript holds what happened,
and this reads it for the faults that have a known cause.

`S` below is `../../scripts` from the directory this file is in: the area's scripts. Write it out as an absolute path wherever a command says `S`. Node 22, no dependencies.

## Whose question this is

- **This route:** one session's transcript. What plugins and hooks put in
  the model's window, or failed to, and the change in the plugin that fixes
  it.
- **Not this route:** the agent files in a repo (a stale hub, a missing
  marker, a hook that is not installed). That is on disk, and
  `/agentic-engineering:harness doctor` checks and repairs it.
- **Not this route:** what a plugin should cost, from its files.
  `/agentic-engineering:harness plugin-evaluate` scores that.

A script owns the findings. Your part is to explain them and, when the person
asks, to make the fix: never add a finding the script did not raise, and never
drop one because the session seemed to go well.

## Step 1: run it

```bash
node "S/context-lens.mjs" diagnose                 # the newest session in this directory: this one
node "S/context-lens.mjs" diagnose <session-id>     # or a transcript path
node "S/context-lens.mjs" diagnose <session-id> --json
node "S/context-lens.mjs" list                      # recent sessions on this machine
```

The session to read is the one the complaint is about, which is rarely the
one you are in. If the person did not say, `list` and ask.

Each finding prints its level, its code, whose it is, where (a segment is the
stretch between compactions, counted from one), what happened, and the fix.
`--json` prints the same with the ids of the events each was raised from, and
the thresholds it was measured against.

It reads the session's subagents too, but only the ones that should start
with nothing: a searcher, a planner, the blind critic.

*Done when: you have the findings for the session the person meant, or the
line that says there are none.*

## Step 2: read each finding against the lens

A finding says what the transcript shows. Before you tell the person it is
the cause of what they saw, look at the events it was raised from:

```bash
node "S/context-lens.mjs" report <session-id>       # everything the findings were raised from
```

The lens route (`/agentic-engineering:harness lens`) says how to read that
report. Check that the finding sits before the turn where the session went
wrong: context lost at compaction 2 does not explain a rule ignored in
segment 1.

| Level | Finding | What the transcript shows | The fix is in |
| --- | --- | --- | --- |
| critical | `HOOK_OVER_CAP` | One hook printed more than 10,000 characters, so the model got a preview and a file path. | the hook: print less |
| critical | `COMPACT_LOST` | Context in the window at the start that no request after a compaction carried, and why: no hook ran, it ran silent, or it failed. | the hook map's `SessionStart` matcher, or the hook |
| critical | `SKILL_REFUSED` | A call on the Skill tool the host answered with an error. | the skill's frontmatter, or the address that sent the agent there |
| warning | `HOOK_NEAR_CAP` | One hook printed 8,000 characters or more. | the hook |
| warning | `HOOK_FAILED` | A hook exited with an error, so it said nothing. | the hook, or a new session after an update |
| warning | `HOOK_PERSON_ONLY` | Every output of a hook was a `systemMessage`. | the hook's output, if the agent has to act on it |
| warning | `HOOK_REPEATS` | The same hook text on five turns or more. | the hook: speak when something changed |
| warning | `DUP_TEXT` | A line of 60 characters or more that two sources both put in at a segment's start. | whichever copy is not the source |
| warning | `CRITICAL_TOTAL_OVER` | The critical lines of one start came to more than 7,500 characters. | the lines: each request carries them |
| warning | `COMPACT_ONLY_RESUME` | Start context that came back after a compaction only when the session was resumed. | the hook map's `SessionStart` matcher |
| warning | `ROUTE_NOT_REREAD` | The last route read before a compaction was not read again after it. | the area's body, which is what comes back |
| warning | `LISTING_BARE` | Skills of a plugin in focus listed with no description. | the names, and a critical line for what the listing dropped |
| warning | `SKILL_REINVOKED` | A skill called twice in one segment: its body is in the window twice. | the body, if it says to call again |
| warning | `SUBAGENT_CONTEXT` | A searcher, a planner, or the blind critic started with plugin context. | the `SubagentStart` hook |
| info | `RESUME_REPEAT` | A resume printed the start context again beside the first copy. | nothing, unless it is large |
| info | `UNATTRIBUTED` | Hook output the lens could not tie to a plugin. | nothing: it limits the reading |
| info | `TRANSCRIPT_PARTIAL` | Unreadable lines, no recorded request, or a transcript that opens at a compaction. | nothing: read the findings as a floor |

Two limits to say out loud when they apply:

- **Compaction findings cover the plugins in focus**, the `agentic-engineering`
  catalog's by default. `--focus <marketplace>` reads another's.
- **No findings is not a clean bill.** It means nothing here went over a cap,
  was lost, was refused, or reached only the person. A rule the model was
  given and did not follow is not in a transcript's structure: read the turn.

*Done when: each finding you report is one you have looked at in the lens,
and you have said which of them, if any, sits before what the person saw.*

## Step 3: report, then fix only if asked

Give the person the findings most serious first: what happened in a line,
whose it is, and the fix. Quote from the transcript only what the finding
needs: it holds whatever the session read.

Reading changes nothing, and neither does this route by itself. If the person
asks for the fix and the plugin is theirs to edit, make it in the plugin's
source, then say what would prove it: a new session, the same steps, and
`diagnose` again on that session. A fix to a plugin's structure (a hidden
skill, an area's body, a critical line's budget) is the workbench's:
`/agentic-engineering:harness plugin-improve`.

To show the person, `serve` from the lens route opens the page: the findings
are its first card, and each one jumps to the event it was raised from.

*Done when: the person has the findings and the fix for each, and any change
you made is named with how to check it.*
