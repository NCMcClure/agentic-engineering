// picture-this's kit, held to the rules that make a still an exact frame of
// the live figure and let the kit be copied into any React repo. CI cannot
// type-check or render the kit (the repo has no dependencies), so these rules
// are read off the source: a figure is a function of the clock, nothing moves
// on a timer of its own, and nothing is imported that the repo may not have.
// The 3D tier under three/ is held to the same rules, and is the one place
// three.js may be imported: the 2D tier depends on React alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const KIT = path.join(REPO, "plugins", "agentic-engineering", "skills", "docs", "kit");
/** The files that own the frame loop: the only place a frame is asked for. */
const FRAME_LOOP = ["stage.tsx"];
/** React-free and import-free, so Node can import them as they are and a 3D scene can share them. */
const PURE = ["timeline.ts", "model.ts", "iso/project.ts", "flat/geometry.ts"];
/** The 3D tier: the only folder that may import these packages. A portal needs react-dom, which every page that draws to a canvas has. */
const THREE_DIR = "three/";
const THREE_PACKAGES = ["three", "@react-three/fiber", "@react-three/drei"];
const isThreePackage = (from) => THREE_PACKAGES.includes(from) || from.startsWith("three/");
/** The one file that starts the renderer and watches its frames, to say which was drawn last. */
const CANVAS = "three/canvas.tsx";
/** What a page loads before it loads three.js: these stay free of it, so a server can render them. */
const THREE_FREE = ["three/look.ts", "three/scene.tsx"];

const files = fs.readdirSync(KIT, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/"))
  .filter((f) => fs.statSync(path.join(KIT, f)).isFile());
const read = (rel) => fs.readFileSync(path.join(KIT, rel), "utf8");
const code = files.filter((f) => /\.(ts|tsx)$/.test(f));
const styles = files.filter((f) => f.endsWith(".css"));
/** Source with comments and string contents removed, so a rule is matched against code only. */
const bare = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (source) => [...bare(source).matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)]
  .map((m) => ({ typeOnly: Boolean(m[2]), from: m[3] ?? m[4] }));
