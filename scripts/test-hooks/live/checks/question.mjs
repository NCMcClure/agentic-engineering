// The once-per-clone question. Where nothing settles whether a repo uses the
// plugin (no marker, nothing answered), it opens every segment of the main
// session exactly once, from the plugin's lines command, which is the one
// thing that can ask. Where a marker or an answer settles it, `off` included,
// it never appears, and a subagent is never asked. Matched by its fixed
// opening.
import { PLUGIN } from "../../../../plugins/agentic-engineering/hooks/critical-context.mjs";

const QUESTION = `whether to use the ${PLUGIN} plugin`;
const ASKED = { bare: 1, outside: 1, unplugged: 0, portable: 0, standard: 0, adopted: 0, "teamwork-only": 0 };

// Hook context only: a compaction summary may quote the question back, and
// that is the model's text, not a second asker.
const hits = (events, segment, event) => events.filter((e) => e.segment === segment && e.phase === "start" && e.visibility === "model"
  && e.kind === "hook" && e.event === event && String(e.text ?? "").includes(QUESTION))
  .map((e) => e.source?.area ?? e.source?.plugin ?? "unattributed");

export default {
  name: "the plugin question is asked once where nothing is answered, and never elsewhere",
  check({ run }) {
    const failures = [];
    for (const [kind, want] of Object.entries(ASKED)) {
      const fixture = run.fixtures[kind];
      if (!fixture) continue;
      for (const { index } of fixture.main.segments) {
        const from = hits(fixture.main.events, index, "SessionStart");
        if (from.length !== want) failures.push(`${kind}: the question appears ${from.length} times at segment ${index}'s start, want ${want}${from.length ? `: ${from.join(", ")}` : ""}`);
        // One asker: the plugin's own command, never an area's hook.
        for (const who of from.filter((w) => w !== PLUGIN)) failures.push(`${kind}: the question at segment ${index}'s start came from ${who}; the one asker is ${PLUGIN}'s lines command`);
      }
      for (const { agentType, report } of fixture.subagents) {
        const from = hits(report.events, 0, "SubagentStart");
        if (from.length) failures.push(`${kind}: ${agentType} was asked by ${from.join(", ")}; the question is for the main session only`);
      }
    }
    return failures;
  },
};
