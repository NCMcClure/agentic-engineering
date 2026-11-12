// Read-only and single-purpose subagents get no plugin context at their start:
// a search agent has no use for the build rules, and a blind critic must not
// be told what it is judging.
const QUIET = new Set(["Explore", "Plan", "perceptual-loop:vision-critic"]);

export default {
  name: "search agents and the blind critic start without plugin context",
  check({ run }) {
    const failures = new Set();
    for (const [kind, { subagents }] of Object.entries(run.fixtures)) {
      for (const { agentType, report } of subagents) {
        if (!QUIET.has(agentType)) continue;
        for (const e of report.events) {
          if (e.kind === "hook" && e.event === "SubagentStart" && e.visibility === "model" && e.source?.focus) failures.add(`${kind}: ${agentType} got SubagentStart context from ${e.source.plugin}`);
        }
      }
    }
    return [...failures];
  },
};
