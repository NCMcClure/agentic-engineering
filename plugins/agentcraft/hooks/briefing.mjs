#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact), main session only: what an
// area has to say about this repo before the work starts, each area in turn.
//
// First, each area's migration, whatever the repo's mode: a layout that moved
// is moved now, through a `move` and a `write` that never overwrite, and what
// moved is told to the model and to the person. Then, where the repo has
// opted in, each area's briefing: the lanes and what is stale, the board or
// the card this session works, plan scripts that fell behind, a docs config
// that does not parse, the perceptual harness, a machine that cannot run the
// live Miro check. Last, a line when an installed copy is behind the catalog.
// An area with nothing to say says nothing, and with none the hook is silent.
//
// An area's part is `skills/<area>/hooks/briefing.mjs`, exporting `briefing`
// and, where its layout has moved, `migrate`. Each is loaded on its own, so
// one that fails to load costs only its own part.
//
// The critical lines are session-start.mjs, a command of its own, so each
// stays under the 10,000 characters a host shows the model in full: every
// part here is cut to its allowance (critical-context.mjs), and the gate
// holds their sum under that.
//
// Fail open, always exit 0.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BRIEFING_CHARS, MIGRATION_CHARS, answer, catalogNotice, clip, migrated, migrationReport, run } from "./critical-context.mjs";

const partOf = async (area) => {
  try { return await import(pathToFileURL(path.join(import.meta.dirname, "..", "skills", area, "hooks", "briefing.mjs")).href); } catch { return null; }
};

await run(async (payload) => {
  if ((payload.hook_event_name ?? "SessionStart") === "SubagentStart") return [];
  const parts = [];
  for (const area of Object.keys(BRIEFING_CHARS)) parts.push({ area, part: await partOf(area) });

  // Before the state is read: a migration can create the marker the mode turns on.
  const blocks = [], messages = [];
  let left = MIGRATION_CHARS;
  for (const { area, part } of parts) {
    const report = migrationReport(area, await migrated(part?.migrate, payload));
    if (report.message) messages.push(report.message);
    if (!report.context || left <= 0) continue;
    const text = clip(report.context, left);
    blocks.push(text);
    left -= text.length;
  }

  const state = answer(payload);
  if (state.mode !== "none") {
    for (const { area, part } of parts) {
      try {
        const text = await part?.briefing?.(payload, state);
        if (text) blocks.push(clip(String(text), BRIEFING_CHARS[area]));
      } catch { /* the other areas still speak */ }
    }
    blocks.push(catalogNotice());
  }
  return { blocks, message: messages.join(" ") };
});
