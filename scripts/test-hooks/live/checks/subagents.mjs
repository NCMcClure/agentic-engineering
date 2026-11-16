// Read-only and single-purpose subagents get no plugin context at their start:
// a search agent has no use for the build rules, and a blind critic must not
// be told what it is judging. The critic is the plugin's own agent, which the
// host names by the plugin.
import { SUBAGENTS } from "../session.mjs";

const CRITIC = SUBAGENTS.find((type) => type.endsWith(":vision-critic"));
const QUIET = new Set(["Explore", "Plan", CRITIC]);

export default {
  name: "search agents and the blind critic start without plugin context",
  check({ run }) {
    const failures = new Set();
    for (const [kind, { subagents }] of Object.entries(run.fixtures)) {
      for (const { agentType, report } of subagents) {
        if (!QUIET.has(agentType)) continue;
        for (const e of report.events) {
          if (e.kind === "hook" && e.event === "SubagentStart" && e.visibility === "model" && e.source?.focus) failures.add(`${kind}: ${agentType} got SubagentStart context from ${e.source.area ?? e.source.plugin}`);
        }
      }
    }
    return [...failures];
  },
};
