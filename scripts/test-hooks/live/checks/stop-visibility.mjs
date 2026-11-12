// What a Stop hook finds is for the agent to act on. Output that reaches only
// the person (a systemMessage) is a warning the model never reads, so the
// turn ends with the problem still there.
export default {
  name: "a Stop hook's findings reach the model, not only the person",
  check({ run }) {
    const failures = [];
    for (const [kind, { measure }] of Object.entries(run.fixtures)) {
      for (const [plugin, seen] of Object.entries(measure.stop)) {
        if (seen.person > 0 && seen.model === 0) failures.push(`${kind}: ${plugin}'s Stop output reached the person only`);
      }
    }
    return failures;
  },
};
