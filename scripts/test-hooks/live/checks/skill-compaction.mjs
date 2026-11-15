// A skill in use comes back after a compaction. One session works inside a
// skill, compacts, and carries on (session.mjs runSkillSession); afterwards
// the skill's instructions have to be in the context again: the invoked skill
// re-attached by the host, the file the session read restored by the host, or
// the skill opened again by the session (reach.mjs acrossCompaction).
// Presence only: a session can answer well from the compaction summary and
// still have lost the instructions. checks/compaction.mjs holds the other
// half, what a hook and a rule file bring back.
export default {
  name: "compaction keeps the skill in use",
  part: "skills",
  check({ run }) {
    const skill = run.skills?.compaction;
    // --only left the fixture the skill session runs in out of this run.
    if (!skill && run.skills?.partial) return [];
    if (!skill) return ["skill session: it did not run, so nothing was checked"];
    if (!skill.compacted) return ["skill session: no compaction recorded, so nothing was checked"];
    if (!skill.before) return [`skill session: ${skill.skill} was never reached before the compaction, so nothing was checked`];
    if (!skill.kept) return [`skill session: ${skill.skill} was lost at the compaction: not re-attached, not restored, and not read again`];
    return [];
  },
};
