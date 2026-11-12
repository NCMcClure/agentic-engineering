# The integration lane

Tests here talk to something real inside the process: a database, the filesystem, an HTTP service. They are gated on an environment flag so a laptop without Docker still passes the unit lane:

```js
const RUN = process.env.RUN_DB_TESTS === "1";
describe("the store", { skip: !RUN && "RUN_DB_TESTS is not 1" }, () => { /* ... */ });
```

Start what they need first (`docker compose up -d postgres`), then `RUN_DB_TESTS=1 npm --prefix server run test:integration`.

`database.test.mjs` ships with the template so the lane has something to run from day one. It only checks that the configured database answers; replace it with a real store test once there is a store.

A skipped lane must be visible in the output: the `skip` reason prints with the suite. A silent skip is how a suite reports green for months without running.

CI runs the unit lane only. To run this one there, give the CI gate a database service and a job that sets `RUN_DB_TESTS=1`.