/** import("...") calls: how a file loads another only when it is needed. */
const lazyImports = (source) => [...bare(source).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const inKit = (rel, from) => {
  const base = path.join(KIT, path.dirname(rel), from);
  return from.endsWith(".css") ? fs.existsSync(base) : [".ts", ".tsx", "/index.ts"].some((ext) => fs.existsSync(base + ext));
};

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

test("the kit imports React and its own files, and nothing else; three.js only under three/", () => {
  for (const rel of code) {
    const three = rel.startsWith(THREE_DIR);
    for (const { from } of imports(read(rel))) {
      if (from.startsWith(".")) {
        assert.doesNotMatch(from, /\.(ts|tsx|js|jsx|mjs)$/, `${rel}: '${from}' names an extension, which a strict tsconfig refuses`);
        assert.ok(inKit(rel, from), `${rel}: '${from}' is not a file in the kit`);
        // The 2D tier never reaches into the 3D one: a repo that left three/ out must still build.
        if (!three) assert.doesNotMatch(path.posix.join(path.posix.dirname(rel), from), /^three\//, `${rel}: the 2D tier imports '${from}' from the 3D tier`);
      } else if (three) {
        assert.ok(from === "react" || from === "react-dom" || isThreePackage(from), `${rel}: imports '${from}': the 3D tier depends on React, react-dom and the three packages`);
      } else {
        assert.ok(from === "react", `${rel}: imports '${from}': the 2D tier depends on React alone`);
      }
    }
    for (const from of lazyImports(read(rel))) {
      assert.ok(from.startsWith(".") && inKit(rel, from), `${rel}: import('${from}') is not a file in the kit`);
    }
  }
});

test("the 3D tier is there, loads three.js lazily, and draws only when the stage's clock says so", () => {
  const three = code.filter((f) => f.startsWith(THREE_DIR));
  for (const rel of ["look.ts", "scene.tsx", "canvas.tsx", "rig.tsx", "materials.tsx", "shapes.tsx", "wire.tsx", "iso.tsx"]) assert.ok(three.includes(THREE_DIR + rel), THREE_DIR + rel);

  // Every one of the three packages is used, so the list a repo is asked to add is the list it needs.
  const used = new Set(three.flatMap((rel) => imports(read(rel)).map((i) => i.from)).filter(isThreePackage).map((from) => (from.startsWith("three/") ? "three" : from)));
  assert.deepEqual([...used].sort(), [...THREE_PACKAGES].sort());

  // What a page (and a server) loads first holds no three.js: the canvas arrives by import().
  for (const rel of THREE_FREE) {
    for (const { from } of imports(read(rel))) assert.ok(!isThreePackage(from), `${rel}: imports '${from}', so three.js would load with the page`);
  }
  assert.deepEqual(lazyImports(read("three/scene.tsx")), ["./canvas"], "the scene loads its canvas on demand");
  assert.match(bare(read("three/scene.tsx")), /\bfallback\b/, "and shows a fallback until it has drawn");

  // One renderer, started in one file, drawing on demand.
  const starters = three.filter((rel) => /<Canvas[\s>]/.test(bare(read(rel))));
  assert.deepEqual(starters, [CANVAS]);
  assert.match(bare(read(CANVAS)), /frameloop="demand"/, "a frame is drawn when the figure changes, and at no other time");
  for (const rel of three) {
    const source = bare(read(rel));
    if (rel !== CANVAS) assert.doesNotMatch(source, /\buseFrame\b/, `${rel}: only the canvas watches frames, and only to say which was drawn`);
    assert.doesNotMatch(source, /\b(elapsedTime|getElapsedTime|getDelta|oldTime)\b|\bclock\b|\bnew (Clock|Timer)\b/, `${rel}: the renderer's clock is not the figure's clock`);
    assert.doesNotMatch(source, /\bframeloop="always"|\bsetAnimationLoop\b/, `${rel}: no loop of its own`);
    // Labels stay flat, over the canvas: no text is set in 3D.
    for (const { from } of imports(read(rel))) if (from === "@react-three/drei") {
      const named = read(rel).match(/import\s*\{([^}]*)\}\s*from\s*["']@react-three\/drei["']/)?.[1] ?? "";
      assert.doesNotMatch(named, /\b(Text|Text3D|Html|Billboard)\b/, `${rel}: a label is flat SVG over the canvas, never 3D text`);
    }
  }
  // The frame watcher takes no time from the frame: it counts, and reports a name.
  assert.match(bare(read(CANVAS)), /useFrame\(\(\) => \{/, "the frame callback reads neither the renderer's state nor a time step");

  // The stage waits for a canvas to say it has drawn the held frame.
  assert.match(read("three/scene.tsx"), /data-pt-paints=\{painted\}/);
  assert.match(read("stage.tsx"), /\[data-pt-paints\]/);
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

test("the flat shapes are there, know nothing of the model, and take their state as props", () => {
  for (const rel of ["flat/geometry.ts", "flat/panel.tsx", "flat/connect.tsx", "flat/chart.tsx"]) assert.ok(files.includes(rel), rel);
  for (const rel of code.filter((f) => f.startsWith("flat/"))) {
    const source = bare(read(rel));
    // A primitive that asked the figure what to draw would only fit figures shaped like the ones it was written for.
    assert.doesNotMatch(source, /\buseFigure\b|from\s+["']\.\.\/(stage|model)["']/, `${rel}: a flat shape is drawn from its props, so it works in any figure`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|\brgba?\(/, `${rel}: every colour is a token`);
  }
});

test("the kit holds no test, story, or build output", () => {
  assert.deepEqual(files.filter((f) => /\.(test|spec|stories)\.|(^|\/)(dist|node_modules)\//.test(f)), []);
});
