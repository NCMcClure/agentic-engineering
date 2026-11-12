# The live lane

Any repo that calls a model ships a live lane: the same code path production uses, against a real model, opt-in, cheap, and structural.

## Opt-in and credentials

```
RUN_LIVE_TESTS=1 npm run test:live
```

The provider and its credentials come from the same `.env` the runtime reads. The lane never holds, prints, or logs a token; it asks the runtime for one the way production does. A suite gated on the flag (`describe.skipIf(!LIVE)`, or node:test's `skip` option) keeps it out of every other run, and CI never sets the flag.

## Cheap by construction

Three settings, all in one helper so no test sets them itself:

- the cheapest model the provider offers, unless an environment variable names another,
- a per-turn budget in dollars, read from an environment variable with a low default (0.15 works),
- a turn cap and a wall-clock timeout, because a loop that will not terminate is exactly the failure this lane exists to catch.

Read the cost off each turn's completion event and print the total at the end of the run. A lane whose cost nobody can see is a lane nobody will run.

## Structural assertions only

Assert on what happened, never on what the model said:

- a commit landed, or nothing landed;
- a maintainer's request wrote a file and a reader's identical request did not;
- both users' turns completed and each reported a cost;
- the tool the turn needed was called at all.

Never assert on wording, ordering of prose, or the presence of a phrase. Those assertions fail on a model upgrade, which trains everyone to skip the lane.

## The shape

One helper builds the world (`liveWorld`), the tests use it, and the helper is the only file that knows about providers, budgets, and models. When the model changes, one file changes.

```ts
export const LIVE = process.env.RUN_LIVE_TESTS === "1";
describe.skipIf(!LIVE)("live multi-user inference", () => { /* ... */ });
```

Record the command as the `live` lane in `.agents/manifest.json`, so it is run by name like the others.

## When to run it

Before a release, after any change to a prompt, a tool description, or a model pin, and when a dependency that touches the agent loop is upgraded. Compare cost and latency against the previous run; a prompt change that doubles the cost is a finding even when every assertion still passes.
