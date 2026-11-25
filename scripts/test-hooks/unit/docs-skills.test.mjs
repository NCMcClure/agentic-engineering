// The docs area as a whole: three kinds of route, once three areas. The user
// docs and README routes are held here; the map routes and the figure routes
// each have a suite of their own (docs-map-skills, docs-figure-skills), and
// this one pins the set they make together, the door, and who starts each.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";

const AREA = area("docs");
const DOCS = ["audit", "init", "readme", "shots", "sync"];

test("docs routes: the area ships its eleven, in three kinds, and a bare call syncs the docs", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name), ["audit", "browser-setup", "figure", "init", "map-init", "map-sync", "miro", "readme", "shots", "stills", "sync"]);
  assert.deepEqual(Object.keys(AREA.door.routes), ["sync", "audit", "shots", "readme", "init", "map-sync", "miro", "map-init", "browser-setup", "figure", "stills"]);
  assert.equal(AREA.door.default, "sync");
});

test("docs routes: only the three that set something up are the person's to start", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name).filter((name) => AREA.starts(name) === "person"), ["browser-setup", "init", "map-init"]);
});

routeBasics(test, AREA, { when: /\bUse (when|before|after)\b/, cap: 700, only: DOCS });

test("docs routes: the user-docs routes run the checkers the area ships, by a path under the area", () => {
  for (const script of ["docs-check.mjs", "readme-check.mjs"]) assert.ok(fs.existsSync(path.join(AREA.dir, "scripts", script)), script);
  for (const name of DOCS) {
    for (const m of AREA.route(name).text.matchAll(/\bW\/scripts\/([a-z-]+\.mjs)/g)) assert.ok(fs.existsSync(path.join(AREA.dir, "scripts", m[1])), `${name}: W/scripts/${m[1]}`);
  }
});

test("docs: one critical.json and one briefing carry the user docs' lines and the map's", () => {
  const lines = JSON.parse(fs.readFileSync(path.join(AREA.dir, "hooks", "critical.json"), "utf8"));
  assert.equal(lines.area, "docs");
  const whens = lines.lines.map((l) => [l.when].flat().join(" "));
  assert.equal(whens.filter((w) => w.includes(".agents/docs-parity.json")).length, 2, "the docs rule and the README");
  assert.equal(whens.filter((w) => w.includes(".agents/system-map.json")).length, 2, "the map and the board");
  assert.deepEqual(fs.readdirSync(path.join(AREA.dir, "hooks")).sort(), ["briefing.mjs", "critical.json", "map-stop-check.mjs", "stop-check.mjs"]);
});
