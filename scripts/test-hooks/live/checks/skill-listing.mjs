// Claude Code drops the descriptions of the least-used skills when the whole
// listing is over its budget, and a skill listed by name alone is one the
// model cannot choose. The plugin lists eleven: the entry skill and an
// area each, and an area's description is the only place its routes show. So
// none may be in that state on a fresh session. A row is an area's, or the
// plugin's for the entry skill (measure.mjs listing).
export default {
  name: "the entry skill and every area are listed with their descriptions",
  check({ run }) {
    const failures = [];
    for (const [kind, { measure }] of Object.entries(run.fixtures)) {
      for (const [owner, row] of Object.entries(measure.skills)) {
        if (row.bare > 0) failures.push(`${kind}: ${owner} is listed without its description`);
      }
    }
    return failures;
  },
};
