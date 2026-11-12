// Every plugin's critical lines, from its own hook. Where the repo's mode
// speaks, each plugin with an unconditional line for that mode opens every
// segment of the main session with its block, model-visible, and the block is
// still there after the compaction; the shared first line appears exactly
// once in each run of the start hooks; a general-purpose subagent gets the lines marked
// for it. Where the mode is none, nobody prints a block. Presence only, never
// wording: a block is found by its "Critical, from <plugin>:" header.
import fs from "node:fs";
import path from "node:path";
import { SHARED_LINE } from "../../../shared/critical-context.mjs";
import { MODES } from "../../fixtures.mjs";

const PLUGINS = path.resolve(import.meta.dirname, "..", "..", "..", "..", "plugins");
const data = (plugin) => { try { return JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, "hooks", "critical.json"), "utf8")); } catch { return null; } };
const critical = () => fs.readdirSync(PLUGINS).map(data).filter(Boolean);

/** The plugins that must speak: a line with no `when` for this audience and mode. Lines gated on a file only add. */
export function speakers(mode, subagent) {
  if (mode === "none") return [];
  const fits = (l) => !l.when && (l.mode === "any" || l.mode === mode) && (l.for === "all" || !subagent);
  return critical().filter((d) => [...(d.lines ?? []), ...(d.chains ?? [])].some(fits)).map((d) => d.plugin).sort();
}

const header = (plugin) => `Critical, from ${plugin}:`;
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
    for (const plugin of want) {
      if (!seen.some((e) => String(e.text).includes(header(plugin)))) failures.push(`${kind}: ${plugin}'s critical lines are missing from segment ${segment}'s start`);
    }
    if (!want.length && seen.some((e) => String(e.text).includes("Critical, from "))) failures.push(`${kind}: nobody should speak here, yet critical lines were printed at segment ${segment}'s start`);
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
    for (const plugin of want) {
      if (!seen.some((e) => String(e.text).includes(header(plugin)))) failures.push(`${kind}: general-purpose got no critical lines from ${plugin}`);
    }
    if (!want.length && seen.some((e) => String(e.text).includes("Critical, from "))) failures.push(`${kind}: nobody should speak here, yet general-purpose got critical lines`);
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
