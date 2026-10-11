---
name: judge-and-queue
description: "Verdicts and the owner's queue. Use when a difference needs a verdict, a finished look change needs an independent look, or taste questions are waiting for the owner."
---

# judge-and-queue

The agent decides defects; the owner decides taste; nobody decides either with a bare metric. This skill produces
verdicts with evidence, an independent look, and a **batched** queue so the owner rules on ten questions in one
sitting instead of being interrupted ten times.

## Step 1 — Make the comparison

Before / after only means something next to the reference:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/sheet.py" triptych \
  --images <reference.png> <before.png> <after.png> --labels reference before after --out <file>
```

`iterate.py` keeps the candidate's picture from before each render as `<run>/<shot>/before.<source>.png`, so the
"before" is there. Crop to the thing in question when it is small. Open the result yourself.

*Done when: one picture shows the three states of the thing, and you have looked at it.*

## Step 2 — Give each difference a verdict

Use the verdict table in `${CLAUDE_PLUGIN_ROOT}/core/references/doctrine.md` rule 2. For each: one sentence on what the picture shows, the evidence
(a pass, a source value, a probe: `probe-the-source` when you cannot tell by looking), the verdict. A verdict of
`wrong` names what is misrepresented. Sort what is left into **mine to fix** and **the owner's to judge** (how
much, how bright, which of two plausible looks, anything the success file listed under "Left to the owner").

*Done when: every visible difference in the comparison has a row: what, evidence, verdict, whose.*

## Step 3 — An unanchored second look (finished changes)

You know what you intended, so you will see it. Before reporting a change as done, hand the comparison to the
**vision-critic** agent (`${CLAUDE_PLUGIN_ROOT}/agents/vision-critic.md`), which sees only pictures and a neutral
question, never your reasoning:

- Make neutral copies first, so no file name gives the answer away. `blind.py` copies the pair to `A.png` and
  `B.png`, decides from the id which letter is the earlier state, and prints the key for **you** only:

  ```
  uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/blind.py" --id <shot> --before <path> --after <path> [--reference <path>] --json
  ```

- Give the critic only the `images` paths it printed, the observables from the success file (as questions: "is
  the lamp lit?"), and nothing about what you changed or expect, nor the key. It reports per observable what it
  sees, defects it notices, and which side it finds more plausible and why. Translate A and B back with the key
  (`aIs`) after it has answered.
- Where it disagrees with your verdicts, look again; where it finds a defect you missed, that is the value.
- For a whole batch of finished shots, and only when the user has asked for multi-agent work, run the workflow
  (a blind critic per comparison, then a refuter per finding). Each item is what `blind.py --json` printed for
  that comparison, plus its observables; the workflow refuses pictures whose names tell which state they are:

  ```
  Workflow({
    scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/judge-and-queue/workflows/critique.js",
    args: { pluginRoot: "<absolute path of ${CLAUDE_PLUGIN_ROOT}>",
            items: [{ id: "<shot>", images: { A: "<path>", B: "<path>", R: "<path>" }, aIs: "before",
                      observables: ["<question>"], box: "x0,y0,x1,y1" }] }
  })
  ```

  It returns per item the observables for before and after, the findings that were not refuted (each marked
  `verified` true or false), the differences nobody could rank, and the counts of refuted and unverified ones.

*Done when: the critic's findings are listed beside your verdicts and each disagreement is resolved or queued.*

## Step 4 — Queue what is the owner's, with a recommendation

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/review_page.py" add --id <slug> --title "<thing>" \
  --question "<one question the owner can answer by looking>" --context "<what differs and why, two sentences>" \
  --image "reference=<path>" --image "before=<path>" --image "after=<path>" \
  --option "keep=Keep as it is" --option "change=<the alternative>" --recommend keep
```

A good item: one question, the pictures, what differs **and why** (the mechanism, from step 2), the options as
actions, your recommendation. Never ask "is this ok?" without saying what you would do. Then **carry on** with work
that does not depend on the answer; do not stop for it.

*Done when: every "owner's" row of step 2 is an item in the queue, and you have continued with independent work.*

## Step 5 — One page, one sitting

When the work pauses naturally (a task finished, several items waiting):

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/review_page.py" build
```

Give the owner the path of `.perceptual-loop/decisions/review.html`. It is one self-contained file: cards with the
pictures, a blink toggle between two states, the options, a note field, and an export of `decisions.json`.

*Done when: the page is built and the owner has its path with a one-line count of the questions in it.*

## Step 6 — Apply the rulings

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/review_page.py" apply <decisions.json>
```

Each ruling becomes a dated file in `.perceptual-loop/decisions/` (the question, the choice, the owner's words
verbatim) and leaves the queue. Read them: a ruling is binding for later work and for other agents, and the owner's
note often says more than the option. A ruling of "approve as it is" also closes the item's metric discussion: do
not reopen it because a number is far from the reference.

`.perceptual-loop/decisions/` holds rulings on looks. A ruling that binds work beyond this look (a rule for every
engine, a format, a policy) also gets a decision record: that is agent-works' job (`agent-works:decisions` /
`aw decisions new`). Without it: write it where every agent of the project reads its rules, and link the ruling.

*Done when: the queue no longer holds decided items, each ruling's follow-up work is started or listed, and any
doctrine-level ruling (a rule that changed) is written where every agent reads it.*

## Reports

Before sending a report or a PR body, lint it:
`uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/evidence_lint.py" <report.md>`. It flags verdict words beside a
bare metric, "verified" without an artefact, and targets set against the reference.
