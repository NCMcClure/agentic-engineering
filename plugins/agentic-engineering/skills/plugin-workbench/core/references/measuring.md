# Measuring what a plugin does in a session

The scanner scores what a plugin should cost, from its files. Whether an
agent reaches the right skill, and what a hook put in the window, are facts
of a session. This file is how to measure them, and how to read someone
else's measurement. The workbench does not run sessions: they spend the
person's quota, so a route here names the measurement and asks.

## Two questions, two instruments

| The question | The instrument | It reads |
|---|---|---|
| Does an agent still reach the right skill or route? | a reach lane: scripted sessions, one prompt each | the transcripts of sessions it starts |
| What did the plugin put in the window, and what went wrong? | `/agentic-engineering:context-doctor diagnose` | the transcript of a session that already happened |

The second costs nothing and is where to start. Its findings can ride on a
scorecard: see "On the scorecard" below.

## A reach lane

A lane answers one question: given a prompt a person would write, did the
session open the skill or route the prompt was written for?

- **One prompt per session.** A second prompt inherits the first one's
  context, and then the listing is no longer what sent the agent anywhere.
- **Written the way a person asks.** A prompt names no skill, and shares no
  run of four words with the description it targets, or it measures string
  matching. Keep the few that do name their skill apart in the totals.
- **Two windows.** At a large window the listing shows every description; at
  200k it shows names alone. A plugin reached only where descriptions show
  is a plugin most sessions will not find.
- **Three passes.** One session is an anecdote. Report each prompt as
  "reached k of 3", and say whether it was reached by a call on the skill or
  by a read of its file.
- **Reached means opened.** A call on the Skill tool that went through, or a
  read of the skill's or the route's own file. A call the host refused is not
  a reach, and a session that ends on one is a failure of its own.
- **A session that was cut off is not a miss.** One that ran out of turns or
  budget is "not measured", run again, and never counted either way.
- **Read-only tools.** The sessions ask for work, so give them no tool that
  does it: the lane measures where the agent went, not what it built.

## The baseline, and the bar

- **Record before the change.** A baseline holds, per prompt and window, the
  outcome of each pass, with the host's version and the model.
- **A failing recording writes nothing.** A run with an unmeasured session,
  or with a prompt that was reached in every baseline pass and is now reached
  in none, is refused, so a bad run can never become the new normal.
- **The bar is "no worse".** For a restructure: no prompt that was always
  reached is now never reached, and the totals at each window are within the
  spread of the baseline or above it. A cell that swings between one and two
  of three from run to run is noise; only "every pass" to "no pass" is a
  regression.
- **A cell accepted by hand is written down**, beside the prompt, with the
  reason. That is the person's call, never the agent's.

## What to do with a miss

Read the session before changing the plugin: `diagnose` on its transcript,
then the lens. The levers, in the order to try them:

1. **The description's lead**, where the listing shows it: say the moment to
   reach for the skill, in the words a person uses for the job.
2. **The name**, where it does not: at 200k the name is all there is.
3. **A critical line** that names the route as an instruction, where the
   agent must act unasked. Every request pays for it, so it has to earn its
   place against the plugin's total.
4. **A route index** a session hook prints: each area's routes by name. It is
   the only place a route's own name is seen at a small window.

A prompt whose task the agent can do without the skill will keep missing, and
that is a finding about the skill, not the prompt: it may not need to exist.

## When the repo has a lane, and when it does not

- **It has one** (a script the repo's own docs name for live or reach tests):
  name it and its recorded baseline to the person, say what a run costs if
  the docs do, and let them start it. Never run it yourself.
- **It has none:** do not build one unasked. Say what cannot be claimed
  without it ("reach after this change is not measured"), and offer the free
  half: `diagnose` on a real session that used the plugin.

## On the scorecard

A diagnosis can be attached to a score, as a block of its own that changes no
number:

```bash
node "<area scripts>/context-lens.mjs" diagnose <session> --json > <outdir>/diagnose.json
node "<core>/scripts/plugin-scan.mjs" <plugin-root> --score <outdir>/grades.json --measured <outdir>/diagnose.json > <outdir>/score.json
```

`score.json` then carries `measured`: the session it came from, the counts by
level, and each finding. It is one session, so it says what happened there,
not what always happens, and the verdict never moves on it. A critical
finding there is a reason to look at CS1, CF5, and SQ2 again with the
transcript as evidence.
