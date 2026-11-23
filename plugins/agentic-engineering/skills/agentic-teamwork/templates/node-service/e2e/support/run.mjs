#!/usr/bin/env node
// The e2e entry point. Playwright is optional: a clone that has not installed
// it reports that and exits 0, rather than failing a lane nobody asked for.
// CI installs it in the e2e job; a laptop installs it when someone needs it.
//
// The check resolves the package from this file rather than asking npx, because
// `npx --no-install playwright` can answer from a cache or a parent directory
// and then fail at the point where it actually needs the local install.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

let manifestPath;
try {
  manifestPath = require.resolve("@playwright/test/package.json");
} catch {
  console.log("e2e: @playwright/test is not installed here. `npm --prefix e2e install --save-dev @playwright/test && npx playwright install chromium`, then re-run.");
  process.exitCode = 0;
  manifestPath = null;
}

if (manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.playwright;
  if (!bin) {
    console.log(`e2e: @playwright/test ${manifest.version} declares no playwright bin; nothing to run.`);
    process.exitCode = 0;
  } else {
    const result = spawnSync(process.execPath, [path.join(path.dirname(manifestPath), bin), "test", ...process.argv.slice(2)], {
      cwd: path.join(import.meta.dirname, ".."),
      stdio: "inherit",
    });
    process.exitCode = result.status ?? 1;
  }
}
