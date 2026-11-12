// write-like-me's profile budget: the one script the skills and the
// refinement subagent run to learn whether a profile still fits. Its line of
// output and its exit code are the contract: 0 at or under budget, 1 over it,
// 2 when there is no profile to count.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BUDGET, countLines } from "../../../plugins/write-like-me/scripts/wlm/profile-budget.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const SCRIPT = path.join(REPO, "plugins", "write-like-me", "scripts", "wlm", "profile-budget.mjs");

function budget(t, args, env = {}) {
  const home = env.HOME ?? tempDir(t, "wlm-budget-");
  return runNode(SCRIPT, args, { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, WLM_PROFILE: "", ...env } });
}

test("the budget is sixty lines, and the bundled template fits it", () => {
  assert.equal(BUDGET, 60);
  const template = fs.readFileSync(path.join(REPO, "plugins", "write-like-me", "skills", "calibrate", "assets", "profile-template.md"), "utf8");
  assert.ok(countLines(template) <= BUDGET, `the template is ${countLines(template)} lines`);
});

test("a profile at or under budget prints its count and exits 0", (t) => {
  const dir = tempDir(t, "wlm-budget-");
  for (const [name, text, lines] of [
    ["empty.md", "", 0],
    ["three.md", "a\nb\nc\n", 3],
    ["no-final-newline.md", "a\nb\nc", 3],
    ["blank-lines.md", "a\n\n\nb\n", 4],
    ["crlf.md", "a\r\nb\r\n\r\nc\r\n", 4],
    ["sixty.md", "x\n".repeat(60), 60],
  ]) {
    const out = budget(t, [write(dir, name, text)]);
    assert.equal(out.stdout, `${lines}/60 lines \u2014 OK\n`, name);
    assert.equal(out.stderr, "", name);
    assert.equal(out.status, 0, name);
  }
});

test("a profile over budget says so and exits 1", (t) => {
  const out = budget(t, [write(tempDir(t, "wlm-budget-"), "long.md", "x\n".repeat(61))]);
  assert.equal(out.stdout, "61/60 lines \u2014 OVER BUDGET\n");
  assert.equal(out.status, 1);
});

test("every kind of line break counts, so a pasted profile is not undercounted", () => {
  assert.equal(countLines("a\x0bb\x0cc\u2028d\x85e\rf\n\n"), 7);
  assert.equal(countLines("a\u2029b"), 2);
  assert.equal(countLines("one line"), 1);
  assert.equal(countLines("\n"), 1);
});

test("a missing profile, or a folder in its place, exits 2 and names the path it was given", (t) => {
  const dir = tempDir(t, "wlm-budget-");
  for (const target of [path.join(dir, "missing.md"), dir, "missing.md", "."]) {
    const out = budget(t, [target]);
    assert.equal(out.stdout, "", target);
    assert.equal(out.stderr, `no profile at ${target}\n`, target);
    assert.equal(out.status, 2, target);
  }
});

test("with no argument it counts the person's profile: WLM_PROFILE, or the rule file in their home", (t) => {
  const home = tempDir(t, "wlm-budget-");
  const none = budget(t, [], { HOME: home });
  assert.equal(none.status, 2);
  assert.equal(none.stderr, `no profile at ${path.join(home, ".claude", "rules", "write-like-me.md")}\n`);

  write(home, ".claude/rules/write-like-me.md", "a\nb\nc\n");
  assert.equal(budget(t, [], { HOME: home }).stdout, "3/60 lines \u2014 OK\n");

  const override = write(home, "voice.md", "x\n".repeat(61));
  const out = budget(t, [], { HOME: home, WLM_PROFILE: override });
  assert.equal(out.stdout, "61/60 lines \u2014 OVER BUDGET\n");
  assert.equal(out.status, 1);
});
