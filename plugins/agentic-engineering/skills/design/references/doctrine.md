# The doctrine

The rules every perceptual-loop skill applies. Each one answers a way look work goes wrong when an agent does it alone.

## 1. The reference is a reference, not the target

The candidate does not have to equal the reference, and often should not: a reference is itself a rendering, a recording, or a mock, with approximations of its own. Match what the scene is (the right content, the right material and its colour, the right light, the thing present and in its place, the right moment). Do not degrade the candidate, add a special case, or retune a constant only to move a number toward the reference.

## 2. A metric that moved is not a verdict

A number says two outputs differ, and by how much. It does not say which one is right. Never write "worse", "regressed", or "degraded" because a metric against the reference moved. Say what changed in the picture, look at it, and give one of these verdicts, with the evidence:

| Verdict | Meaning | Work to do |
| --- | --- | --- |
| `wrong` | The candidate misrepresents the asset or the scene: something missing, the wrong content, the wrong colour of the thing itself, crushed or blown areas, an artefact | yes |
| `less-plausible` | Wrong by no source, but a person would believe the reference more | yes, or ask the owner |
| `more-correct` | The candidate is nearer the truth than the reference, physically or to the source asset | no: record why |
| `different-ok` | A difference of approach with no better side | no |
| `noise` | The run-to-run spread of an unchanged candidate | no: measure it, do not accept it |
| `stale` | The baseline was already off before this work: it reproduces on the unchanged main branch | no: say so, and update it in a separate step |

## 3. Go to the source before calling a difference a defect

When a colour, a brightness, a shape, or a timing differs, establish three things in this order: what the source says (the asset's own values, the spec, the design token, the recorded signal), what the candidate presents for it (an unlit pass, a value read back, a probe), and why the reference differs (its grading, its shading, its age). Fix the candidate only where it misrepresents the source.

## 4. Measure the reference system; do not fit pictures

Where the reference is a running system, read its truth out with a probe (a value read back per frame, a log line, a file's numbers) and implement the rule it shows. A rule fitted to three pictures breaks on the fourth. A belief that something cannot be read is checked again before anything relies on it.

## 5. The gate compares a candidate with itself

The baseline holds the candidate's own accepted numbers, and the tolerances are measured run-to-run spreads with a margin. The gate answers "did this change move anything I did not mean to move?", never "how close am I to the reference?". No plan, brief, or success file sets a target against the reference ("within 10 %", "a delta E below 3") for look work. Targets are about the candidate being right.

## 6. The smallest run that answers the question

| You want to know | Run | When |
| --- | --- | --- |
| Did the change do what I meant? | the 1 to 3 shots that show the thing | every iteration |
| Does it hold on other content? | one topical group, or `smoke` | once, after it works |
| Did I break anything else? | everything | once, when the work is finished |
| Is the new baseline stable? | `smoke` again | once, after accepting |

Name the shots that prove the change before starting, and keep to them. A gate failure on a change that touched no pixel is noise to measure: render that shot again before anything else. A larger run states its reason in the command, where the owner sees it.

## 7. A still shows only its instant

What depends on history (a trail, a cloud raised a second ago, an adapted exposure, a filter's state) is not in a still. Make every smoothed or accumulated quantity settle at once when time stands still or jumps, so a shot is a function of its instant alone, and check behaviour over time with a sequence, never with stills.

## 8. The owner's eye decides look questions, in batches

When a look judgement is open, the agent neither decides it with a metric nor interrupts for it. It prepares the comparison (reference, before, after), says what differs and why, recommends, records the question, and goes on with whatever does not depend on the answer.

## 9. Reports say what was not done

Every report lists what was verified and how, what was skipped and why, what is assumed and not measured, and what could not be checked without a person or hardware. A claim of "verified" names its artefact: the run, the shot, the picture.
