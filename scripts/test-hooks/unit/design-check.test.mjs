// lib/design-check.mjs: the checker a repo on a design system runs. Its pure
// half (what counts as a raw colour, which class tokens are read and how a
// token's utility is found, how allow entries suppress and rot), then the
// tree walk and the command, on the invented house-ui system's consumer app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REPO } from "../fixtures.mjs";
import { DEFAULT_INCLUDE, check, classTokens, colorValues, filesFor, globToRegExp, main, utilityOf } from "../../../plugins/agentic-engineering/lib/design-check.mjs";

const CHECKER = path.join(REPO, "plugins", "agentic-engineering", "lib", "design-check.mjs");
const CONSUMER = path.join(REPO, "scripts", "test-hooks", "fixtures", "design-system", "consumer");
const BANNED = { values: ["color"], classes: [{ name: "radius", pattern: "^rounded(-.+)?$" }, { name: "shadow", pattern: "^shadow(-.+)?$" }] };
const PIN = { schema: 1, system: "house-ui", version: "0.2.0", source: "house/ui", ref: "v0.2.0", tokens: ["src/styles/tokens.css"], banned: BANNED, allow: "design-allow.json", include: DEFAULT_INCLUDE, exclude: [] };

/** A copy of the consumer app with a pin, and an allow file when given. */
function consumer(t, { pin = PIN, allow = null } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "design-check-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(CONSUMER, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".agents", "design.json"), JSON.stringify(pin, null, 2));
  if (allow) fs.writeFileSync(path.join(dir, pin.allow), JSON.stringify(allow, null, 2));
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [CHECKER, ...args], { cwd: dir, encoding: "utf8" });
const one = (text, file = "a.tsx") => check([{ path: file, text }], PIN).findings.map((f) => [f.line, f.rule, f.text]);

test("utilityOf: the last segment outside brackets, without a leading ! or - or a trailing !", () => {
  assert.equal(utilityOf("rounded-lg"), "rounded-lg");
  assert.equal(utilityOf("md:hover:rounded-lg"), "rounded-lg");
  assert.equal(utilityOf("!rounded"), "rounded");
  assert.equal(utilityOf("-mt-2"), "mt-2");
  assert.equal(utilityOf("md:!-translate-x-1"), "translate-x-1");
  assert.equal(utilityOf("rounded-lg!"), "rounded-lg");
  assert.equal(utilityOf("[&:hover]:rounded-[4px]"), "rounded-[4px]", "a colon inside brackets does not split");
  assert.equal(utilityOf("bg-[url(a:b)]"), "bg-[url(a:b)]");
});

test("classTokens: attribute strings, the class helpers' string arguments, @apply, and no template expression", () => {
  const tokens = (text) => classTokens(text).map((t) => t.token);
  assert.deepEqual(tokens(`<div class="a rounded">`), ["a", "rounded"]);
  assert.deepEqual(tokens(`<div className='b shadow'>`), ["b", "shadow"]);
  assert.deepEqual(tokens("<div className={`c ${on ? 'x' : 'y'} d`}>"), ["c", "d"]);
  assert.deepEqual(tokens(`<p :class="e">`), ["e"]);
  assert.deepEqual(tokens(`cn("f", on && "g", { "h": true })`), ["f", "g", "h"]);
  assert.deepEqual(tokens(`const v = cva("base", { variants: { size: { sm: "rounded-sm", lg: 'rounded-lg' } } });`), ["base", "rounded-sm", "rounded-lg"]);
  assert.deepEqual(tokens(`clsx(\n  "i",\n  "j"\n)`), ["i", "j"]);
  assert.deepEqual(tokens(".x { @apply rounded-md font-bold; }"), ["rounded-md", "font-bold"]);
  assert.deepEqual(tokens(`foo.cn("no") + mycn("no")`), [], "a method or a longer name is not a helper");
  assert.deepEqual(tokens(`const label = "rounded";`), [], "a plain string is not a class");
});

