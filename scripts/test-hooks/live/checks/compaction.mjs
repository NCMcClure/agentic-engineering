// What a compaction must bring back. Every fixture compacts once; a plugin's
// SessionStart channel and each rule file the repo imports are standing
// context, and must not be "lost" (a request went out without them).
export default {
  name: "a compaction keeps each plugin's SessionStart context and the repo's rules",
  check({ run }) {
    const failures = [];
    for (const [kind, { measure }] of Object.entries(run.fixtures)) {
      if (measure.afterCompaction === null) { failures.push(`${kind}: no compaction recorded, so nothing was checked`); continue; }
      for (const [label, status] of Object.entries(measure.compaction)) {
        const watched = label.startsWith("SessionStart · ") || /^instructions · \.(agents|claude)\/rules\//.test(label);
        if (watched && status === "lost") failures.push(`${kind}: ${label} was lost at compaction`);
      }
    }
    return failures;
  },
};
