# server: the runtime

Everything that runs in production. Node 22, ESM, no build step, no dependencies; `src/app/main.mjs` is the only file that reads the environment and binds a port.

## Layout

- `src/` - the runtime. `config.mjs` is the one place environment variables are read, `http/` holds the request surface as a plain handler so a test can call it without a port, `app/main.mjs` is the composition root. Open it to change behavior.
- `test/` - the lanes: `unit/` (pure logic, always run) and `integration/` (real services, gated on a flag). Open it to add a test.
- `package.json` / `package-lock.json` - the scripts each lane is run by, and the lockfile `npm ci` needs once the first dependency arrives.

## Running

```bash
npm --prefix server test                                   # unit
RUN_DB_TESTS=1 npm --prefix server run test:integration    # integration, with the database up
```

Do not start the server to make a test pass. The e2e runner starts it on its own port and stops it after.
