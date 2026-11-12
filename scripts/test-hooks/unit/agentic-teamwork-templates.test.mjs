// agentic-teamwork's templates themselves: what a new repo gets on day one has
// to render completely and pass its own first pipeline, and nothing in it may
// assume a host, a registry, or a deploy system the repo did not choose.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { render, walk } from "../../../plugins/agentic-teamwork/scripts/render.mjs";
import { REPO, runNode, tempDir } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-teamwork");
const TEMPLATES = path.join(PLUGIN, "templates");
const STARTERS = ["library", "node-service"];
const LANE_TOKENS = ["UNIT_CMD", "INTEGRATION_CMD", "E2E_CMD", "LIVE_CMD"];
const config = (starter) => JSON.parse(fs.readFileSync(path.join(TEMPLATES, starter, "template.json"), "utf8"));
const tokensFor = (starter) => ({
  PROJECT: `zz-${starter}`, DESCRIPTION: "A scaffold rendered to check it.", TEMPLATE: starter, DEFAULT_BRANCH: "main",
  STANDARD_VERSION: "1", CHANGE_NOUN: "pull request", LAYOUT: config(starter).layout.join("\n"), ...config(starter).lanes,
});

// A test run started from inside this one must report like any other run, not as its child.
const plainEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.RUN_DB_TESTS;
  return env;
};

/** A starter rendered over `common`, as a fresh scaffold lays it down. */
function rendered(t, starter) {
  const dir = tempDir(t, `template-${starter}-`);
  const unknown = [];
  for (const source of ["common", starter]) unknown.push(...render(path.join(TEMPLATES, source), dir, tokensFor(starter)).unknown);
  return { dir, unknown };
}

test("the starters are exactly the ones the scaffold offers", () => {
  const found = fs.readdirSync(TEMPLATES).filter((d) => fs.existsSync(path.join(TEMPLATES, d, "template.json"))).sort();
  assert.deepEqual(found, STARTERS);
});

test("every starter names its layout and all four lanes", () => {
  for (const starter of STARTERS) {
    const c = config(starter);
    assert.equal(c.name, starter);
    assert.ok(c.layout.length > 0 && c.layout.every((l) => /^- `[^`]+`/.test(l)), `${starter}: layout lines are list items naming a path`);
    assert.deepEqual(Object.keys(c.lanes), LANE_TOKENS, starter);
    assert.doesNotMatch(c.lanes.UNIT_CMD, /^not wired/, `${starter}: the unit lane runs from day one`);
  }
});

test("every starter renders with no token left over, and its JSON parses", (t) => {
  for (const starter of STARTERS) {
    const { dir, unknown } = rendered(t, starter);
    assert.deepEqual(unknown, [], starter);
    for (const rel of walk(dir)) {
      const text = fs.readFileSync(path.join(dir, rel), "utf8");
      assert.doesNotMatch(text, /\{\{[A-Z0-9_]+\}\}/, `${starter}/${rel}`);
      if (rel.endsWith(".json")) assert.doesNotThrow(() => JSON.parse(text), `${starter}/${rel}`);
    }
  }
});

test("every test lane a starter ships has a test file to run, and none passes on nothing", () => {
  const lanes = [];
  for (const starter of STARTERS) {
    for (const rel of walk(path.join(TEMPLATES, starter)).filter((f) => path.basename(f) === "package.json")) {
      const dir = path.dirname(path.join(TEMPLATES, starter, rel));
      for (const [name, script] of Object.entries(JSON.parse(fs.readFileSync(path.join(TEMPLATES, starter, rel), "utf8")).scripts ?? {})) {
        assert.doesNotMatch(script, /--passWithNoTests/, `${starter}/${rel} ${name}`);
        const glob = /\bnode --test(?: --watch)? "([^"*]+)\*\*/.exec(script)?.[1];
        if (glob) lanes.push({ where: `${starter}/${rel} ${name}`, dir: path.join(dir, glob) });
      }
    }
  }
  assert.ok(lanes.length >= 3, "the walk found the lanes");
  // A lane with no test file fails its first run, or worse, passes on nothing.
  const empty = lanes.filter((l) => !walk(l.dir).some((f) => /\.test\.mjs$/.test(f))).map((l) => l.where);
  assert.deepEqual(empty, []);
});

test("a rendered starter's unit lane passes as shipped, run the way CI runs it", (t) => {
  for (const starter of STARTERS) {
    const { dir } = rendered(t, starter);
    fs.mkdirSync(path.join(dir, ".agents"), { recursive: true });
    const lanes = Object.fromEntries(LANE_TOKENS.map((token) => [token.replace("_CMD", "").toLowerCase(), config(starter).lanes[token]]));
    fs.writeFileSync(path.join(dir, ".agents", "manifest.json"), JSON.stringify({ lanes }));
    const run = runNode(path.join(dir, ".agents", "scripts", "lane.mjs"), ["unit"], { cwd: dir, env: plainEnv() });
    assert.equal(run.status, 0, `${starter}:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /\bpass [1-9]/, `${starter}: tests ran`);
  }
});

