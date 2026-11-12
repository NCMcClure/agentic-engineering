// Claude Code drops the descriptions of the least-used skills when the whole
// listing is over its budget, and a skill listed by name alone is one the
// model cannot choose. None of ours may be in that state on a fresh session.
export default {
  name: "every plugin skill is listed with its description",
  check({ run }) {
    const failures = [];
    for (const [kind, { measure }] of Object.entries(run.fixtures)) {
      for (const [plugin, row] of Object.entries(measure.skills)) {
        if (row.bare > 0) failures.push(`${kind}: ${plugin} has skills listed without a description`);
      }
    }
    return failures;
  },
};
