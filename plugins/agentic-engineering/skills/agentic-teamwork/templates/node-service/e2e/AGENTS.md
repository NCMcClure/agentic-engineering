# e2e: the browser lane

A real browser against a server this runner starts itself on port 8090, never the developer's port. That is the one sanctioned exception to the rule that an agent never starts the server: `playwright test` owns the process for the length of the run and stops it after.

Playwright is optional. `run.mjs` reports and exits 0 when it is not installed, so a clone that does not need this lane is not blocked by it.

## Layout

- `tests/` - the specs, one story each. Assertions are on what a person sees.
- `support/` - the harness: `run.mjs` is the entry point and checks for Playwright before running it. Open it when a spec needs a new fixture or helper.
- `playwright.config.mjs` - Chromium, one worker, and the `webServer` block that starts the server.

## Running

```bash
npm --prefix e2e install --save-dev @playwright/test && npx --prefix e2e playwright install chromium
npm --prefix e2e test
```
