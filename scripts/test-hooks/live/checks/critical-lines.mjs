// Every area's critical lines, from the plugin's one lines command. Where the
// repo's mode speaks, each area with an unconditional line for that mode has
// its block in what opens every segment of the main session, model-visible,
// and the block is still there after the compaction; the shared first line
// appears exactly once in each run of the start hooks; a general-purpose
// subagent gets the lines marked for it. Where the mode is none, no block is
// printed. Presence only, never wording: a block is found inside the
// command's output by its "Critical, from <area>:" header.
import { SHARED_LINE, readAreas } from "../../../../plugins/agentic-engineering/hooks/critical-context.mjs";
import { MODES } from "../../fixtures.mjs";

/** The areas whose block must print: a line with no `when` for this audience and mode. Lines gated on a file only add. */
export function speakers(mode, subagent) {
  if (mode === "none") return [];
  const fits = (l) => !l.when && (l.mode === "any" || l.mode === mode) && (l.for === "all" || !subagent);
  return readAreas().filter(({ data }) => (data?.lines ?? []).some(fits)).map(({ area }) => area).sort();
}

const header = (area) => `Critical, from ${area}:`;
const hooks = (events, event, segment) => events.filter((e) => e.kind === "hook" && e.event === event && e.segment === segment
  && e.phase === "start" && e.visibility === "model");
/**
 * How often a text appears in each run of a segment's start hooks. A session
 * that is resumed runs them again in the same segment, and each run is counted
 * on its own: two runs that each print the line once are not a line printed twice.
 */
function perRun(events, segment, text) {
  const runs = new Map();
  for (const e of hooks(events, "SessionStart", segment)) runs.set(e.hookName, (runs.get(e.hookName) ?? 0) + String(e.text ?? "").split(text).length - 1);
  return [...runs.values()];
}

function checkMain(kind, mode, { main }, failures) {
  const want = speakers(mode, false);
  for (const segment of main.segments.map((s) => s.index)) {
    const seen = hooks(main.events, "SessionStart", segment);
    for (const area of want) {
      if (!seen.some((e) => String(e.text).includes(header(area)))) failures.push(`${kind}: ${area}'s critical lines are missing from segment ${segment}'s start`);
    }
    if (!want.length && seen.some((e) => String(e.text).includes("Critical, from "))) failures.push(`${kind}: no area should speak here, yet critical lines were printed at segment ${segment}'s start`);
    const shared = perRun(main.events, segment, SHARED_LINE);
    const most = Math.max(0, ...shared);
    if (most !== (want.length ? 1 : 0)) failures.push(`${kind}: the shared line appears ${most} times in one run of segment ${segment}'s start hooks, want ${want.length ? 1 : 0}`);
  }
}

function checkSubagents(kind, mode, { subagents }, failures) {
  const want = speakers(mode, true);
  for (const { agentType, report } of subagents) {
    if (agentType !== "general-purpose") continue;
    const seen = hooks(report.events, "SubagentStart", 0);
    for (const area of want) {
      if (!seen.some((e) => String(e.text).includes(header(area)))) failures.push(`${kind}: general-purpose got no critical lines from ${area}`);
    }
    if (!want.length && seen.some((e) => String(e.text).includes("Critical, from "))) failures.push(`${kind}: no area should speak here, yet general-purpose got critical lines`);
  }
}

export default {
  name: "critical lines open every segment where the repo opted in, and nowhere else",
  check({ run }) {
    const failures = [];
    for (const [kind, fixture] of Object.entries(run.fixtures)) {
      const mode = MODES[kind];
      if (!mode) continue;
      checkMain(kind, mode, fixture, failures);
      checkSubagents(kind, mode, fixture, failures);
    }
    return failures;
  },
};
