// Copying the kit into a repo, and bringing a copy up to date later, without
// ever writing over something the repo's people changed. The copy's kit.json
// records the hash of each file as it was written: a file that still has that
// hash is untouched and may be replaced; one that does not is theirs.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MARKER = "kit.json";
const hashOf = (buffer) => createHash("sha256").update(buffer).digest("hex");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

/** Every file of a kit folder, relative, with forward slashes, the marker left out. */
export function kitFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String)
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
    .map((rel) => rel.split(path.sep).join("/"))
    .filter((rel) => rel !== MARKER && !rel.split("/").some((part) => part.startsWith(".")))
    .sort();
}

export const kitVersion = (dir) => readJson(path.join(dir, MARKER))?.version ?? null;

/**
 * What installing `source` over `target` would do, file by file:
 *   add      not there yet
 *   same     already what the plugin ships
 *   update   untouched since it was written, and the plugin's has changed
 *   kept     changed by the repo's people (or never written by the plugin): left alone
 * and `gone`: files an earlier kit wrote, untouched, that the plugin no longer ships.
 */
export function plan(source, target) {
  const marker = readJson(path.join(target, MARKER));
  const owned = marker?.owned ?? {};
  const files = kitFiles(source).map((rel) => {
    const next = hashOf(fs.readFileSync(path.join(source, rel)));
    const at = path.join(target, rel);
    if (!fs.existsSync(at)) return { rel, action: "add", hash: next };
    const now = hashOf(fs.readFileSync(at));
    if (now === next) return { rel, action: "same", hash: next };
    return { rel, action: owned[rel] === now ? "update" : "kept", hash: next };
  });
  const shipped = new Set(files.map((f) => f.rel));
  const gone = Object.keys(owned).filter((rel) => !shipped.has(rel) && fs.existsSync(path.join(target, rel)) && hashOf(fs.readFileSync(path.join(target, rel))) === owned[rel]).sort();
  return { installed: marker?.version ?? null, version: kitVersion(source), files, gone };
}

/** Is a planned install a no-op? */
export const current = (p) => p.installed === p.version && p.gone.length === 0 && p.files.every((f) => f.action === "same" || f.action === "kept");

/** Carry a plan out. Files marked `kept` are never written. Returns the plan. */
export function apply(source, target, p = plan(source, target)) {
  const before = readJson(path.join(target, MARKER))?.owned ?? {};
  const owned = {};
  for (const file of p.files) {
    const to = path.join(target, file.rel);
    if (file.action === "add" || file.action === "update") {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(source, file.rel), to);
    }
    // An edited file stays on record under the hash it was written with, so it stays "kept".
    if (file.action === "kept") { if (before[file.rel]) owned[file.rel] = before[file.rel]; } else owned[file.rel] = file.hash;
  }
  for (const rel of p.gone) fs.rmSync(path.join(target, rel), { force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, MARKER), JSON.stringify({ version: p.version, owned }, null, 2) + "\n");
  return p;
}
