#!/usr/bin/env node
// One area's part of the plugin's two session commands, alone, for the suites
// that test what a single area says at session start: `node area-session.mjs
// <area>` with one hook payload on stdin.
//
// The plugin speaks through hooks/session-start.mjs (every area's critical
// lines) and hooks/briefing.mjs (every area's migration, then its briefing).
// A suite about one area would have to pick its part out of the others', so
// this runs the same steps for that area only, through the plugin's own
// helper: its migration, its briefing cut to its allowance, its critical
// block, and the once-per-clone question. The two commands themselves are
// tested whole, in critical-context.test.mjs and the hook cases.
//
// Unlike the commands, it does not catch an area's part that fails to load or
// throws: the helper's run() then prints nothing, and the suite sees it.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "../fixtures.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-engineering");
const load = (...rel) => import(pathToFileURL(path.join(PLUGIN, ...rel)).href);
const { BRIEFING_CHARS, answer, clip, criticalLines, migrated, migrationReport, questionFor, readAreas, renderCritical, run } = await load("hooks", "critical-context.mjs");
const area = process.argv[2];

await run(async (payload) => {
  const main = (payload.hook_event_name ?? "SessionStart") !== "SubagentStart";
  const part = main && area in BRIEFING_CHARS ? await load("skills", area, "hooks", "briefing.mjs") : null;
  const report = migrationReport(area, await migrated(part?.migrate, payload));
  const state = answer(payload);
  const said = state.mode !== "none" ? await part?.briefing?.(payload, state) : "";
  return {
    blocks: [
      report.context,
      said ? clip(String(said), BRIEFING_CHARS[area]) : "",
      renderCritical(area, criticalLines(readAreas().find((a) => a.area === area)?.data, state)),
      questionFor(state),
    ],
    message: report.message,
  };
});
