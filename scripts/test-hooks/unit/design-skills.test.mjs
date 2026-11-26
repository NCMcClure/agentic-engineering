// The design area's routes, read as an agent reads them: the look routes and
// the three that hold a front end to a design system. Each has a name that
// matches its folder, a route's keys only, and a description that says when;
// the design-system routes reach design.mjs from the area's directory, pass
// the data directory the area names, and send no one to a command that the
// script does not have.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";

const AREA = area("design");
const SYSTEM = ["adopt", "check", "system"];
const SCRIPT = fs.readFileSync(path.join(AREA.dir, "scripts", "design.mjs"), "utf8");
const COMMANDS = ["profile", "manifest", "rules", "catalog", "pin", "status"];

test("design routes: the look routes and the three for a design system, and who starts each", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name), ["adopt", "audio", "calibrate", "check", "define-success", "iterate", "judge", "motion", "probe", "shot-harness", "system"]);
  assert.deepEqual(Object.keys(AREA.door.routes).slice(-3), ["system", "adopt", "check"]);
  assert.deepEqual(AREA.routes.map((r) => r.name).filter((name) => AREA.starts(name) === "person"), ["shot-harness", "system"], "the person picks their system and sets up shots; an agent adopts and checks");
  assert.equal(AREA.door.default, "define-success");
  assert.match(AREA.door.lead, /a web front end held to the person's design system/);
});

routeBasics(test, AREA, { only: SYSTEM, cap: 400 });

for (const name of SYSTEM) {
  const route = AREA.route(name);
  test(`design routes: ${name} runs design.mjs from the area's directory, with the area's data directory, and only commands it has`, () => {
    assert.match(route.text, /`W` below is `\.\.\/\.\.` from the directory this file is in/);
    assert.match(route.text, /`D` below is the data directory the design area names when it loads/);
    const calls = [...route.text.matchAll(/node "W\/scripts\/design\.mjs" ([a-z]+)([^`\n]*)/g)];
    assert.ok(calls.length > 0, "it runs the script");
    for (const [, command, rest] of calls) {
      assert.ok(COMMANDS.includes(command), command);
      assert.match(SCRIPT, new RegExp(`command === "${command}"`), command);
      assert.match(rest, /--data "D"/, `${command}${rest}`);
    }
  });
}

test("design routes: adopt asks before it installs, records a no, and reports findings as a list to fix", () => {
  const text = AREA.route("adopt").text;
  assert.match(text, /\*\*ask first\*\*: it writes files into the repo and may need their login/);
  assert.match(text, /git config --local agentic-engineering\.design off/);
  assert.match(text, /not a failure of adoption/);
  assert.match(text, /\/agentic-engineering:design check/);
});

test("design routes: check installs a missing component from the system, sends a new look to the system, and allows only on a yes", () => {
  const text = AREA.route("check").text;
  assert.match(text, /install it with the manifest's `install\.item`[\s\S]*Never hand-roll one/);
  assert.match(text, /a new variant in the system, not a restyle where it is used/);
  assert.match(text, /## Step 4: Allow only on a yes/);
});

test("design area: its page names the data directory for the routes, and both halves", () => {
  assert.match(AREA.skill.body, /The data directory for this area is `\$\{CLAUDE_PLUGIN_DATA\}\/design`/);
  assert.match(AREA.skill.body, /^## A design system$/m);
});
