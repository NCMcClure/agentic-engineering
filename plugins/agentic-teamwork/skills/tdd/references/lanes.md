# The four lanes

A lane is a selection of tests plus the environment they need. Keeping them separate is what lets a laptop without Docker run the fast ones and CI run all of them.

| Lane | Selects | Needs | Runs in CI | A typical command |
| --- | --- | --- | --- | --- |
| unit | pure logic, no I/O | nothing | always | `npm test` |
| integration | a real database, filesystem, or in-process HTTP | Docker, or the service running | once CI has the service | `RUN_DB_TESTS=1 npm run test:integration` |
| e2e | a browser against a built server | the built server and browser binaries | on change requests | `npx playwright test` |
| live | a real model behind the same code path production uses | credentials for the model | never; opt-in only | `RUN_LIVE_TESTS=1 npm run test:live` |

The real commands for a repo are `lanes` in its `.agents/manifest.json`. If they disagree with this table, the marker wins. A lane whose command starts with `not wired` has nothing to run yet, and says why.

## What makes a test worth keeping, in any lane

A good test exercises the code through its public interface and asserts on what a caller or a user can observe. It describes what the system does, not how, so it survives a refactor that changes no behavior.

```ts
// good: observable behavior, through the interface a caller uses
test("user can check out with a valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});

// bad: the implementation, restated
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Red flags, each a test coupled to structure instead of behavior:

- it mocks an internal collaborator, or tests a private method;
- it asserts on call counts or call order;
- its name says how ("calls X") rather than what ("can check out");
- it breaks when the code is refactored and the behavior is not;
- it checks the result by reaching around the interface (`mocking.md` has the example).

## Opt-in by environment flag, not by directory alone

A lane that needs something the laptop may not have is gated on an environment variable read at collection time, so the suite skips rather than fails:

```ts
const RUN = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!RUN)("the queue", () => { /* ... */ });
// node:test: describe("the queue", { skip: !RUN && "RUN_DB_TESTS is not 1" }, () => { /* ... */ });
```

A skipped lane must be visible in the output. A silent skip is how a suite reports green for months without ever running.

## The server rule

Only the e2e runner starts the server, and it starts it on its own port, not the developer's. An agent never runs `npm run dev` or its equivalent to make a test pass: that binds the port the person is using and the failure looks like a bug in their machine. Backing services (`docker compose up -d postgres`) are fine to start.

## Coverage

Coverage is a lane setting, not a separate suite: a run that reports no coverage table produced no coverage evidence, whatever else it printed. A failing test run exits before the table prints, so "no uncovered lines" and "the run died" look identical. Read the table, never the absence of a line.

## What a lane is not for

An e2e test that could have been a unit test costs a minute per run forever. Push every check to the cheapest lane that can still fail for the right reason, and keep the expensive lanes for the things only they can see: a real query planner, a real browser, a real model.
