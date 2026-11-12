#!/usr/bin/env node
// PostToolUse on Edit, MultiEdit, and Write: when the text the edit just wrote
// carries a debt marker with a ceiling and no upgrade trigger, one nudge to
// the model while the edit is still in hand. Never a block: a missed nudge
// costs nothing (the debt skill's scan flags the same marker later), and a
// blocked edit costs work.
//
// It reads only what the tool call wrote, with the grammar scripts/debt.mjs
// owns. Silent where the repo has not opted in to the plugins (mode none).
// Fail open, always exit 0.
import { triggerless } from "../scripts/debt.mjs";
import { modeOf, readPayload, repoRoot } from "./critical-context.mjs";

/** Everything this tool call wrote: a Write's content, an Edit's new string, each of a MultiEdit's. */
function newText(input = {}) {
  const edits = Array.isArray(input.edits) ? input.edits : [];
  return [input.content, input.new_string, ...edits.map((e) => e?.new_string)].filter((p) => typeof p === "string" && p).join("\n");
}

function nudgeFor(text) {
  if (!text.includes("debt:")) return "";
  const ceilings = triggerless(text);
  if (!ceilings.length) return "";
  return `code-diet: debt marker(s) with no upgrade trigger: ${ceilings.slice(0, 3).join("; ")}. The grammar is \`debt: <ceiling>, <trigger>\`; name the observable condition that should make someone upgrade past the ceiling, or the shortcut rots into permanent.`;
}

function main() {
  const payload = readPayload();
  const nudge = nudgeFor(newText(payload.tool_input ?? {}));
  // The text is checked first: most edits carry no marker and never reach git.
  if (!nudge || modeOf(repoRoot(payload)) === "none") return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: nudge } }));
}

try { main(); } catch { /* fail open */ }
process.exitCode = 0;
