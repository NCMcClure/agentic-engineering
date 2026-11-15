// The system-map area's routes, read as an agent reads them: a name that
// matches its folder, a description that says when to take it, a route's
// frontmatter keys and no others, and no reference, script, flag, or route
// named in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";

const AREA = area("system-map");
const routes = AREA.routes;
const names = routes.map((r) => r.name);
// Started by a person, once per machine or once per repo: never picked by the model on its own.
const BY_HAND = ["browser-setup", "diagrams-init"];

/** Every Markdown file a route ships: its ROUTE.md and its references. */
const pages = (route) => [route.file, ...(fs.existsSync(path.join(route.dir, "references"))
  ? fs.readdirSync(path.join(route.dir, "references")).filter((f) => f.endsWith(".md")).map((f) => path.join(route.dir, "references", f)) : [])];
/** The flags a script takes, read from its own source. */
const flagsOf = (script) => new Set([...fs.readFileSync(path.join(AREA.dir, script), "utf8").matchAll(/"(--[a-z][a-z-]*)"/g)].map((m) => m[1]));

test("system-map routes: the area ships exactly its four", () => {
  assert.deepEqual(names, ["browser-setup", "diagrams-init", "diagrams-sync", "miro-board"]);
  assert.deepEqual(names.filter((name) => AREA.starts(name) === "person"), BY_HAND, "set up by hand, everything else by the model");
});

routeBasics(test, AREA, { when: /\bUse (it )?when\b/, cap: 700 });

for (const route of routes) {
  test(`system-map routes: every reference and script ${route.name} names exists`, () => {
    for (const m of route.text.matchAll(/\]\(((?:references|workflows|assets|scripts)\/[A-Za-z0-9_./-]+)\)/g)) {
      assert.ok(fs.existsSync(path.join(route.dir, m[1])), `${route.name} links ${m[1]}`);
    }
    // `S` stands for the route's own scripts directory wherever a body uses it.
    for (const m of route.body.matchAll(/\bnode S\/([a-z-]+\.mjs)/g)) {
      assert.ok(fs.existsSync(path.join(route.dir, "scripts", m[1])), `${route.name} runs S/${m[1]}`);
      assert.ok(route.body.includes(`\`S\` below is \`W/routes/${route.name}/scripts\``), "S is defined before it is used, under the directory the route named");
    }
  });

  test(`system-map routes: no page of ${route.name} writes a path the host would have to fill in`, () => {
    // A route and its references are read as plain files, where the plugin's root would stay a literal.
    for (const page of pages(route)) assert.doesNotMatch(fs.readFileSync(page, "utf8"), /\$\{CLAUDE_PLUGIN_ROOT\}/, path.relative(AREA.dir, page));
  });

  test(`system-map routes: every flag ${route.name} passes a script is one the script takes`, () => {
    const scripts = {
      "system-map.mjs": flagsOf("scripts/system-map.mjs"),
      "map-sweep.mjs": flagsOf("scripts/map-sweep.mjs"),
      "check-setup.mjs": flagsOf("routes/browser-setup/scripts/check-setup.mjs"),
      "build.mjs": flagsOf("routes/miro-board/scripts/build.mjs"),
      "init.mjs": flagsOf("routes/miro-board/scripts/init.mjs"),
      "pull.mjs": new Set([...flagsOf("routes/miro-board/scripts/pull.mjs"), ...flagsOf("routes/miro-board/scripts/project.mjs")]),
      "live.mjs": flagsOf("routes/miro-board/scripts/live.mjs"),
    };
    for (const [script, known] of Object.entries(scripts)) assert.ok(known.size >= 1, `${script} declares its flags`);
    const used = (line, name) => [...line.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)].map((f) => [name, f[1]]);
    const passed = [];
    for (const page of pages(route)) {
      const text = fs.readFileSync(page, "utf8");
      // A command in backticks or a code block that names the script, or the MAP and SWEEP shorthands for the two at the area's root.
      for (const m of text.matchAll(/`([^`\n]*?(?<![\w-])([a-z-]+\.mjs)\b[^`\n]*)`/g)) if (scripts[m[2]]) passed.push(...used(m[1], m[2]));
      for (const m of text.matchAll(/^.*\bnode\s+\S*\/([a-z-]+\.mjs)\S*(.*)$/gm)) if (scripts[m[1]]) passed.push(...used(m[2], m[1]));
      for (const m of text.matchAll(/`MAP( [^`\n]*)`/g)) passed.push(...used(m[1], "system-map.mjs"));
      for (const m of text.matchAll(/`SWEEP( [^`\n]*)`/g)) passed.push(...used(m[1], "map-sweep.mjs"));
    }
    assert.ok(passed.length >= 2, "the route's commands were found");
    for (const [script, flag] of passed) assert.ok(scripts[script].has(flag), `${script} has no ${flag}`);
  });

  test(`system-map routes: every route ${route.name} points at is one the area ships, and a hand-run one is asked for`, () => {
    for (const page of pages(route)) {
      const text = fs.readFileSync(page, "utf8");
      for (const m of text.matchAll(/(?<![\w/.-])\/agentcraft:([a-z][a-z-]*) ([a-z][a-z-]*)\b/g)) {
        assert.equal(m[1], "system-map", `${m[0]} belongs to another area`);
        assert.ok(names.includes(m[2]), m[0]);
      }
      assert.doesNotMatch(text, /(?<![\w/.-])\/(system-map|marvelous-miro):[a-z]/, `${path.basename(page)}: an address under an old plugin name`);
      // A route only a person can start is never something the model is told to use or load.
      for (const hand of BY_HAND.filter((h) => h !== route.name)) {
        assert.doesNotMatch(text, new RegExp(`\\b(use|run|load|invoke|follow) the ${hand} (skill|route)`, "i"), `${path.basename(page)} sends the model to ${hand}`);
      }
    }
  });

  test(`system-map routes: nothing in ${route.name} assumes whose Miro it is`, () => {
    for (const page of pages(route)) {
      const text = fs.readFileSync(page, "utf8");
      assert.doesNotMatch(text, /parent_space_url\b.*\b[0-9A-Za-z]{20,}/, "a space id is baked in");
      assert.doesNotMatch(text, /\b\d{15,}\b/, "a Miro id is baked in");
      assert.doesNotMatch(text, /miro\.com\/app\/board\/[A-Za-z0-9]/, "a board URL is baked in");
    }
  });
}

test("system-map routes: the routes that touch a sign-in say whose it is", () => {
  for (const name of ["miro-board", "browser-setup"]) {
    assert.match(AREA.route(name).body, /never type(s)? (a password|credentials)/i, `${name} says the agent types no credentials`);
  }
  const init = AREA.route("diagrams-init").body;
  assert.match(init, /Ask the person which board/);
  assert.match(init, /on their yes call `board_create`/);
});

test("system-map routes: every file a route tells a repo to copy is in the area, and the workflow it launches parses", () => {
  for (const asset of ["routes/diagrams-init/assets/system-map.json", "routes/diagrams-init/assets/gen-system.mjs", "routes/miro-board/assets/miro.config.mjs", "routes/miro-board/assets/gen-example.mjs", "routes/miro-board/assets/board-dump.js", "scripts/system-map.mjs"]) {
    assert.ok(fs.existsSync(path.join(AREA.dir, asset)), asset);
  }
  const workflow = fs.readFileSync(path.join(AREA.dir, "routes", "diagrams-sync", "workflows", "sweep.js"), "utf8");
  const AsyncFunction = (async () => {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", workflow.replace(/^export const meta/m, "const meta")));
});
