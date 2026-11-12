// What the unit tests share: a throwaway copy of this checkout to break one
// thing in, and a way to run a script against it.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "../fixtures.mjs";

export { REPO };

/** Every file git would commit from this checkout: tracked, plus new ones not ignored. */
const files = () => execFileSync("git", ["-C", REPO, "ls-files", "-z", "-co", "--exclude-standard"], { encoding: "utf8" })
  .split("\0").filter((f) => f && fs.existsSync(path.join(REPO, f)));

/**
 * A fresh git repo holding this checkout's files, then edited: each `json`
 * file (repo-relative) passed through its function, each `text` file's
 * contents through its own, each `write` path given the contents it names,
 * and each `remove` path deleted. Returns its directory.
 */
export function tree(t, { json = {}, text = {}, write = {}, remove = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of files()) {
    const from = path.join(REPO, f), to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.lstatSync(from).isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to);
  }
  const at = (rel) => path.join(dir, rel);
  for (const [rel, fn] of Object.entries(json)) fs.writeFileSync(at(rel), `${JSON.stringify(fn(JSON.parse(fs.readFileSync(at(rel), "utf8"))), null, 2)}\n`);
  for (const [rel, fn] of Object.entries(text)) fs.writeFileSync(at(rel), fn(fs.readFileSync(at(rel), "utf8")));
  for (const [rel, content] of Object.entries(write)) {
    fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
    fs.writeFileSync(at(rel), content);
  }
  for (const rel of remove) fs.rmSync(at(rel), { recursive: true, force: true });
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  return dir;
}

/** Run one of this checkout's scripts; returns { status, stdout, stderr }. */
export function runNode(script, args = [], options = {}) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [path.join(REPO, script), ...args], { encoding: "utf8", ...options });
  return { status, stdout, stderr };
}
