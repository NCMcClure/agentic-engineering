// system-map's Stop hook: when a turn's uncommitted changes left the system
// map behind the code, the agent is told while it still holds the change. A
// warning, never a refusal, said to the agent once a session. The hook cases
// cover the fixtures, none of which carries a system map; the repos that do
// are built here, from three small modules and the map the plugin's own
// checker writes for them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hookCommand } from "../../lib.mjs";
import { run } from "../../../plugins/agentcraft/skills/system-map/scripts/system-map.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentcraft", "skills", "system-map");
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;

const CART = `// @system node cart "Cart" layer=surface
// @system calls orders "places the order"
import { place } from "../orders/index.mjs";

// @system exposes checkout "takes payment"
export function checkout(cart) {
  return place(cart.items);
}
`;
const ORDERS = `// @system node orders "Orders" layer=service
// @system calls stock "reserves each item"
import { reserve } from "../stock/index.mjs";

// @system exposes place "records one order"
export function place(items) {
  return { items: items.map(reserve) };
}
`;
const STOCK = `// @system node stock "Stock" layer=service
const shelf = new Map([["mug", 12]]);

// @system exposes reserve "holds one item"
export function reserve(item) {
  shelf.set(item, left(item) - 1);
  return item;
}

// @system exposes left "counts what is left"
export function left(item) {
  return shelf.get(item) ?? 0;
}
`;
const IMPORT = 'import { left } from "../stock/index.mjs";\n';
const CALLS = '// @system calls stock "asks what is left"\n';
/** Cart as a later turn leaves it: reading from Stock, with or without the line that declares it. */
const cartReading = (declared) => CART.replace("\n// @system exposes", `${declared ? CALLS : ""}${IMPORT}\n// @system exposes`);

/** A shop of three modules with its map written by the checker and everything committed. */
function shop(t, config = {}) {
  const { dir, git } = tempRepo(t, "map-stop-");
  write(dir, ".agents/system-map.json", JSON.stringify(config) + "\n");
  write(dir, "cart/index.mjs", CART);
  write(dir, "orders/index.mjs", ORDERS);
  write(dir, "stock/index.mjs", STOCK);
  const report = run(dir, { write: true });
  assert.equal(report.summary.warning, 0, JSON.stringify(report.findings));
  git("add", "-A");
  git("commit", "-q", "-m", "shop: cart, orders, stock, and their map");
  return { dir, git };
}

function stop(t, dir, extra = {}, env = {}) {
  const config = tempDir(t, "map-stop-settings-");
  const payload = extra === null ? null : { hook_event_name: "Stop", session_id: path.basename(dir), cwd: dir, stop_hook_active: false, ...extra };
  const out = runNode(path.join(PLUGIN, "hooks", "stop-check.mjs"), [], {
    cwd: dir,
    input: payload ? JSON.stringify(payload) : "",
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: config, USERPROFILE: config, CLAUDE_PROJECT_DIR: "", ...env },
  });
  const parsed = out.stdout.trim() ? JSON.parse(out.stdout) : null;
  return { ...out, parsed, context: parsed?.hookSpecificOutput?.additionalContext ?? "", line: parsed?.systemMessage ?? "" };
}
const silent = (out, why) => assert.deepEqual([out.status, out.stdout, out.stderr], [0, "", ""], why);

// ---- what is registered -----------------------------------------------------

test("hooks.json runs the Stop hook behind the quiet guard, with time to walk a tree", () => {
  assert.equal(HOOKS.Stop.length, 1);
  const [entry] = HOOKS.Stop[0].hooks;
  assert.equal(entry.command, hookCommand("system-map", "hooks/stop-check.mjs"));
  assert.ok(entry.timeout >= 10 && entry.timeout <= 30, `timeout ${entry.timeout}`);
  assert.equal(HOOKS.Stop[0].matcher, undefined);
});

// ---- a turn that left the map behind ---------------------------------------

test("an import nobody declared reaches the agent with its file and line, and says how to bring the map level", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(false));
  const out = stop(t, dir);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.parsed.hookSpecificOutput.hookEventName, "Stop");
  assert.match(out.context, /^System map, before you finish:/);
  assert.match(out.context, /UNDECLARED_IMPORT cart\/index\.mjs:4/);
  assert.ok(out.context.includes("/system-map:diagrams-sync"), out.context);
  assert.ok(out.context.includes("Diagram: none, <why>"), out.context);
  assert.match(out.line, /^system-map told the agent the map fell behind this turn: 1 finding\.$/);
  assert.ok(!out.context.includes(dir), "the note carries the repo's path");
});

test("a declared call whose map was not written again is told as a stale map", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(true));
  const out = stop(t, dir);
  assert.match(out.context, /MAP_STALE diagrams\/system-map\.json/);
  assert.ok(!out.context.includes("UNDECLARED_IMPORT"), out.context);
});

