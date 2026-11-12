// No hook of ours fails. A hook that errors is one whose guard did not run:
// the session carries on without it and nothing says so to the model. A hook
// no plugin claimed counts too, since the fixtures configure none of their own.
const failed = (report) => report.events.filter((e) => e.kind === "hook" && e.visibility === "error" && (e.source?.focus || !e.source?.plugin));

export default {
  name: "no plugin hook fails",
  check({ run }) {
    const failures = new Set();
    for (const [kind, fixture] of Object.entries(run.fixtures)) {
      for (const e of failed(fixture.main)) failures.add(`${kind}: a ${e.event} hook failed (${e.source.plugin ?? "unattributed"})`);
      for (const { agentType, report } of fixture.subagents) {
        for (const e of failed(report)) failures.add(`${kind}: a ${e.event} hook failed in ${agentType} (${e.source.plugin ?? "unattributed"})`);
      }
    }
    return [...failures];
  },
};
