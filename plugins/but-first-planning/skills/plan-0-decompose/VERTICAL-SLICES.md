# Vertical slices (tracer bullets)

The unit of the plan is a **tracer-bullet vertical slice**: a thin cut that goes
end-to-end through every layer the system has, delivering one small piece of
observable behaviour. The name comes from firing a tracer round — it travels the
whole path so you can see exactly where it lands, then you fire more.

## Vertical, not horizontal

A horizontal slice builds one layer across the whole system ("define all the data
types", then "build all the storage", then "wire all the endpoints"). Nothing
works until the last layer lands, integration risk piles up at the end, and no
single issue is verifiable on its own.

A vertical slice builds a narrow path through *all* the layers at once ("one
event type can be submitted, stored, and read back"). It's small but complete:
schema + logic + interface + a test, just for that one path. The next slice adds
the next path.

```
Horizontal (avoid)            Vertical (prefer)
┌───────────────┐             ┌──┐ ┌──┐ ┌──┐
│ all interfaces│             │  │ │  │ │  │   each slice cuts
├───────────────┤             │  │ │  │ │  │   top-to-bottom
│ all logic     │             │  │ │  │ │  │
├───────────────┤             │  │ │  │ │  │
│ all storage   │             └──┘ └──┘ └──┘
└───────────────┘              s1   s2   s3
```

## Rules for a good slice

- **Complete path.** It touches every layer the behaviour needs — not "the storage part of X", but "X, working, narrowly."
- **Verifiable alone.** A finished slice is demoable or has a checkpoint command that passes. If you can't state how you'd verify it in one line, it's not a slice yet.
- **Thin over thick.** Prefer many small slices to a few big ones. "User can submit one kind of event" beats "the whole event system."
- **Named by observable behaviour.** The title says what becomes true, in the project's glossary terms — not "implement EventManager."

## Good vs. bad titles

| Bad (horizontal / vague) | Good (vertical / observable) |
|--------------------------|------------------------------|
| Build the storage layer | A submitted event is persisted and can be read back by id |
| Implement validation | An event failing validation is rejected with a stated reason |
| Set up the API | The health endpoint returns OK and is covered by a smoke test |
| Refactor the pipeline | The pipeline processes two events in arrival order, verified |

## HITL vs AFK

Tag each slice by who must drive it:

- **AFK** (autonomous) — fully specified; an agent can implement, test, and merge it without a human in the loop. Most slices should be AFK. The acceptance criteria and testing checkpoint must be concrete enough that "done" is unambiguous.
- **HITL** (human-in-the-loop) — needs a human decision, a design review, a credential, or a judgement call mid-flight. Examples: choosing between two viable designs the spec left open, anything that signs off on a security boundary, a slice that needs production access.

Prefer AFK where it's honest. If a slice is only HITL because it's underspecified,
that's a signal to grill the spec (`spec-2-grill`) until it can be AFK — the
planning suite's whole point is to push decisions earlier so the build can run
autonomously.

## Decision issues (routed open questions)

The routing rule itself lives in SKILL.md step 3 ("Route every open question").
The shape that rule produces: a decision issue is `HITL`, titled by the decision
to make, placed in the earliest sprint whose work it gates, blocking the issues
that need the answer — and its acceptance criteria are decision-shaped ("an ADR
records the choice and the spec note is updated"), not code-shaped. Example of
builder latitude (the other route): "pick any stable sort" is an inline note in
the implementing issue, not an issue of its own.

## Sizing and dependencies

- A slice should be completable in one focused sitting. If it sprawls, split it along the next natural seam (often the seams `spec-3-architect` already named).
- Order within a sprint by `Blocked by` only where a real dependency exists; otherwise issues are parallelizable, which lets multiple contributors (or agents) grab them at once.
- The first slice of a system is often a "walking skeleton": the thinnest possible end-to-end path (one input in, one output out, one test green) that every later slice extends.
