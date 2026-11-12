# The perceptual addendum to a child's brief

Look work spread over several sessions fails in a known way: each wants the one renderer, each moves the same baseline, and each comes back with "looks good". A session that hands out a round of work where any task is judged by eye or ear appends the block below to every child's brief, under the brief's own rules for branches, locks, and reports, and fills in the `<...>` parts. Everything else about the round (who works on what, the locks, the report's general items) is the dispatching session's, or agent-works' if that plugin is installed.

Before the round, give each task its own success file (`define-success`) naming its 1 to 3 proving shots and its end-of-work gates. Two tasks that need the same proving shots, or move the baseline of the same shots, are not parallel: run them one after the other. A change to a format or layout every reference depends on is one task, merged last, followed by one re-capture.

```markdown
## Perceptual work: how to judge
- Load `/perceptual-loop:perceptual-loop` first and read its doctrine (nine rules).
- Your success file is `.agents/perceptual/success/<task>.md`. Read it first, and keep to its proving shots.
- The reference is a reference, not the target: match what the scene is, and never tune a number toward it.
- A metric that moved is not a verdict. Open the sheet `iterate` drew, say what the picture shows, and give it
  one of the doctrine's six verdicts. Never "worse" from a number.
- Before calling a difference a defect, go to the source (`probe-the-source`): what the asset or spec says,
  what the candidate presents, why the reference differs.
- Taste is the owner's: queue it with `pl.mjs review add` (reference, before, after, and your
  recommendation) and carry on. Do not stop the round for a look question.

## Perceptual work: how much to render
- While iterating: your proving shots only. At the end, once: the gates your success file names.
- A full run only where your task says so, with its reason in the command: `PL_RUN="full: <what is finished>"`.
- A renderer only one session may run at a time: <resource>, <how its turn is taken: a lock, or one named session>.
- A failure on something you did not touch: render it again first. Still failing: check whether it also
  fails on unchanged `<main>`, which makes it stale, not yours.
- A gate you could not run is owed: say so at the top of your report, not as a silent skip.
- The render guard reads command text: a render command quoted inside another program's argument still
  matches, so put such text in a file.

## Perceptual work: what your report holds
- What the source says, and what the candidate now shows for it.
- The sheet paths (reference | before | after) of the 2 to 4 most telling shots.
- Every gate with its result, failures stated plainly; what you assumed and did not measure; what needs a
  person or hardware to check.
- The questions you queued for the owner, and any decision you made that was theirs.
- Run `pl.mjs lint` on the report before you send it.
```

## When the children report

- **Open the sheets yourself.** A child's "matches" is a claim; your own look is the check. Say in your report which sheets you opened and which you did not.
- **Relay verdicts, not numbers:** what the picture shows, classified by the doctrine's verdicts.
- **One queue for the owner.** Every open look question goes on the review page with a recommendation, ordered by what it blocks; build it once when the round pauses, not per child.
- **Surface decisions that were the owner's** at the top of your report, not at the bottom of a list.
- Keep "verified, and how" apart from "the child reports" and from "not verified".
