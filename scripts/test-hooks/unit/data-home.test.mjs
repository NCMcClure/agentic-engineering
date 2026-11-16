// plugins/agentcraft/lib/data-home.mjs: where an area keeps what outlives an
// update, and the one-time copy of what it kept as a plugin of its own. Every
// directory here is a throwaway: the person's own data is never read.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { areaHome, formerHome, inherit } from "../../../plugins/agentcraft/lib/data-home.mjs";
import { tempDir, write } from "./helpers.mjs";

const MARKET = "agentic-engineering";
/** A `plugins/data` folder as the host lays one out: this plugin's directory, and where an area's own one was. */
function machine(t, market = MARKET) {
  const data = path.join(tempDir(t, "data-home-"), "plugins", "data");
  const current = path.join(data, `agentcraft-${market}`);
  return { data, current, env: { CLAUDE_PLUGIN_DATA: current }, former: (area) => path.join(data, `${area}-${market}`), home: (area) => path.join(current, area) };
}
/** Every file under `dir`, with forward slashes, and what it holds. */
const tree = (dir) => Object.fromEntries((fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []).map(String)
  .filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => [f.split(path.sep).join("/"), fs.readFileSync(path.join(dir, f), "utf8")]).sort());

test("an area's home is a folder of its own in the plugin's data directory", (t) => {
  const m = machine(t);
  assert.equal(areaHome("write-like-me", m.env), path.join(m.current, "write-like-me"));
  assert.equal(areaHome("picture-this", m.env), path.join(m.current, "picture-this"));
  assert.equal(areaHome("picture-this", { CLAUDE_PLUGIN_DATA: "relative/data" }), path.resolve("relative/data", "picture-this"));
  assert.equal(fs.existsSync(m.current), false, "naming a home makes nothing");
  for (const env of [{}, { CLAUDE_PLUGIN_DATA: "" }, { CLAUDE_PLUGIN_DATA: "  " }]) {
    assert.throws(() => areaHome("write-like-me", env), /write-like-me: CLAUDE_PLUGIN_DATA is not set/);
  }
});

test("the directory an area had as a plugin of its own is beside this plugin's, in the same marketplace", (t) => {
  const m = machine(t);
  assert.equal(formerHome("write-like-me", m.env), path.join(m.data, `write-like-me-${MARKET}`));
  const fork = machine(t, "a-fork");
  assert.equal(formerHome("picture-this", fork.env), path.join(fork.data, "picture-this-a-fork"));
  // A trailing separator is the same directory.
  assert.equal(formerHome("write-like-me", { CLAUDE_PLUGIN_DATA: m.current + path.sep }), path.join(m.data, `write-like-me-${MARKET}`));
  // A data directory that is not named for this plugin (a test's, a person's override) says nothing about a marketplace.
  for (const data of [path.join(m.data, "somewhere"), path.join(m.data, "agentcraft"), path.join(m.data, `write-like-me-${MARKET}`), "", undefined]) {
    assert.equal(formerHome("write-like-me", { CLAUDE_PLUGIN_DATA: data }), null, String(data));
  }
});

test("what an area kept as a plugin of its own is copied into its home, and the old directory is left as it was", (t) => {
  const m = machine(t);
  const from = m.former("write-like-me");
  write(from, "observations.jsonl", '{"label": "tone"}\n');
  write(from, "changelog.md", "# Changelog\n");
  write(from, "samples/emails/one.md", "a sample\n");
  write(from, "state/last-refined", "1700000000.5");
  const before = tree(from);
  assert.deepEqual(inherit("write-like-me", m.env), ["changelog.md", "observations.jsonl", "samples", "state"]);
  assert.deepEqual(tree(m.home("write-like-me")), before);
  assert.deepEqual(tree(from), before, "a copy: nothing is moved");
  assert.deepEqual(fs.readdirSync(m.current), ["write-like-me"], "and no other area's folder is made");
});

test("the copy is made once: a second run, and a home that already holds anything, copy nothing and overwrite nothing", (t) => {
  const m = machine(t);
  const from = m.former("write-like-me");
  write(from, "observations.jsonl", "old\n");
  assert.deepEqual(inherit("write-like-me", m.env), ["observations.jsonl"]);
  // The area goes on working in its home, and the old plugin, still installed, in its own.
  write(m.home("write-like-me"), "observations.jsonl", "old\nnew\n");
  write(from, "observations.jsonl", "old\nwritten by the old plugin since\n");
  write(from, "samples/later.md", "later\n");
  assert.deepEqual(inherit("write-like-me", m.env), []);
  assert.deepEqual(tree(m.home("write-like-me")), { "observations.jsonl": "old\nnew\n" });

  // A home the area made first, with nothing the old directory has, is still the area's: nothing is merged into it.
  const fresh = machine(t);
  write(fresh.former("write-like-me"), "observations.jsonl", "old\n");
  fs.mkdirSync(path.join(fresh.home("write-like-me"), "state"), { recursive: true });
  assert.deepEqual(inherit("write-like-me", fresh.env), []);
  assert.deepEqual(tree(fresh.home("write-like-me")), {});
  assert.deepEqual(fs.readdirSync(fresh.home("write-like-me")), ["state"]);
});

test("with nothing to copy it does nothing, and makes no folder", (t) => {
  const none = machine(t);
  assert.deepEqual(inherit("write-like-me", none.env), []);
  assert.equal(fs.existsSync(none.data), false, "no old directory: nothing is made");

  const empty = machine(t);
  fs.mkdirSync(empty.former("write-like-me"), { recursive: true });
  assert.deepEqual(inherit("write-like-me", empty.env), []);
  assert.equal(fs.existsSync(empty.current), false, "an empty old directory: nothing is made");

  // Another area's old directory is not this one's.
  const other = machine(t);
  write(other.former("picture-this"), "kit/package.json", "{}\n");
  assert.deepEqual(inherit("write-like-me", other.env), []);
  assert.equal(fs.existsSync(other.current), false);

  // A data directory that names no marketplace has no old directory to look in.
  const loose = path.join(tempDir(t, "data-home-"), "data");
  write(path.join(path.dirname(loose), "write-like-me-data"), "observations.jsonl", "x\n");
  assert.deepEqual(inherit("write-like-me", { CLAUDE_PLUGIN_DATA: loose }), []);
  assert.equal(fs.existsSync(loose), false);
  // And with no data directory at all there is nothing to copy from or to.
  for (const env of [{}, { CLAUDE_PLUGIN_DATA: "" }]) assert.deepEqual(inherit("write-like-me", env), []);
});

test("loading the module reads and writes nothing", () => {
  const source = fs.readFileSync(new URL("../../../plugins/agentcraft/lib/data-home.mjs", import.meta.url), "utf8");
  // Nothing at the top level but imports, constants and functions: no call to fs outside a function body.
  const top = source.split("\n").filter((line) => /^\S/.test(line) && !/^(\/\/|\/\*| \*|import |export (function|const)|const |function |\}|\))/.test(line));
  assert.deepEqual(top, []);
  assert.doesNotMatch(source, /process\.env\.(?!CLAUDE_PLUGIN_DATA)/);
});
