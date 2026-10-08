# Brief template

Copy, fill the `<…>` parts, save as a file in the project (git-ignored is fine), and tell every agent of the round to
read it before its own task. Keep it to one screen and a half: an agent that skims the brief breaks the round.

```markdown
# Brief for every agent of this round (read after the project's own agent instructions)

Several agents work at the same time. Coordinate so that never two instances of <application(s)> run at once, and
nobody breaks another's tests.

## Read
1. The project's agent instructions (<file>), all of it.
2. <where rulings and status live>, especially the rulings of <date>: they override older text where they differ.
3. Your task's success file: `.perceptual-loop/success/<task>.md`.

## How to judge
- The reference is a reference, not the ceiling. Match what the scene is; do not tune numbers towards it.
- A metric that moved is not a verdict: say what the picture shows and give it one of the doctrine's six verdicts
  (<path of the plugin's core/references/doctrine.md>, rule 2). Never "worse" from a number.
- Before calling a difference a defect, go to the source: what the asset or spec says, what the candidate presents,
  why the reference differs.
- Look questions are the owner's: queue them with reference | before | after and a recommendation; carry on.

## Your name and the locks
- You have an agent name (in your task). Use it for `--as` and `PL_AGENT=`.
- Before anything that starts <application>: acquire its lock, run the command with your name in it, release at
  once, also after a failure. Hold a lock only while the application runs. Needing two: <order>.
- If the application "runs without a lock", it is the owner's own: never kill it; do other work; say so.
- The board: read it before you start and after long steps; write one line when you start, merge, are about to
  edit <shared files>, wait, or finish.

## Where you work
- Worktree agents: your own worktree and branch; set it up with <install commands>. It cannot <what needs the main
  checkout>; if your task turns out to need that, stop at the shared code and say what is left.
- The main checkout belongs to one agent at a time (<who>). Others never switch its branch or edit its files.
- Never touch, stage or revert: <the owner's files>.

## Git
- One branch per task; commit as you go; stage files by path; PR against <main>; merge when your gates are green;
  delete the branch; note it on the board. If <main> moved, merge it in and re-run what it could have broken.
- <attribution lines the project requires>.
- The hooks match command text: a guarded command named inside a quoted argument of another program still
  matches, so such text goes into a file.

## Verification, proportionate
- Iterating: one test file, the proving shots of your success file. At the end, once: the gates your task names. A full run only where your
  task says so, with its reason in the command.
- A failure on something you did not touch: run it again first. Still failing: check whether it is stale on <main>.

## Report (short, plain)
1. What you changed, and where.
2. What the source says against what the candidate now shows.
3. Image paths (reference | before | after) for the 2–4 most telling views.
4. Every gate with its result; failures stated plainly.
5. What you skipped, what you assumed and did not measure, what could not be checked without a person or hardware.
6. What needs the owner: decisions you made that were theirs, look questions queued, anything risky you noticed.
7. Branch, PR, merged or not; what the next step is and who triggers it.
```

## Report rules for the coordinator

- Lead with the state (done, partly, blocked) and anything the owner must decide.
- Say which pictures you opened yourself and what you saw; mark the rest as the agent's report.
- Separate "verified" (with how) from "reported by the agent" and from "not verified".
- One list of open decisions, each with your recommendation, ordered by what blocks the most.
