---
name: context-lens
description: Show what entered an agent's context window, when, and from which plugin, read from the Claude Code session transcript: each hook's output by event and who saw it (the model, the person, or nobody), the CLAUDE.md and .agents rule imports, the skill listing per plugin, the API's own token count per request, and what each compaction kept or lost. Use when checking that a plugin's hooks inject what they should, sizing a briefing, checking what survives compaction, or when the person asks what the agent actually saw.
argument-hint: "[report|serve] [session id or transcript path]"
---

# context-lens

A plugin's hooks are invisible from both ends. The person never sees a
SessionStart briefing, and the agent cannot tell which of its context came from
which plugin, which of it reached the person instead, or what came back after a
compaction. Claude Code records all of it in the session transcript, and this
reads it back.

`S` below is this skill's `scripts/` directory, under the base directory the
loader prints when the skill loads (in Claude Code,
`${CLAUDE_PLUGIN_ROOT}/skills/context-lens`). Node 22, no dependencies.

## What is true and what is estimated

- **The text is the transcript's own.** An attachment carries the exact copy
  the model received; a hook run carries its stdout. A hook's `systemMessage`
  is recorded but never rendered into a request: it reached the person only.
- **Request sizes are the API's own count**: input plus cache reads plus cache
  writes, the whole window each request carried.
- **Per-item tokens are estimates**, characters over four.
- **Attribution** comes from every `hooks.json` under
  `~/.claude/plugins/cache`, old versions included, because the transcript
  names a hook by its status message or unexpanded command, never by plugin.
  A command two plugins share is reported as both; a hook nothing claims is
  "unattributed", with the plugins whose matcher could have fired it.

## Step 1: read it yourself

```bash
node S/context-lens.mjs report                 # the newest session in this directory: this one
node S/context-lens.mjs report <session-id>     # or a transcript path
node S/context-lens.mjs report --all            # every kind of context, not only the focus plugins
node S/context-lens.mjs list                    # recent sessions on this machine
```

The default lens is the `agentic-engineering` catalog's plugins (`--focus
<marketplace>` for another) plus any hook no plugin claimed. Per segment it lists the start
(what every request carries), then each turn the plugins spoke in, then for
each compaction which channels were kept, lost, new, or have had no turn yet
to fire. "Lost" is standing context a request went out without; a per-turn
hook that has not spoken again is "not since", because it speaks only when its
trigger recurs.

Read it for: briefings that never reach the model (`person`), hooks that run
and say nothing (`silent`), failures (`error`), a skill listing whose
descriptions were dropped for budget, the rule files a repo carries and
their weight, and SessionStart context that a compaction did not bring back
(a hook whose matcher leaves out `compact`).

*Done when: you have named, from the report, what the session's agent was
given and by whom, rather than from the plugin's source.*

## Step 2: show the person

```bash
node S/context-lens.mjs serve --port 4646
```

Serves `http://127.0.0.1:4646`: the session list (subagents nested under their
session), the context size per request with compactions marked, each plugin's
footprint (at start, added later, hooks per turn, after each compaction), and
the timeline, every row expandable to the exact text. "Follow live" re-reads
the open session as it grows. The server binds loopback only, answers only to
a loopback Host header, and serves nothing outside `~/.claude/projects`:
transcripts hold whatever their sessions saw, so never expose it further.

Start it in the person's own terminal or the host's preview pane, not as a
background job of yours, and say the port.

*Done when: the person has the URL and the session they asked about is open.*
