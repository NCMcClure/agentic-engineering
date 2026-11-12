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
