#!/usr/bin/env node
// The only home of the `debt:` marker grammar, and the only place that counts.
//
//   <comment leader> debt: <ceiling>[, <trigger>]
//
// The ceiling is the limit the shortcut accepts; the trigger is the observable
// condition that should make someone upgrade past it. A marker with a ceiling
// and no trigger is rot risk: nothing says when to revisit it.
//
// Usage: node debt.mjs [--root <dir>] [--write <file>]
// stdout: {"count", "no_trigger_count", "markers":[{file,line,ceiling,trigger,no_trigger}]}
// `file` is root-relative with forward slashes on every platform; markers are
// sorted by file, then line. --write also saves them as a markdown ledger.
// exit 0 on a successful scan whatever it found, 1 on an I/O error.
import fs from "node:fs";
import path from "node:path";

export const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target",
  ".venv", "__pycache__", "coverage", ".next", ".turbo"]);
// A comment leader (possibly repeated) followed by `debt:` and the payload.
export const MARKER = /(?:#|\/\/|--|;|\/\*|<!--)+\s*debt:\s*(.*)/;
const CLOSER = /\s*(?:-->|\*\/)\s*$/;
const MAX_BYTES = 512 * 1024;

// Ceiling and trigger, split on the first comma. Trailing block-comment
// closers are stripped so an HTML-comment marker parses like every other form.
export function parsePayload(payload) {
  const text = payload.replace(CLOSER, "").trim();
  const comma = text.indexOf(",");
  if (comma === -1) return { ceiling: text, trigger: null };
  return { ceiling: text.slice(0, comma).trim(), trigger: text.slice(comma + 1).trim() || null };
}

/** The ceiling of every marker in `text` that names one and gives no trigger. */
export function triggerless(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = MARKER.exec(line);
    if (!m) continue;
    const { ceiling, trigger } = parsePayload(m[1]);
    if (ceiling && trigger === null) out.push(ceiling);
  }
  return out;
}

export function scan(root) {
  const markers = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full); continue; }
      if (!entry.isFile()) continue;
      let text;
      try {
        if (fs.statSync(full).size > MAX_BYTES) continue;
        text = fs.readFileSync(full, "utf8");
      } catch { continue; }
      if (!text.includes("debt:")) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      text.split("\n").forEach((line, i) => {
        const m = MARKER.exec(line);
        if (!m) return;
        const { ceiling, trigger } = parsePayload(m[1]);
        markers.push({ file: rel, line: i + 1, ceiling, trigger, no_trigger: trigger === null });
      });
    }
  };
  walk(root);
  // By code point, not locale: the order is the same on every machine.
  markers.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return markers;
}

const cell = (s) => String(s).replaceAll("|", "\\|");
export function renderLedger(markers) {
  const out = ["# Debt ledger", "",
    `${markers.length} markers, ${markers.filter((m) => m.no_trigger).length} with no trigger.`, "",
    "| File | Line | Ceiling | Trigger |", "| --- | --- | --- | --- |"];
  for (const m of markers) {
    out.push(`| ${cell(m.file)} | ${m.line} | ${cell(m.ceiling)} | ${m.trigger === null ? "_(none)_" : cell(m.trigger)} |`);
  }
  return out.join("\n") + "\n";
}

function main(argv) {
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1]; };
  const root = path.resolve(flag("--root", process.cwd()) ?? "");
  const write = flag("--write", null);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`debt.mjs: not a directory: ${root}`);
    return 1;
  }
  const markers = scan(root);
  if (write) {
    try { fs.writeFileSync(write, renderLedger(markers)); }
    catch (e) { console.error(`debt.mjs: cannot write ledger: ${e.message}`); return 1; }
  }
  console.log(JSON.stringify({ count: markers.length, no_trigger_count: markers.filter((m) => m.no_trigger).length, markers }));
  return 0;
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = main(process.argv.slice(2));