test("the gated integration test says it was skipped rather than vanishing", (t) => {
  const { dir } = rendered(t, "node-service");
  const lane = path.join(dir, "server", "test", "integration");
  const tests = walk(lane).filter((f) => f.endsWith(".test.mjs"));
  assert.ok(tests.length > 0);
  for (const file of tests) assert.match(fs.readFileSync(path.join(lane, file), "utf8"), /\{ skip: !RUN && "RUN_DB_TESTS is not 1" \}/, file);
  const run = runNode(path.join(lane, tests[0]), [], { cwd: path.join(dir, "server"), env: plainEnv() });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /RUN_DB_TESTS is not 1/, "the reason prints with the skipped suite");
});

test("the service starter has no dependencies, and a lockfile that says so", (t) => {
  const { dir } = rendered(t, "node-service");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "server", "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "server", "package-lock.json"), "utf8"));
  assert.equal(pkg.dependencies ?? pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(lock.packages), [""], "nothing to fetch from any registry");
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.packages[""].version, pkg.version);
});

test("the CI gate for each forge runs the repo's own check and its unit lane", () => {
  for (const gate of ["github.yml", "gitlab.yml"]) {
    const text = fs.readFileSync(path.join(TEMPLATES, "ci", gate), "utf8");
    assert.match(text, /node \.agents\/scripts\/verify-standard\.mjs/, gate);
    assert.match(text, /node \.agents\/scripts\/lane\.mjs unit/, gate);
  }
  assert.match(fs.readFileSync(path.join(TEMPLATES, "ci", "gitlab-ci.yml"), "utf8"), /^ {2}- local: \.gitlab\/ci\/team-conventions\.yml$/m);
});

test("the ignore block is fenced, keeps secrets out, and leaves the shared settings tracked", () => {
  const block = fs.readFileSync(path.join(TEMPLATES, "common", "gitignore.block"), "utf8");
  const lines = block.trim().split("\n");
  assert.equal(lines[0], "# >>> agentic-teamwork");
  assert.equal(lines.at(-1), "# <<< agentic-teamwork");
  for (const wanted of [".env", ".env.*", "!.env.example", ".claude/settings.local.json", "node_modules/"]) assert.ok(lines.includes(wanted), wanted);
  assert.equal(lines.some((l) => /^\.claude\/?\*?$/.test(l)), false, ".claude/ itself is the repo's to track");
});

test("the settings to merge are permission rules and one hook that runs a script the scaffold ships", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "settings.merge.json"), "utf8"));
  assert.deepEqual(Object.keys(settings), ["permissions", "hooks"]);
  assert.ok(settings.permissions.deny.length >= 5 && settings.permissions.deny.every((e) => /^Bash\(git (push|commit) /.test(e)));
  const commands = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(commands.length, 1);
  const script = /node "\$CLAUDE_PROJECT_DIR\/(\.agents\/scripts\/[a-z-]+\.mjs)"$/.exec(commands[0])?.[1];
  assert.ok(script && fs.existsSync(path.join(TEMPLATES, "common", script)), commands[0]);
  assert.ok(commands[0].startsWith("command -v node >/dev/null 2>&1 || exit 0; "), "a machine without Node gets silence, not an error");
});

test("nothing the scaffold ships needs a script it does not ship", () => {
  const shipped = new Set(fs.readdirSync(path.join(TEMPLATES, "common", ".agents", "scripts")));
  assert.deepEqual([...shipped].sort(), ["lane.mjs", "plugin-check.mjs", "verify-standard.mjs"]);
  const files = [...walk(TEMPLATES).map((f) => path.join(TEMPLATES, f)), ...walk(path.join(PLUGIN, "skills")).map((f) => path.join(PLUGIN, "skills", f))];
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/\.agents\/scripts\/([a-z-]+\.mjs)/g)) {
      assert.ok(shipped.has(m[1]), `${path.relative(REPO, file)} names .agents/scripts/${m[1]}`);
    }
  }
});

test("the conventions' version and floor are whole numbers, the floor no higher", () => {
  const standard = JSON.parse(fs.readFileSync(path.join(PLUGIN, "standard.json"), "utf8"));
  assert.ok(Number.isInteger(standard.standard_version) && Number.isInteger(standard.floor));
  assert.ok(standard.floor >= 1 && standard.floor <= standard.standard_version);
});
