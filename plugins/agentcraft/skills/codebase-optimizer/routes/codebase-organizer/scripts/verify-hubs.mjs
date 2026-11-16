#!/usr/bin/env node
// The hub checker, run from this route by its own path. The checker itself is
// the plugin's one copy, lib/verify-hubs.mjs at the plugin's root; this file
// hands over to it, so the route, its workflows, and verify-structure.mjs
// beside it keep naming a file that is here.
//
// CLI:  node verify-hubs.mjs [dir] [--json] [--require-hubs]
import fs from "node:fs";
import { main } from "../../../../../lib/verify-hubs.mjs";

export * from "../../../../../lib/verify-hubs.mjs";

const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(import.meta.filename); } catch { return false; } })();
if (invoked) process.exitCode = main();
