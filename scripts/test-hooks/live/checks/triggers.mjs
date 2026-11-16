// Whether a prompt ends with the right skill in use. Every prompt in
// triggers.mjs runs as its own session at each context window (session.mjs
// WINDOWS; `run.skills.windows` maps each to the size it really had), one pass
// in a plain run and three when a baseline is recorded. reach.mjs says what
// counts as reaching a skill.
//
// One session is one sample, so one flip is not a regression: a prompt fails
// only when the baseline reached it in every pass and this run reached it in
// none, and a plain run that misses such a prompt runs it twice more first
// (measure.mjs suspects), so "none" is three sessions. A prompt the baseline
// reached in some passes, or in none, is in the table and never failed. A
// session that was cut off or errored before it reached anything was not
// measured, which is not a miss; it fails on its own line so the run is
// repeated instead of read. A skill session offered a tool outside its own
// (session.mjs SKILL_TOOLS) fails too: these prompts ask for work with side
// effects.
import { isMeasured, regressions } from "../measure.mjs";

export default {
  name: "each prompt still reaches the skill it reached in every baseline pass",
  part: "skills",
  check({ run, baseline }) {
    const now = run.skills?.triggers;
    if (!now) return ["the trigger sessions did not run, so nothing was measured"];
    const failures = [...(run.skills.unlocked ?? [])];
    const windows = Object.keys(run.skills.windows);
    const regressed = regressions(now, windows, baseline?.skills?.triggers);
    for (const [name, t] of Object.entries(now)) {
      for (const window of windows) {
        const outcomes = [...(t.reached[window] ?? []), ...(t.confirm?.[window] ?? [])];
        const lost = outcomes.filter((o) => !isMeasured(o));
        const gone = regressed.find((r) => r.name === name && r.window === window);
        if (!outcomes.length) failures.push(`${name} at ${window}: no session ran, so nothing was measured`);
        else if (lost.length) failures.push(`${name} at ${window}: ${lost.length} of ${outcomes.length} sessions not measured (${[...new Set(lost)].join(", ")}), which is not a miss; run it again`);
        else if (gone) failures.push(`${name} at ${window}: reached ${t.skill} in every baseline pass (${gone.was}) and in none of ${gone.now} now`);
      }
    }
    return failures;
  },
};
