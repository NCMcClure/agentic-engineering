// The numbers a finding is raised against, in one place.
//
// The first three are the host's and this marketplace's own: the gate that
// checks a plugin's files (scripts/validate.mjs in the repo this ships from)
// and the workbench's scanner hold the same values, and a repo test fails
// when one moves without the others. The rest are this area's judgment.

/** Past this many characters the host gives the model a preview of a hook's output and a file path, not the text. */
export const HOOK_OUTPUT_CAP = 10_000;
/** Near enough to the cap that one more line of state goes over it. */
export const HOOK_OUTPUT_NEAR = 8_000;
/** Every critical line a session start prints, in characters: each request carries them. */
export const CRITICAL_TOTAL = 7_500;

/** The same hook text on this many turns is said to repeat. */
export const REPEAT_TURNS = 5;
/** A line this long found in two sources at a segment's start is counted as said twice. */
export const DUP_LINE_CHARS = 60;

/**
 * Subagents that should start with no plugin context: a searcher has no use
 * for the build rules, and a blind critic must not be told what it judges.
 */
export const QUIET_AGENTS = ["Explore", "Plan", "web-fetch", "claude-code-guide", "statusline-setup", "agentcraft:vision-critic"];
