// The kanban pane is a mod: it runs inside Claude Code with no Node of its
// own and reaches the disk and processes through the engine alone. And it is
// never the board's writer: every change is a run of the board CLI, which
// takes the board's lock. So the files under hooks/kanban/ import only
// 'claude-code', each other, and the pure modules of lib/; they name no node:
// module, write no file by any road, and call the engine only from the hooks
// module. No TypeScript is left to build.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KANBAN, PLUGIN } from "./agent-works-pane-host.mjs";

const files = fs.readdirSync(KANBAN, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(KANBAN, f)).isFile());
const read = (file) => fs.readFileSync(file, "utf8");
const imports = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
// Comments say what the code does, in words a pattern below could trip on.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("hooks/kanban/ holds the pane's modules, each a .mjs file the host loads as it is", () => {
  assert.ok(files.includes("register.mjs"), "the hooks module");
  assert.ok(files.includes("board.client.mjs"), "the surface module");
  assert.deepEqual(files.filter((f) => !f.endsWith(".mjs")), [], "nothing to compile, nothing else shipped");
});

test("no TypeScript is left in the plugin, and no build configuration for it", () => {
  const left = fs.readdirSync(PLUGIN, { recursive: true }).map(String)
    .filter((f) => !f.split(path.sep).includes("node_modules") && /\.(ts|tsx|mts|cts)$/.test(f));
  assert.deepEqual(left, []);
  assert.equal(fs.existsSync(path.join(PLUGIN, "tsconfig.json")), false, "tsconfig.json");
  assert.equal(fs.existsSync(path.join(PLUGIN, "types")), false, "types/");
});

for (const file of files.filter((f) => f.endsWith(".mjs"))) {
  const text = read(path.join(KANBAN, file));
  const body = code(text);

  test(`hooks/kanban/${file} imports only claude-code, its siblings, and lib/`, () => {
    for (const s of imports(text)) assert.match(s, /^(claude-code|\.\/[\w.-]+\.mjs|\.\.\/\.\.\/lib\/[\w.-]+\.mjs)$/, `${file} imports ${s}`);
    assert.doesNotMatch(body, /["']node:/, `${file} names a node: module`);
    assert.doesNotMatch(body, /\bimport\s*\(/, `${file} holds an import(): a module that does is not loaded`);
    assert.doesNotMatch(body, /\brequire\s*\(/, `${file} calls require`);
    assert.doesNotMatch(body, /(?<![\w$.])process\./, `${file} reads Node's process`);
  });

  test(`hooks/kanban/${file} writes no file: not through Node, not through the engine`, () => {
    assert.doesNotMatch(body, /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync|rename|rmSync|unlink|unlinkSync|mkdirSync|mkdir|copyFile|copyFileSync)\s*\(/, `${file} calls a file-writing function`);
    assert.doesNotMatch(body, /\bfs\s*\.\s*(write|append|remove|delete|move|mkdir|copy|rename)\w*/, `${file} asks the engine to change a file`);
    assert.doesNotMatch(body, /\bstore\s*\.\s*(set|write|put)\b/, `${file} keeps state in the engine's store`);
  });

  if (file !== "register.mjs") {
    test(`hooks/kanban/${file} never holds the engine: it takes the host register.mjs builds`, () => {
      assert.doesNotMatch(body, /(?<![\w$])\$\s*[.)\],]/, `${file} reaches for $`);
    });
  }
}

test("the lib modules the pane loads are pure, all the way down: no node: module, no process", () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = read(file);
    if (!file.startsWith(KANBAN)) {
      assert.doesNotMatch(code(text), /["']node:/, `${path.relative(PLUGIN, file)} names a node: module, and the pane loads it`);
      assert.doesNotMatch(code(text), /(?<![\w$.])process\./, `${path.relative(PLUGIN, file)} reads process, and the pane loads it`);
    }
    for (const s of imports(text)) if (s.startsWith(".")) visit(path.resolve(path.dirname(file), s));
  };
  for (const entry of ["register.mjs", "board.client.mjs"]) visit(path.join(KANBAN, entry));
  const lib = [...seen].filter((f) => !f.startsWith(KANBAN)).map((f) => path.relative(PLUGIN, f).split(path.sep).join("/"));
  assert.ok(lib.includes("lib/board.mjs"), "the board's rules are lib's, not a copy");
  for (const f of lib) assert.match(f, /^lib\//, `${f} is outside lib/`);
});

test("the engine's file-reading calls are the only ones on its fs noun, and they are in register.mjs", () => {
  const calls = [...code(read(path.join(KANBAN, "register.mjs"))).matchAll(/\$\.fs\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(calls)], ["exists", "list"]);
});

test("the surface module is named by a literal path beside the view that draws it", () => {
  const named = [...code(read(path.join(KANBAN, "views.mjs"))).matchAll(/module:\s*("[^"]*"|'[^']*'|`[^`]*`|[^,}\s]+)/g)].map((m) => m[1]);
  assert.deepEqual(named, ['"./board.client.mjs"']);
});