test("a turn that declared the call and wrote the map is left alone", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(true));
  run(dir, { write: true });
  silent(stop(t, dir), "the map is level");
});

// ---- when it keeps quiet ----------------------------------------------------

test("a turn that changed nothing since HEAD is left alone, even over a map committed stale", (t) => {
  const { dir, git } = shop(t);
  silent(stop(t, dir), "a clean tree");
  write(dir, "cart/index.mjs", cartReading(true));
  git("commit", "-q", "-am", "cart reads stock");
  silent(stop(t, dir), "committed work is CI's to check");
});

test("a board that is behind the map is the person's to publish, not the agent's turn to spend", (t) => {
  const { dir } = shop(t, { board: "https://miro.com/app/board/uXjTEST=/", publishedHash: "0000000000000000" });
  write(dir, "stock/index.mjs", STOCK.replace("12", "24"));
  const report = run(dir, { changed: "HEAD" });
  assert.deepEqual(report.findings.map((f) => f.code), ["BOARD_BEHIND"]);
  silent(stop(t, dir), "info only");
});

test("a repo with no system map config is never checked", (t) => {
  const { dir, git } = tempRepo(t, "map-stop-none-");
  write(dir, "cart/index.mjs", CART);
  git("add", "-A");
  git("commit", "-q", "-m", "cart");
  write(dir, "cart/index.mjs", cartReading(false));
  silent(stop(t, dir), "no .agents/system-map.json");
});

test("the continuation the hook caused is not judged again", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(false));
  silent(stop(t, dir, { stop_hook_active: true }), "stop_hook_active");
});

// ---- told once ---------------------------------------------------------------

test("the same findings reach the agent once a session; after that only the person's line repeats", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(false));
  const first = stop(t, dir, { session_id: `${path.basename(dir)}-a` });
  assert.ok(first.context);
  const again = stop(t, dir, { session_id: `${path.basename(dir)}-a` });
  assert.equal(again.parsed.hookSpecificOutput, undefined, "the agent was told twice");
  assert.match(again.line, /^system-map: the map is still behind this session's changes \(1 finding\); the agent was told once\.$/);
  const other = stop(t, dir, { session_id: `${path.basename(dir)}-b` });
  assert.ok(other.context, "another session was not told");
  // Different findings in the first session are new, and are told.
  write(dir, "cart/index.mjs", cartReading(true));
  const changed = stop(t, dir, { session_id: `${path.basename(dir)}-a` });
  assert.match(changed.context, /MAP_STALE/);
});

test("a long list is cut to four findings and a line that says how to see the rest", (t) => {
  const { dir } = shop(t);
  for (const name of ["a", "b", "c", "d", "e", "f"]) {
    write(dir, `${name}/index.mjs`, `// @system node ${name} "${name.toUpperCase()}" layer=surface\nimport { left } from "../stock/index.mjs";\n\n// @system internal use\nexport const use = left;\n`);
  }
  const out = stop(t, dir);
  const bullets = out.context.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 5, out.context);
  assert.match(bullets[4], /^- and \d+ more: node ".*system-map\.mjs" --changed HEAD lists them\.$/);
  assert.ok(out.context.length < 2000, `the note is ${out.context.length} characters`);
});

// ---- the contract every hook keeps ------------------------------------------

test("the hook judges the work tree of the payload's cwd, not the project dir", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(false));
  const elsewhere = tempRepo(t, "map-stop-main-").dir;
  const out = stop(t, dir, {}, { CLAUDE_PROJECT_DIR: elsewhere });
  assert.match(out.context, /UNDECLARED_IMPORT/);
  silent(stop(t, elsewhere, {}, { CLAUDE_PROJECT_DIR: dir }), "the project dir was judged");
});

test("the hook writes nothing in the repo", (t) => {
  const { dir, git } = shop(t);
  write(dir, "cart/index.mjs", cartReading(true));
  const before = git("status", "--porcelain");
  stop(t, dir);
  assert.equal(git("status", "--porcelain"), before);
  assert.notEqual(run(dir, {}).findings.find((f) => f.code === "MAP_STALE"), undefined, "the hook wrote the map");
});

test("empty stdin, malformed JSON, and a folder that is not a repo all exit 0 with nothing printed", (t) => {
  const { dir } = shop(t);
  write(dir, "cart/index.mjs", cartReading(false));
  silent(stop(t, dir, null), "empty stdin");
  for (const input of ['{"stop_hook_active": fals', "[]", "null", "7"]) {
    const out = runNode(path.join(PLUGIN, "hooks", "stop-check.mjs"), [], { cwd: dir, input, env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
    assert.deepEqual([out.status, out.stdout, out.stderr], [0, "", ""], input);
  }
  silent(stop(t, tempDir(t, "map-stop-plain-")), "not a repo");
});
