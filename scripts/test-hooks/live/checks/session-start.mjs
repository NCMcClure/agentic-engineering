// An area a repo has adopted tells the session so: at the start, and again
// when a compaction opens a new segment. An area that stays silent leaves its
// rules to chance: the model follows them only if it happens to call the
// right area.
//
// The plugin speaks through one command for every area, so who spoke is read
// from inside its output: the lens splits it into a block per area by the
// heading each block opens with (`blocks`, each with its `owner`), and a
// hook an area still runs of its own is that area's by its path.
//
// After a compaction only the hook run the compaction itself triggers counts
// (SessionStart:compact). The lane resumes the session for its next prompt,
// and that resume fires SessionStart again, which would hide a command whose
// matcher leaves `compact` out: in a session nobody resumes, the model would
// work on without that area's context.
import { adopted } from "../../fixtures.mjs";

const from = (e, area) => e.source?.area === area || (e.blocks ?? []).some((b) => b.owner === area);
const spoke = (events, segment, area, source) => events.some((e) => e.kind === "hook" && e.event === "SessionStart" && e.segment === segment
  && e.phase === "start" && e.visibility === "model" && (!source || e.hookName === `SessionStart:${source}`) && from(e, area));

export default {
  name: "every adopted area speaks to the model at the start and at each compaction",
  check({ run }) {
    const failures = [];
    for (const [kind, { main }] of Object.entries(run.fixtures)) {
      for (const area of adopted(kind)) {
        for (const { index, startedBy } of main.segments) {
          const compacted = startedBy === "compact";
          if (spoke(main.events, index, area, compacted ? "compact" : null)) continue;
          failures.push(compacted ? `${kind}: ${area} said nothing to the model when a compaction opened segment ${index}` : `${kind}: ${area} said nothing to the model at the start of segment ${index}`);
        }
      }
    }
    return failures;
  },
};
