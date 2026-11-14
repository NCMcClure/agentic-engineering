#!/usr/bin/env node
// The live check: lints what Miro actually drew, after a publish.
//
// Usage:
//   node live.mjs prepare [--config <miro.config.mjs>]
//     copies board-dump.js into the project's miro/ directory and prints, as JSON, the
//     board URL and the two evaluate_script paths: sourcePath (that copy) and filePath
//     (miro/live-dump.json). The chrome-devtools server reads and writes only inside the
//     workspace it was given, which a plugin install is not, hence the copy.
//   node live.mjs check [--config <miro.config.mjs>] [--frames a,b] [--verbose]
//     lints miro/live-dump.json; exit 1 on any finding, 2 when there is no dump.

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { lint, liveModel, report } from "./lint.mjs";
import { flag, list, loadProject } from "./project.mjs";

const argv = process.argv;
const P = await loadProject(argv);
const dump = path.join(P.out, "live-dump.json");

if (argv[2] === "prepare") {
  const sourcePath = path.join(P.out, "board-dump.js");
  copyFileSync(path.join(import.meta.dirname, "..", "assets", "board-dump.js"), sourcePath);
  console.log(JSON.stringify({ board: P.board.url, sourcePath, filePath: dump }, null, 2));
} else if (argv[2] === "check") {
  if (!existsSync(dump)) {
    console.error(`no dump at ${dump}: run live.mjs prepare, then evaluate_script on the board tab`);
    process.exitCode = 2;
  } else {
    const frameIds = Object.fromEntries(Object.entries(P.board.frames).map(([k, f]) => [k, f.id]));
    const only = list(argv, "--frames").length ? list(argv, "--frames") : Object.keys(frameIds);
    const findings = lint(liveModel(JSON.parse(readFileSync(dump, "utf8")), frameIds)).filter((f) => only.includes(f.frame) || f.frame === "board");
    console.log(report(findings, only, { verbose: flag(argv, "--verbose") }));
    console.log(findings.length ? `${findings.length} legibility finding(s) on the live board` : "live board legible: no findings");
    process.exitCode = findings.length ? 1 : 0;
  }
} else {
  console.error("usage: live.mjs prepare | check [--frames a,b] [--verbose]");
  process.exitCode = 2;
}
