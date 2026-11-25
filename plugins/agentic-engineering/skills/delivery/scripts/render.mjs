#!/usr/bin/env node
// Copy a template tree into a target, replacing `{{TOKEN}}` placeholders as it
// goes and reporting the sha256 of everything it wrote. Those hashes are the
// marker's `owned` map, which is what lets `--upgrade` tell a file nobody
// touched from one somebody edited.
//
// Used as a module by init-project.mjs. Run directly it renders and prints the
// plan without writing:
//   node render.mjs <template-dir> <target-dir> --token NAME=value ...
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;
// Binary-ish extensions are copied byte for byte and never scanned for tokens.
const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".zip"]);

export const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** Replace every {{TOKEN}}. An unknown token is left alone and reported. */
export function renderText(text, tokens) {
  const unknown = new Set();
  const out = text.replace(TOKEN_RE, (match, name) => {
    if (!(name in tokens)) { unknown.add(name); return match; }
    return String(tokens[name]);
  });
  return { text: out, unknown: [...unknown] };
}

/**
 * Every file under dir, as paths relative to it with forward slashes, so a
 * marker written on one operating system reads the same on another. Skips
 * .git and node_modules.
 */
export function walk(dir, base = dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/**
 * Write one file the scaffold owns, unless a person got there first.
 * @returns {{action: "written" | "identical" | "kept", hash: string | null, reason?: string}}
 *
 * `owned` is the previous marker's hash map, or null on a fresh scaffold,
 * where everything is written. With a map, a file already in the target is
 * treated one of three ways: identical bytes are left alone; a file the map
 * does not name is the repo's own and is never overwritten; a file whose hash
 * differs from the recorded one was edited, so it is kept and keeps its
 * recorded hash, which makes the next upgrade flag it again instead of quietly
 * adopting the edit and overwriting it the run after. `force` writes anyway.
 */
export function writeOwned(target, rel, buffer, { dryRun = false, owned = null, force = false, executable = false } = {}) {
  const to = path.join(target, rel);
  const hash = sha256(buffer);
  if (owned && fs.existsSync(to)) {
    const current = sha256(fs.readFileSync(to));
    if (current === hash) return { action: "identical", hash };
    if (!force) {
      const recorded = owned[rel];
      if (recorded === undefined) return { action: "kept", hash: null, reason: "exists and the scaffold does not own it" };
      if (current !== recorded) return { action: "kept", hash: recorded, reason: "edited since it was written" };
    }
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buffer);
    if (executable) fs.chmodSync(to, 0o755);
  }
  return { action: "written", hash };
}

/**
 * Render `source` into `target`.
 * @returns {{written: string[], skipped: {path: string, reason: string, to?: string, next?: Buffer}[], unknown: string[], hashes: Record<string,string>, plan: {path: string, bytes: number}[]}}
 *
 * `dryRun` computes everything and writes nothing. `skip(rel)` leaves a
 * template file out. `owned` and `force` are writeOwned's; a kept file comes
 * back in `skipped` with where it is (`to`) and what would have been written
 * (`next`), for the caller to diff.
 */
export function render(source, target, tokens, { dryRun = false, owned = null, force = false, skip = null } = {}) {
  const written = [];
  const skipped = [];
  const unknown = new Set();
  const hashes = {};
  const plan = [];

  for (const rel of walk(source)) {
    if (skip?.(rel)) continue;
    const from = path.join(source, rel);
    let buffer;
    if (BINARY.has(path.extname(rel))) buffer = fs.readFileSync(from);
    else {
      // A checkout that converted line endings must still hash like every other.
      const rendered = renderText(fs.readFileSync(from, "utf8").replace(/\r\n/g, "\n"), tokens);
      for (const u of rendered.unknown) unknown.add(u);
      buffer = Buffer.from(rendered.text, "utf8");
    }
    const executable = Boolean(fs.statSync(from).mode & 0o111);
    const result = writeOwned(target, rel, buffer, { dryRun, owned, force, executable });
    if (result.hash) hashes[rel] = result.hash;
    if (result.action === "written") { written.push(rel); plan.push({ path: rel, bytes: buffer.length }); }
    else if (result.action === "identical") skipped.push({ path: rel, reason: "identical" });
    else skipped.push({ path: rel, reason: result.reason, to: path.join(target, rel), next: buffer });
  }

  return { written, skipped, unknown: [...unknown], hashes, plan };
}

/** The managed block, rewritten in place or appended. Everything else is kept. */
export function mergeFencedBlock(existing, block, start, end) {
  const from = existing.indexOf(start);
  const to = existing.indexOf(end);
  if (from !== -1 && to !== -1 && to > from) {
    return existing.slice(0, from) + block.trimEnd() + "\n" + existing.slice(to + end.length).replace(/^\n/, "");
  }
  return (existing.trimEnd() + "\n\n" + block.trimEnd() + "\n").replace(/^\n+/, "");
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename); } catch { return false; } };

if (isMain()) {
  const [source, target, ...rest] = process.argv.slice(2);
  if (!source || !target) {
    console.error("usage: node render.mjs <template-dir> <target-dir> [--token NAME=value ...]");
    process.exitCode = 2;
  } else {
    const tokens = {};
    rest.forEach((arg, i) => {
      if (arg !== "--token") return;
      const [name, ...value] = (rest[i + 1] ?? "").split("=");
      tokens[name] = value.join("=");
    });
    const result = render(path.resolve(source), path.resolve(target), tokens, { dryRun: true });
    console.log(JSON.stringify({ plan: result.plan, unknown: result.unknown, hashes: result.hashes }, null, 2));
  }
}
