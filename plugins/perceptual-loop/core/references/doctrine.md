# The doctrine

The rules every perceptual-loop skill applies. Each was paid for: the note under it says what went wrong without it.

## 1. The reference is a reference, not the ceiling

The candidate does not have to equal the reference, and often should not. A reference is itself a rendering, a
recording or a mock, with its own approximations. Match **what the scene is** (the right content, the right kind and
colour of material, the right light, the thing present and in the right place, the right moment). Do not degrade the
candidate, add a hack or re-tune a constant only to move a number towards the reference.

*Without it:* an agent re-tuned paint to match the reference's post-processing; the asset's own colour was right.

## 2. A metric that moved is not a verdict

A number says the outputs differ, and by how much. It does not say which one is right. Never write "worse",
"regressed" or "degraded" because a metric against the reference moved. Say what changed in the picture, look at it,
and give a **verdict** from this list, with the evidence:

| Verdict | Meaning | Work to do? |
|---|---|---|
| `wrong` | The candidate misrepresents the asset or the scene: something missing, wrong content, wrong colour of the thing itself, black or blown-out areas, an artefact | yes |
| `less-plausible` | Not wrong by any source, but a person would believe the reference more | yes, or ask the owner |
| `more-correct` | The candidate is nearer the truth than the reference (physically, or to the source asset) | no: record why |
| `different-ok` | A difference of approach with no better side | no |
| `noise` | The run-to-run spread of an unchanged candidate | no: measure it, do not accept it |
| `stale` | The baseline was already off before this work (reproduces on the unchanged main branch) | no: say so, update separately |

*Without it:* blurred wheel rims were reported "worse" from SSIM; the owner found them better lit than the reference.

## 3. Go to the source before calling a difference a defect

When a colour, brightness, shape or timing differs, establish three things in this order: **what the source says**
(the asset's own values, the spec, the design token, the recorded signal), **what the candidate presents for it**
(an unlit/albedo pass, a value read back, a probe), and **why the reference differs** (its grading, its shading, its
age). Fix the candidate only where it misrepresents the source.

## 4. Measure the reference system; do not fit pictures

Where the reference is a running system, read its truth out with a probe (a value read back per frame, a log line, a
file's numbers) and implement the rule it shows. A rule fitted to three pictures breaks on the fourth. A belief that
something "cannot be read" is re-checked before it is relied on: two such beliefs were wrong.

## 5. The gate compares a candidate with itself

Baselines hold the candidate's own accepted numbers; tolerances are **measured** run-to-run spreads with a margin.
The gate answers "did my change move anything I did not mean to move?", never "how close am I to the reference?".
No plan, brief or success definition sets a target against the reference ("within 10 %", "ΔE below 3") for look
work. Targets are about the candidate being right.

## 6. The smallest run that answers the question

| You want to know | Run | When |
|---|---|---|
| Did my change do what I meant? | 1–3 shots that show the thing | every iteration |
| Does it hold on other content? | one topical group, or `smoke` | once, after it works |
| Did I break anything else? | everything | once, when the work is finished |
| Is the new baseline stable? | `smoke` again | once, after accepting |

State which shots prove the change **before** starting, and keep to them. A gate failure on a change that touched no
pixel is noise to measure: run that shot again before anything else. A larger run carries its reason in the command.

*Without it:* full-suite runs inside the loop turned 2-minute iterations into 20-minute ones.

## 7. A still shows only its instant

What depends on history (a trail, a cloud of dust raised a second ago, an adapted exposure, a filter's state) is not
in a still. Make every smoothed or accumulated quantity **settle at once** when time stands still or jumps, so a
shot is a function of its instant alone; verify behaviour over time with a sweep, not with stills.

## 8. The owner's eye decides look questions, in batches

When a look judgement is open, the agent does not decide it with a metric and does not interrupt for it. It prepares
the comparison (reference | before | after), says what differs and why, recommends, queues the question, and goes on
with what does not depend on the answer.

## 9. Reports say what was not done

Every report lists what was verified and how, what was skipped and why, what is assumed and not measured, and what
could not be checked without a person or hardware. A claim of "verified" names its artefact.
