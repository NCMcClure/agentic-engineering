// Keys a layout move could not write into the config wait in a file beside
// it. The reader counts them from the first session, under whatever the
// config itself says, so nothing a repo relied on loosens while they wait.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ADDITIONS, CONFIG, loadConfig } from "../../../plugins/agent-works/lib/config.mjs";
import { tempDir, write } from "./helpers.mjs";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

test("agent-works config: waiting keys apply before they are merged", (t) => {
  const dir = tempDir(t, "aw-additions-");
  write(dir, CONFIG, json({ version: 1, guard: { ownerFiles: ["a.txt"] } }));
  assert.equal(loadConfig(dir).guard.locks, "warn", "the default, with nothing waiting");
  write(dir, ADDITIONS, json({ guard: { locks: "deny" }, kanban: { tracked: true } }));
  const cfg = loadConfig(dir);
  assert.equal(cfg.guard.locks, "deny");
  assert.equal(cfg.kanban.tracked, true);
  assert.deepEqual(cfg.guard.ownerFiles, ["a.txt"], "the config's own keys are untouched");
});

test("agent-works config: what the config says wins over a waiting key, and a broken file is ignored", (t) => {
  const dir = tempDir(t, "aw-additions-");
  write(dir, CONFIG, json({ version: 1, guard: { locks: "off" } }));
  write(dir, ADDITIONS, json({ guard: { locks: "deny" } }));
  assert.equal(loadConfig(dir).guard.locks, "off");
  write(dir, ADDITIONS, "{ not json");
  assert.equal(loadConfig(dir).guard.locks, "off");
  assert.equal(loadConfig(dir)._error, undefined);
});
