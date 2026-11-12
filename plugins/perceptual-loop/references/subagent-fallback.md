# The blind second look without the Workflow tool

`skills/judge-and-queue/workflows/critique.js` runs a critic per comparison and a skeptic per finding, and keeps the key in the script. A host without the Workflow tool does the same steps by hand. What must not change is the blinding: the critic sees the neutral pictures and the observables, and nothing about what was changed, what was meant, or which letter is which.

## With a subagent tool (the Agent tool in Claude Code)

1. **Blind each comparison.** `node "<plugin root>/scripts/pl.mjs" blind --id <shot> --before <file> --after <file> [--reference <file>] --json`. Keep the printed `aIs` to yourself.
2. **One critic per comparison.** Dispatch the `perceptual-loop:vision-critic` agent with a prompt that holds only:
   - the picture paths, labelled `A`, `B`, and `R`;
   - the observables from the success file, as questions;
   - the box to attend to, if any;
   - the plugin root, for its one crop command.

   Ask for the observables table, the defects, the differences with the more plausible side, and what it could not judge. Never put the key, your verdicts, or the change in the prompt. Several comparisons may go out at once.
3. **One skeptic per finding.** For each defect, and each difference the critic ranked, dispatch the same agent again: "A critic claims this about a picture. Try to refute it by looking yourself: answer refuted unless you can clearly see it", then the claim and the picture paths. Drop what it refutes. Keep a finding whose skeptic failed, marked not verified.
4. **Translate, and only now.** With the key (`pl.mjs blind reveal <id>`), turn A and B back into before and after: a defect is on a side; a difference names the side that is more plausible. Keep the differences nobody could rank.

## With no subagents at all

The builder cannot be blind to its own change, so do not pretend to be. Make the triptych of the neutral copies (`pl.mjs sheet triptych A.png B.png R.png`), write down what you see per observable before you reveal the key, and queue the comparison for the owner (`pl.mjs review add ... --compare`) with your reading and your recommendation. Say in the report that the second look was the owner's, not an independent critic's.

## Either way

Report how many comparisons were critiqued and how many were not, how many findings were refuted, how many could not be verified, and every disagreement with your own verdicts: resolved by a second look, or queued for the owner.
