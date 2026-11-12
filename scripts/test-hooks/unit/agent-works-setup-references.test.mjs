// agent-works references/ and assets/templates/: what they tell an agent to
// type is something the command line has.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PLUGIN, script } from "./agent-works-homes.mjs";

const { MODULES } = await script("aw.mjs");
const COMMANDS = new Set(MODULES.flatMap((m) => m.commands));
const REFERENCES = ["coordination.md", "decisions.md", "guard-config.md", "homes.md", "hubs.md", "memory.md"];

const pages = [
  ...REFERENCES.map((name) => path.join(PLUGIN, "references", name)),
  ...fs.readdirSync(path.join(PLUGIN, "assets", "templates")).map((name) => path.join(PLUGIN, "assets", "templates", name)),
];

test("agent-works references: the six pages are in references/, and nothing is left where they were", () => {
  assert.deepEqual(fs.readdirSync(path.join(PLUGIN, "references")).sort(), REFERENCES);
  assert.equal(fs.existsSync(path.join(PLUGIN, "core")), false);
});

test("agent-works references: every `aw <command>` a page or a template names is a command", () => {
  for (const file of pages) {
    const text = fs.readFileSync(file, "utf8");
    // In a code span or at the start of a line of a code block: `aw board lint`, never the word in a sentence.
    for (const m of text.matchAll(/(?:`|^\s*)aw ([a-z][a-z-]*)\b/gm)) assert.ok(COMMANDS.has(m[1]), `${path.basename(file)}: aw ${m[1]}`);
  }
});

test("agent-works references: no page sends a reader to a file the plugin no longer has", () => {
  for (const file of pages) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /core\/references|\bcli\/[a-z_]+\.py|hooks\/[a-z_]+\.py|python -B/, path.basename(file));
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(scripts\/[\w./-]+\.mjs|references\/[\w.-]+\.md|assets\/templates\/[\w.-]+)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `${path.basename(file)}: ${m[1]}`);
    }
  }
});
