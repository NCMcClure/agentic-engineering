---
name: judge-and-queue
description: "Use when a difference in a picture needs a verdict, a finished look change needs a blind second look, or taste questions wait for the owner: one review page."
---

# judge-and-queue

The agent decides defects, the owner decides taste, and nobody decides either with a bare metric. This skill gives each difference a verdict with its evidence, gets a second look from a critic who does not know what you meant, and batches the owner's questions into one page, so the owner rules on ten questions in one sitting instead of being interrupted ten times.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`. The verdicts are the table in `${CLAUDE_PLUGIN_ROOT}/references/doctrine.md` rule 2, and only there.

## Step 1: Make the comparison

Before and after only mean something next to the reference. `iterate` already drew one per shot (`runs/<run>/<shot>/sheet.<source>.png`: reference, before, after, then what the run changed, the edges, and the colour difference on a fixed scale). For anything else:

```
P sheet triptych <reference.png> <before.png> <after.png> --label reference --label before --label after
P sheet crop <shot> --box x0,y0,x1,y1 --zoom 3
```

`iterate` keeps the candidate's picture from before each render as `runs/<run>/<shot>/before.<source>.png`. Crop to the thing in question when it is small. Open the sheet yourself with the Read tool.

*Done when: one picture shows the three states of the thing, and you have looked at it.*

## Step 2: Give each difference a verdict

For each visible difference: one sentence on what the picture shows, the evidence (a pass, a value from the source, a probe; `probe-the-source` when looking cannot tell you), and the verdict. A `wrong` names what is misrepresented. Then sort what is left into **mine to fix** and **the owner's to judge**: how much, how bright, which of two plausible looks, and anything the success file lists under "Left to the owner".

*Done when: every visible difference has a row: what, evidence, verdict, whose.*

## Step 3: A blind second look, for a finished change

You know what you meant, so you will see it. Before you report a look change as done, a critic who sees only pictures and neutral questions looks at it.

1. Copy the pair to neutral names. `blind` puts `A` and `B` (and `R`) in a new folder under the OS temp directory, decides from the id which letter is the earlier state, and keeps that key in `.agents/perceptual/runs/blind/<id>.json`, apart from the pictures:

   ```
   P blind --id <shot> --before <file> --after <file> [--reference <file>] --json
   ```

2. Dispatch the `perceptual-loop:vision-critic` agent with only the picture paths it printed, the success file's observables phrased as questions ("is the lamp lit?"), the box to attend to, and the plugin root. Nothing about what you changed or expect, and never the key.
3. Translate A and B back once it has answered (`aIs` in what blind printed, or `P blind reveal <id>`). Where it disagrees with you, look again; where it finds a defect you missed, that is the point of the step.

For a batch of finished shots, and only when the person asked for multi-agent work, run the workflow: a critic per comparison, then a skeptic per finding. It refuses pictures whose names say which state they are, and it keeps the key in the script:

```
Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/judge-and-queue/workflows/critique.js",
  args: { pluginRoot: "<absolute path of the plugin>",
          items: [{ id: "<shot>", images: { A: "<path>", B: "<path>", R: "<path>" }, aIs: "<from blind>",
                    observables: ["<question>"], box: "x0,y0,x1,y1" }] } })
```

It returns, per comparison, the observables for before and after, the findings that were not refuted (each `verified` or not), the differences nobody could rank, and the counts. A host without the Workflow tool follows `${CLAUDE_PLUGIN_ROOT}/references/subagent-fallback.md`.

*Done when: the critic's findings sit beside your verdicts, and each disagreement is resolved or queued.*

## Step 4: Queue what is the owner's, with a recommendation

```
P review add --id <slug> --title "<the thing>" --question "<one question the owner answers by looking>" \
  --context "<what differs and why, in two sentences>" \
  --image "before=<path>" --image "after=<path>" --image "reference=<path>" --compare \
  --option "keep=Keep it as it is" --option "change=<the alternative>" --recommend keep
```

A good question has one question, the pictures, what differs **and why** (the mechanism from step 2), the options written as actions, and your recommendation. `--compare` marks the first two pictures as one view, so the page offers a slider and blink. `--evidence` and `--verdict` add the measured facts and the verdicts given so far. Never ask "is this ok?" without saying what you would do. Then carry on with work that does not depend on the answer.

*Done when: every row of step 2 that is the owner's is a question in the queue, and you have gone on with other work.*

## Step 5: One page, one sitting

When the work pauses (a task finished, several questions waiting):

```
P review build
```

It writes `.agents/perceptual/decisions/review.html`: one file that needs no network, every picture laid on grey 128, scaled down and embedded as a JPEG (`--link-images` references the files instead). The owner gets cards with the pictures, a slider and blink for each pair, the options (keys 1 to 9, j and k between questions), a note field, and an export of `decisions.json`. The answers stay in the owner's browser until exported.

*Done when: the page is built and the owner has its path and a one-line count of the questions in it.*

## Step 6: Apply the rulings

```
P review apply <decisions.json>
```

Each answer becomes `.agents/perceptual/decisions/<date>-<id>.md` (the question, the choice, the owner's note word for word) and leaves the queue; the command says what to do next for each. A ruling binds later work and other agents, and the note often says more than the option. A ruling of "keep it as it is" also ends the metric argument about that look: a number far from the reference does not reopen it.

A ruling that reaches past this look (a rule for every sky, a format, a policy) is also written where every agent of the project reads its rules: a line in the root `AGENTS.md` that links the ruling file, or a decision record in the plan if but-first-planning is installed and the repo has `.agents/plan/`.

*Done when: the queue holds no decided question, each ruling's follow-up is started or listed, and any ruling with reach is written where every agent reads it.*

## Reports

Lint a report or the body of a pull or merge request before sending it: `P lint <report.md>`. It flags a verdict word beside a bare metric, "verified" with no artefact, and a target set against the reference. A check you could not run is owed, not dropped: a line at the top of the report, or the task board if agent-works is installed.