test("colorValues: hex and colour functions with a number left once var() is out; private names, entities and ids are not colours", () => {
  const found = (text) => colorValues(text).map((c) => c.text);
  assert.deepEqual(found("color: #fff; background: #12345678; border: #abcd"), ["#fff", "#12345678", "#abcd"]);
  assert.deepEqual(found("a: rgb(1 2 3); b: rgba(0,0,0,.5); c: hsl(210 40% 98%); d: oklch(0.6 0.1 250)"), ["rgb(1 2 3)", "rgba(0,0,0,.5)", "hsl(210 40% 98%)", "oklch(0.6 0.1 250)"]);
  assert.deepEqual(found("a: hsl(var(--primary)); b: rgb(var(--x, var(--y)))"), [], "a token, however wrapped, is not a raw value");
  assert.deepEqual(found("a: hsl(var(--primary) / 0.5)"), ["hsl(var(--primary) / 0.5)"], "a number beside the token is a raw value");
  assert.deepEqual(found("color(display-p3 1 0 0) and color(x)"), ["color(display-p3 1 0 0)"], "color() is a colour only with a colour space");
  assert.deepEqual(found("this.#add(); &#123; #add-button {} #header {} href=\"#top\""), []);
  assert.deepEqual(found("className=\"bg-[#0b6e4f]\""), ["#0b6e4f"], "an arbitrary value is a raw value");
});

test("check: a finding per raw colour and banned class, with its line, rule, text, and a fix that names the rules and the allow file", () => {
  assert.deepEqual(one(`const a = "#fff";\n<div className="p-2 md:rounded-lg">\n<b className={cn("shadow", "house-card")} />`), [[1, "color", "#fff"], [2, "radius", "md:rounded-lg"], [3, "shadow", "shadow"]]);
  const [finding] = check([{ path: "a.css", text: "a { color: #000 }" }], PIN).findings;
  assert.match(finding.fix, /house-ui \(\.agents\/rules\/design\.md\), or allow it in design-allow\.json with a reason/);
  assert.deepEqual(check([{ path: "a.css", text: "a { color: #000 }" }], { ...PIN, banned: { values: [], classes: [] } }).findings, [], "nothing banned, nothing found");
  assert.deepEqual(check([{ path: "a.tsx", text: `<i className="x" />` }], { ...PIN, banned: { classes: [{ name: "bad", pattern: "(" }] } }).findings, [], "a pattern that does not compile bans nothing");
});

test("check: an allow entry suppresses what it names, needs a reason, and is reported once it matches nothing", () => {
  const files = [{ path: "src/charts/Line.tsx", text: `const a = "#0b6e4f"; const b = "#111";` }, { path: "src/App.tsx", text: `const c = "#0b6e4f";` }];
  const narrow = { file: "src/charts/**", rule: "color", text: "#0b6e4f", reason: "the partner's colour" };
  let r = check(files, PIN, { allow: [narrow] });
  assert.deepEqual(r.findings.map((f) => [f.file, f.text]), [["src/App.tsx", "#0b6e4f"], ["src/charts/Line.tsx", "#111"]]);
  assert.deepEqual(r.allowed.map((a) => [a.file, a.reason]), [["src/charts/Line.tsx", "the partner's colour"]]);

  r = check(files, PIN, { allow: [{ file: "src/**", rule: "color" }] });
  assert.equal(r.findings.filter((f) => f.rule === "color").length, 3, "with no reason it allows nothing");
  assert.match(r.findings.find((f) => f.rule === "allow").fix, /needs a reason/);

  r = check(files, PIN, { allow: [narrow, { file: "src/old/**", rule: "radius", reason: "gone" }] });
  const stale = r.findings.filter((f) => f.rule === "allow");
  assert.deepEqual(stale.map((f) => [f.file, f.text]), [["design-allow.json", "allow[1] src/old/** radius"]]);
  assert.match(stale[0].fix, /matches nothing now: delete it/);
  assert.equal(r.findings.at(-1).rule, "allow", "the allow file's findings come last");

  r = check(files, PIN, { allow: [{ file: "src/old/**", rule: "radius", reason: "gone" }], full: false });
  assert.equal(r.findings.some((f) => f.rule === "allow"), false, "a partial scan does not call an entry for an unscanned file stale");
  assert.match(check(files, PIN, { allow: [{ rule: "color", reason: "x" }] }).findings.at(-1).fix, /names a file glob and a rule/);
});

test("globs: ** any folders, * within one, braces either", () => {
  assert.ok(globToRegExp("**/*.{ts,tsx}").test("a.tsx"));
  assert.ok(globToRegExp("**/*.{ts,tsx}").test("src/a/b.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/a/b.ts"));
  assert.ok(globToRegExp("src/**").test("src/a/b.ts"));
  assert.ok(globToRegExp("src/**/x.css").test("src/x.css"));
  assert.ok(!globToRegExp("a.css").test("a-css"));
});

