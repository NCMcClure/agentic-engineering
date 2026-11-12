// Shared helpers for the repo's own tooling. Node 22 stdlib only, never shipped.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
// Atomic: a half-written ~/.claude/settings.json costs the user their settings,
// and the installer rewrites files it does not own. Temp file beside the target
// (same filesystem, so rename is atomic), then rename over it.
export function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// Frontmatter: a leading --- block of `key: value` pairs. Scalars keep their text
// (quotes stripped); `>` and `>-` fold their indented block into one line. That is
// every shape SKILL.md uses; anything richer is a reason to reach for a parser.
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return null;
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const out = {};
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw === ">" || raw === ">-" || raw === "|" || raw === "|-") {
      const block = [];
      while (i + 1 < end && (lines[i + 1].trim() === "" || /^\s+/.test(lines[i + 1]))) {
        block.push(lines[++i].trim());
      }
      out[key] = block.join(" ").trim();
    } else {
      out[key] = raw.trim().replace(/^["'](.*)["']$/s, "$1");
    }
  }
  return out;
}

// Every file under dir, recursively, as paths relative to dir. Skips .git.
export function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

export const gitLsFiles = (root) =>
  execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

export const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const state = { failures: 0 };
export const ok = (what) => console.log(`ok: ${what}`);
export const fail = (what, where) => {
  state.failures++;
  console.log(`FAIL: ${what}${where ? ` (${where})` : ""}`);
};
export const note = (what) => console.log(`note: ${what}`);
export const failures = () => state.failures;

// ---- hook commands -------------------------------------------------------
// A Node hook is registered behind a guard, so a machine without Node on PATH
// gets one line at session start instead of an error on every event. The loud
// form says so to the person; the quiet form, for every other event, stays out
// of the way.
const NODE_MISSING = (plugin) => `Node 22 is not on PATH, so ${plugin} hooks are off.`;
const QUIET_GUARD = "command -v node >/dev/null 2>&1 || exit 0; ";
const loudGuard = (plugin) => `command -v node >/dev/null 2>&1 || { echo '${JSON.stringify({ systemMessage: NODE_MISSING(plugin) })}'; exit 0; }; `;
const NODE_CALL = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+\.m?js)"((?: [A-Za-z0-9_./=:-]+)*)$/;

/** The command hooks.json carries for a plugin's Node hook; `script` is plugin-relative. */
export const hookCommand = (plugin, script, { loud = false, args = [] } = {}) =>
  `${loud ? loudGuard(plugin) : QUIET_GUARD}node "\${CLAUDE_PLUGIN_ROOT}/${script}"${args.map((a) => ` ${a}`).join("")}`;

/**
 * A hooks.json command that runs Node on a plugin file, taken apart: its
 * `script` (plugin-relative), plain `args`, and `guard` (`loud`, `quiet`, or
 * null). Null for any other command.
 */
export function parseHookCommand(command, plugin) {
  const text = String(command ?? "");
  const guard = text.startsWith(loudGuard(plugin)) ? "loud" : text.startsWith(QUIET_GUARD) ? "quiet" : null;
  const call = NODE_CALL.exec(guard === "loud" ? text.slice(loudGuard(plugin).length) : guard === "quiet" ? text.slice(QUIET_GUARD.length) : text);
  return call ? { script: call[1], args: call[2].trim().split(" ").filter(Boolean), guard } : null;
}

// ---- shared files --------------------------------------------------------
/**
 * The files plugins ship as unchanged copies of one in scripts/shared/. A
 * plugin lists its copies, plugin-relative, under `shared` in
 * scripts/plugins/<name>.json; the file of the same name in scripts/shared/ is
 * the one to edit. Returns { copies: [{ plugin, copy, canonical }], problems }.
 */
export function sharedCopies(root) {
  const copies = [], problems = [];
  const dir = path.join(root, "scripts", "plugins");
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []) {
    const plugin = file.slice(0, -5);
    let shared;
    try { shared = readJson(path.join(dir, file)).shared ?? []; } catch { continue; }
    if (!Array.isArray(shared)) { problems.push(`scripts/plugins/${file}: shared is not a list of paths`); continue; }
    for (const rel of shared) {
      if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split("/").includes("..")) { problems.push(`scripts/plugins/${file}: ${JSON.stringify(rel)} is not a path inside the plugin`); continue; }
      copies.push({ plugin, copy: `plugins/${plugin}/${rel}`, canonical: `scripts/shared/${path.posix.basename(rel)}` });
    }
  }
  return { copies, problems };
}
