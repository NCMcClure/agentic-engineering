# Perceptual addendum to the brief

Append this to the brief every agent of the round reads before its own task. With agent-works that is its common
brief (`agent-works:orchestrate`), which already covers names, locks, workspaces, git and the report's general
items; without it, this addendum under the five fallback lines of the skill is the whole brief. Fill the `<…>`
parts.

```markdown
## How to judge
- The reference is a reference, not the ceiling. Match what the scene is; do not tune numbers towards it.
- A metric that moved is not a verdict: say what the picture shows and give it one of the doctrine's six verdicts
  (<path of the plugin's core/references/doctrine.md>, rule 2). Never "worse" from a number.
- Before calling a difference a defect, go to the source: what the asset or spec says, what the candidate presents,
  why the reference differs.
- Look questions are the owner's: queue them with reference | before | after and a recommendation; carry on.
- Your task's success file is `.perceptual-loop/success/<task>.md`: read it first, and keep to its proving shots.

## Verification, proportionate
- Iterating: the proving shots of your success file. At the end, once: the gates your task names. A full run only
  where your task says so, with its reason in the command (`PL_RUN="full: <what is finished>"`).
- A failure on something you did not touch: render it again first. Still failing: check whether it is stale on
  <main>.
- The hooks match command text: a render command named inside a quoted argument of another program still matches,
  so such text goes into a file.

## Report: the items about pictures
- What the source says against what the candidate now shows.
- Image paths (reference | before | after) for the 2–4 most telling views.
- Every gate with its result; failures stated plainly. What you assumed and did not measure; what could not be
  checked without a person or hardware.
- Look questions queued for the owner, and any decision you made that was theirs.
```

## Report rules for the coordinator

- Say which pictures you opened yourself and what you saw; mark the rest as the agent's report.
- Separate "verified" (with how) from "reported by the agent" and from "not verified".
- One list of open look decisions, each with your recommendation, ordered by what blocks the most.