test("filesFor: the pin's globs, without node_modules, build output, .agents, declarations, minified files, or the token files", (t) => {
  const dir = consumer(t);
  for (const rel of ["node_modules/x/index.js", "dist/app.js", ".next/a.js", ".agents/scripts/design-check.mjs", "src/types.d.ts", "src/vendor.min.js", "src/readme.md"]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "const a = '#fff';\n");
  }
  assert.deepEqual(filesFor(dir, PIN), ["src/components/Card.tsx", "src/components/Promo.tsx", "src/styles/app.css"]);
  assert.deepEqual(filesFor(dir, { ...PIN, exclude: ["src/styles/**"] }), ["src/components/Card.tsx", "src/components/Promo.tsx"]);
  assert.deepEqual(filesFor(dir, { ...PIN, include: ["src/components/*.tsx"] }), ["src/components/Card.tsx", "src/components/Promo.tsx"]);
  assert.deepEqual(filesFor(dir, PIN, [path.join(dir, "src", "components", "Card.tsx")]), ["src/components/Card.tsx"], "a path narrows the scan");
});

test("the command: the on-system file is clean, each off-system thing is a line, and the exit code says which", (t) => {
  const dir = consumer(t);
  const r = run(dir);
  assert.equal(r.status, 1, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.deepEqual(lines.slice(0, -1).map((l) => l.split("  ").slice(0, 3).join(" | ")), [
    "src/components/Promo.tsx:6 | color | #ff6600",
    "src/components/Promo.tsx:6 | radius | md:rounded-xl",
    "src/components/Promo.tsx:7 | shadow | hover:!shadow-lg",
    "src/styles/app.css:2 | color | rgb(255 102 0 / 0.9)",
    "src/styles/app.css:7 | radius | rounded-md",
  ]);
  assert.equal(lines.at(-1), "design-check: 5 finding(s) in 3 file(s) against house-ui 0.2.0.");
  assert.doesNotMatch(r.stdout, /Card\.tsx|tokens\.css/, "tokens, and hsl(var(...)), are on-system");

  const clean = run(dir, "src/components/Card.tsx");
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /0 finding\(s\) in 1 file\(s\)/);

  const sub = path.join(dir, "src", "components");
  const json = run(sub, "--json");
  assert.equal(json.status, 1, "found from a folder below the pin");
  const report = JSON.parse(json.stdout);
  assert.deepEqual([report.system, report.version, report.files, report.findings.length, report.allowed], ["house-ui", "0.2.0", 3, 5, 0]);
});

test("the command: an allow file is read at the pin's path, and a missing or broken pin is a usage error", (t) => {
  const dir = consumer(t, { allow: { allow: [
    { file: "src/components/Promo.tsx", rule: "color", reason: "campaign colour until the system has one" },
    { file: "src/styles/**", rule: "radius", reason: "gone" },
    { file: "src/styles/app.css", rule: "color", text: "rgb(255 102 0", reason: "the same campaign" },
    { file: "src/never/**", rule: "shadow", reason: "stale" },
  ] } });
  const r = run(dir, "--json");
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.findings.map((f) => `${f.rule} ${f.text}`), ["radius md:rounded-xl", "shadow hover:!shadow-lg", "allow allow[3] src/never/** shadow"]);
  assert.equal(report.allowed, 3);

  const lines = [];
  assert.equal(main(["--root", fs.mkdtempSync(path.join(os.tmpdir(), "design-nopin-"))], { out: (l) => lines.push(l), err: (l) => lines.push(l) }), 2);
  assert.match(lines[0], /no \.agents\/design\.json here or above/);
  fs.writeFileSync(path.join(dir, ".agents", "design.json"), "{ nope");
  assert.equal(run(dir).status, 2);
  fs.writeFileSync(path.join(dir, ".agents", "design.json"), JSON.stringify(PIN));
  fs.writeFileSync(path.join(dir, "design-allow.json"), "{ nope");
  const broken = run(dir);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /design-allow\.json does not parse/);
});

test("the copy a repo gets is byte for byte the plugin's checker, and it needs nothing but Node", () => {
  const copy = path.join(REPO, "plugins", "agentic-engineering", "skills", "design", "routes", "adopt", "assets", "design-check.mjs");
  assert.equal(fs.readFileSync(copy, "utf8"), fs.readFileSync(CHECKER, "utf8"));
  for (const m of fs.readFileSync(CHECKER, "utf8").matchAll(/^import .* from "([^"]+)";$/gm)) assert.match(m[1], /^node:/, m[1]);
});
