// picture-this's kit, held to the rules that make a still an exact frame of
// the live figure and let the kit be copied into any React repo. CI cannot
// type-check or render the kit (the repo has no dependencies), so these rules
// are read off the source: a figure is a function of the clock, nothing moves
// on a timer of its own, and nothing is imported that the repo may not have.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const KIT = path.join(REPO, "plugins", "picture-this", "kit");
/** The files that own the frame loop: the only place a frame is asked for. */
const FRAME_LOOP = ["stage.tsx"];
/** React-free and import-free, so Node can import them as they are and a 3D scene can share them. */
const PURE = ["timeline.ts", "model.ts", "iso/project.ts"];

const files = fs.readdirSync(KIT, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/"))
  .filter((f) => fs.statSync(path.join(KIT, f)).isFile());
const read = (rel) => fs.readFileSync(path.join(KIT, rel), "utf8");
const code = files.filter((f) => /\.(ts|tsx)$/.test(f));
const styles = files.filter((f) => f.endsWith(".css"));
/** Source with comments and string contents removed, so a rule is matched against code only. */
const bare = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (source) => [...bare(source).matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)]
  .map((m) => ({ typeOnly: Boolean(m[2]), from: m[3] ?? m[4] }));

test("the kit has its pure core", () => {
  for (const rel of PURE) assert.ok(files.includes(rel), rel);
});

test("nothing in the kit moves on its own: no keyframes, transitions, timers, or randomness", () => {
  for (const rel of styles) {
    const css = bare(read(rel));
    assert.doesNotMatch(css, /@keyframes/, `${rel}: a figure is drawn from the clock, not from keyframes`);
    assert.doesNotMatch(css, /(^|[\s;{])(transition|animation)(-[a-z-]+)?\s*:/m, `${rel}: no transition or animation property`);
  }
  for (const rel of code) {
    const source = bare(read(rel));
    assert.doesNotMatch(source, /\bMath\.random\b/, `${rel}: the same clock time draws the same picture`);
    assert.doesNotMatch(source, /\bDate\.now\b|\bnew Date\b/, `${rel}: the wall clock is not the figure's clock`);
    assert.doesNotMatch(source, /\bset(Timeout|Interval)\b/, `${rel}: the clock is the only timer`);
    assert.doesNotMatch(source, /\b(transition|animation)(Duration|Delay|Name)?\s*:/, `${rel}: no inline transition or animation`);
    assert.doesNotMatch(source, /<animate|<animateMotion|<animateTransform|<set\b/, `${rel}: no SMIL`);
    if (!FRAME_LOOP.includes(rel)) {
      assert.doesNotMatch(source, /\brequestAnimationFrame\b|\bperformance\.now\b/, `${rel}: only the stage asks for frames`);
    }
  }
});

test("the kit imports React and its own files, and nothing else", () => {
  for (const rel of code) {
    for (const { from } of imports(read(rel))) {
      if (from.startsWith(".")) {
        assert.doesNotMatch(from, /\.(ts|tsx|js|jsx|mjs)$/, `${rel}: '${from}' names an extension, which a strict tsconfig refuses`);
        const base = path.join(KIT, path.dirname(rel), from);
        const found = from.endsWith(".css") ? fs.existsSync(base) : [".ts", ".tsx", "/index.ts"].some((ext) => fs.existsSync(base + ext));
        assert.ok(found, `${rel}: '${from}' is not a file in the kit`);
      } else {
        assert.ok(from === "react", `${rel}: imports '${from}': the kit depends on React alone`);
      }
    }
  }
});

test("the pure core imports nothing at run time and uses only syntax Node can strip", () => {
  for (const rel of PURE) {
    const source = read(rel);
    for (const { typeOnly, from } of imports(source)) assert.ok(typeOnly, `${rel}: imports '${from}' as a value`);
    assert.doesNotMatch(bare(source), /^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s|^\s*(export\s+)?namespace\s/m, `${rel}: no enum or namespace`);
    assert.doesNotMatch(bare(source), /\b(document|window|navigator)\./, `${rel}: no DOM`);
    assert.doesNotMatch(bare(source), /from\s+["']react["']/, `${rel}: no React`);
  }
});

test("every client file says so, and none reaches for a React 19-only or global-JSX type", () => {
  for (const rel of code.filter((f) => f.endsWith(".tsx"))) {
    const source = read(rel);
    assert.match(source, /^"use client";\n/, `${rel}: starts with "use client" (inert outside Next)`);
    const stripped = bare(source);
    assert.doesNotMatch(stripped, /(^|[^.\w])JSX\./, `${rel}: the global JSX namespace is gone in React 19's types; use React.JSX or ReactNode`);
    assert.doesNotMatch(stripped, /\buse\(/, `${rel}: use() is React 19 only`);
  }
});

test("class names and custom properties carry the pt- prefix, so a host page cannot collide", () => {
  for (const rel of styles) {
    const css = bare(read(rel));
    for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      // A class selector, not a decimal or a file extension: it follows a selector boundary.
      const before = css[m.index - 1] ?? " ";
      if (/[\d\w)]/.test(before)) continue;
      assert.ok(m[1].startsWith("pt-") || m[1] === "dark", `${rel}: class .${m[1]}`);
    }
    for (const m of css.matchAll(/(^|[\s;{(,])(--[\w-]+)\s*:/gm)) assert.ok(m[2].startsWith("--pt-"), `${rel}: custom property ${m[2]}`);
  }
});

test("the kit holds no test, story, or build output", () => {
  assert.deepEqual(files.filter((f) => /\.(test|spec|stories)\.|(^|\/)(dist|node_modules)\//.test(f)), []);
});
