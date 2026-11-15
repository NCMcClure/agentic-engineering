// The one payload a hook is handed on stdin, or null when there is none it can
// read. Every hook here stays silent on null: a hook that cannot tell what
// happened has nothing to say about it.
import fs from "node:fs";

export function readPayload() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\ufeff/, ""));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch { return null; }
}
