// The write-like-me area, read as an agent reads it: its routes, each with a
// name that matches its folder, a description that says when to take it and a
// route's frontmatter keys only, and no path, script or route named in a
// body that does not exist. Writing prose is the area's own page, not a route.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pluginRootPaths } from "../../lib.mjs";
import { AGENTCRAFT, area, routeBasics } from "./area-routes.mjs";

const AREA = area("write-like-me");
const routes = AREA.routes;
const names = routes.map((r) => r.name);
// Started by the person: one rebuilds the profile, the other edits it.
const BY_HAND = ["calibrate", "review"];
// Everything an agent is sent to read: the area's page, its routes, and the rules the Stop hook hands a subagent.
const REFINE = path.join(AREA.dir, "hooks", "refine-profile.md");
const docs = [AREA.skill, ...routes, { name: "refine-profile", dir: path.dirname(REFINE), text: fs.readFileSync(REFINE, "utf8") }];

test("write-like-me routes: the area ships exactly its three, and writing is the area's own page", () => {
  assert.deepEqual(names, ["audit", "calibrate", "review"]);
  assert.deepEqual(names.filter((name) => AREA.starts(name) === "person"), BY_HAND, "the profile is changed by hand, prose is written by the model");
  assert.match(AREA.skill.fields.description, /\bUse every time\b/, "the area is what the model reaches for before it writes");
});

routeBasics(test, AREA, { when: /\bUse (when|every time)\b/i, cap: 700 });

for (const doc of [AREA.skill, ...routes]) {
  test(`write-like-me routes: every file ${doc.name} links or names exists`, () => {
    for (const p of doc.text.split("\n").flatMap((line) => pluginRootPaths(line)).filter((p) => !p.placeholder)) {
      assert.ok(fs.existsSync(path.join(AGENTCRAFT, p.path.replace(/\.$/, ""))), `\${CLAUDE_PLUGIN_ROOT}/${p.path}`);
    }
    for (const m of doc.text.matchAll(/\]\((?!https?:)([^)#\s]+)\)/g)) assert.ok(fs.existsSync(path.resolve(doc.dir, m[1])), `link ${m[1]}`);
    for (const m of doc.text.matchAll(/(?<![\w/}])(scripts\/wlm\/[A-Za-z0-9_.-]+)/g)) assert.ok(fs.existsSync(path.join(AREA.dir, m[1])), m[1]);
  });
}

for (const route of routes) {
  test(`write-like-me routes: a script ${route.name} runs is run with node, from the area's directory`, () => {
    for (const m of route.text.matchAll(/`([^`\n]*\.mjs[^`\n]*)`/g)) {
      if (!/^\s*\w+ /.test(m[1])) continue; // a bare path names a file; a command starts with a program
      assert.match(m[1], /^node "W\/scripts\/wlm\/[a-z-]+\.mjs"( <[a-z]+>)?$/, m[1]);
    }
  });
}

test("write-like-me routes: no page, reference or rules file names Python or a shell script", () => {
  const files = fs.readdirSync(AREA.dir, { recursive: true }).map(String).filter((f) => f.endsWith(".md") && path.basename(f) !== "CHANGELOG.md");
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = fs.readFileSync(path.join(AREA.dir, file), "utf8");
    assert.doesNotMatch(text, /\bpython3?\b|[\w-]+\.py\b|[\w-]+\.sh\b/i, file);
  }
});

test("write-like-me routes: every route a document points at is one the area ships", () => {
  for (const { name, text } of docs) {
    for (const m of text.matchAll(/(?<![\w/.-])\/agentic-engineering:write-like-me ([a-z][a-z-]*)\b/g)) assert.ok(names.includes(m[1]), `${name}: ${m[0]}`);
    assert.doesNotMatch(text, /(?<![\w/.-])\/write-like-me:[a-z]/, `${name}: an address under the plugin's old name`);
  }
});

test("write-like-me routes: the refinement rules name the budget script where it sits, relative to themselves", () => {
  const text = fs.readFileSync(REFINE, "utf8");
  const named = [...text.matchAll(/`(\.\.\/[A-Za-z0-9_./-]+\.mjs)`/g)].map((m) => m[1]);
  assert.deepEqual(named, ["../scripts/wlm/profile-budget.mjs"]);
  assert.ok(fs.existsSync(path.resolve(path.dirname(REFINE), named[0])));
});

test("write-like-me routes: every reference and asset is linked from the document it sits under", () => {
  for (const doc of [AREA.skill, ...routes]) {
    for (const folder of ["references", "assets"]) {
      const dir = path.join(doc.dir, folder);
      for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (fs.statSync(path.join(dir, file)).isDirectory()) continue;
        assert.ok(doc.text.includes(`${folder}/${file}`), `${doc.name}/${folder}/${file} is not linked from its page`);
      }
    }
  }
});
