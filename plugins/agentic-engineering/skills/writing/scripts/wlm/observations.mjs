// The style-feedback ledger: append, read, clear. One JSON object per line in
// observations.jsonl, written by the UserPromptSubmit hook and consumed by the
// refinement subagent the Stop hook starts.
import fs from "node:fs";
import { ensureDirs, nowSeconds, observationsPath } from "./paths.mjs";

/** Add one record, stamped with `ts` (seconds since the epoch) unless it carries its own. */
export function append(record, env) {
  ensureDirs(env);
  fs.appendFileSync(observationsPath(env), `${JSON.stringify({ ...record, ts: record.ts ?? nowSeconds() })}\n`);
}

/** Every record waiting to be folded in. Blank and unparseable lines are skipped. */
export function pending(env) {
  const file = observationsPath(env);
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* a torn line is not feedback */ }
  }
  return records;
}

export function clear(env) {
  fs.rmSync(observationsPath(env), { force: true });
}
