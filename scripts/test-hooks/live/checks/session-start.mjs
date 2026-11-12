// A plugin a repo has adopted tells the session so: at the start, and again
// when a compaction opens a new segment. A plugin that stays silent leaves its
// rules to chance: the model follows them only if it happens to load the
// right skill.
//
// After a compaction only the hook run the compaction itself triggers counts
// (SessionStart:compact). The lane resumes the session for its next prompt,
// and that resume fires SessionStart again, which would hide a hook whose
// matcher leaves `compact` out: in a session nobody resumes, the model would
// work on without that plugin's context.
import { adopted } from "../../fixtures.mjs";

const spoke = (events, segment, plugin, source) => events.some((e) => e.kind === "hook" && e.event === "SessionStart" && e.segment === segment
  && e.phase === "start" && e.visibility === "model" && (!source || e.hookName === `SessionStart:${source}`)
  && String(e.source?.plugin ?? "").split(" or ").includes(plugin));

export default {
  name: "every adopted plugin speaks to the model at the start and at each compaction",
  check({ run }) {
    const failures = [];
    for (const [kind, { main }] of Object.entries(run.fixtures)) {
      for (const plugin of adopted(kind)) {
        for (const { index, startedBy } of main.segments) {
          const compacted = startedBy === "compact";
          if (spoke(main.events, index, plugin, compacted ? "compact" : null)) continue;
          failures.push(compacted ? `${kind}: ${plugin} said nothing to the model when a compaction opened segment ${index}` : `${kind}: ${plugin} said nothing to the model at the start of segment ${index}`);
        }
      }
    }
    return failures;
  },
};
