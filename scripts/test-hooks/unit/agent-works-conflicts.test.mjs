// The parallel-set proposal, without a disk: which ready cards can start
// beside each other and beside the cards already in flight, and why the rest
// are held. Files overlap by path prefix; a regenerated file never counts, a
// list-like file only warns, a shared path always holds, and a `*` in a shared
// path stands for any directory a card works in, because every change to a
// plugin bumps its version line. The order is the board's, so the same board
// always proposes the same set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardConfig } from "../../../plugins/agent-works/lib/board.mjs";
import { conflictConfig, locksFor, propose } from "../../../plugins/agent-works/lib/conflicts.mjs";

// The rules as a repo's .agents/agent-works.json holds them: the conflict rules under kanban.conflicts, the locks beside them.
const conflicts = ({ rederived, merge, shared, resources, lockOrder } = {}) => conflictConfig({ kanban: { conflicts: { rederived, merge, shared } }, resources, lockOrder });

const T0 = "2026-10-01T09:00:00.000Z";
const card = (id, over = {}) => ({
  id, title: `Card ${id}`, status: "backlog", order: Number(id), priority: "normal", kind: "task",
  labels: [], skills: [], after: [], files: [], unknown: [], body: "", file: `${id}-card-${id}.md`,
  created: T0, updated: T0, ...over,
});
const board = (cards, config = {}) => ({ ...boardConfig(config), cards });
const ran = (p) => p.run.map((c) => c.id);
const held = (p) => Object.fromEntries(p.held.map((c) => [c.id, c.reasons.join("; ")]));

const REPO_CONFIG = conflicts({
  rederived: [
    { path: "plugins/agentic-teamwork/skills/marketplace-guide/SKILL.md", command: "node scripts/gen-guide.mjs --write" },
    { path: "diagrams/system-map.json", command: "node .agents/scripts/system-map.mjs --write" },
  ],
  merge: [".claude-plugin/marketplace.json", "plugins/AGENTS.md", "README.md"],
  shared: ["plugins/*/.claude-plugin/plugin.json", "plugins/*/README.md"],
  resources: { "test-db": { paths: ["db/"], scope: "project", long: true }, simulator: { paths: ["ios/"], scope: "machine" } },
  lockOrder: ["test-db", "simulator"],
});

test("disjoint ready cards run together, up to the parallel limit, in the board's order", () => {
  const b = board([card("0001", { files: ["a/"] }), card("0002", { files: ["b/"] }), card("0003", { files: ["c/"] })]);
  const p = propose(b, { config: REPO_CONFIG });
  assert.deepEqual(ran(p), ["0001", "0002"]);
  assert.match(held(p)["0003"], /parallel limit is 2/);
  assert.deepEqual(ran(propose(b, { config: REPO_CONFIG, max: 3 })), ["0001", "0002", "0003"]);
  assert.deepEqual(propose(b, { config: REPO_CONFIG }), p, "the same board proposes the same set");
});

test("a path-prefix overlap holds the later card and names the path", () => {
  const b = board([
    card("0001", { files: ["plugins/x/lib/"] }),
    card("0002", { files: ["plugins/x/lib/cards.mjs"] }),
    card("0003", { files: ["plugins/x/library.mjs"] }),
  ]);
  const p = propose(b, { config: conflicts(), max: 3 });
  assert.deepEqual(ran(p), ["0001", "0003"], "lib/ and library.mjs share characters, not a path");
  assert.match(held(p)["0002"], /overlaps 0001 \(proposed\) on plugins\/x\/lib\/cards\.mjs/);
});

test("cards in flight hold their files and their slots", () => {
  const b = board([
    card("0001", { status: "in-progress", files: ["src/index.mjs"] }),
    card("0002", { status: "review", mr: 4, files: ["docs/"] }),
    card("0003", { files: ["src/"] }),
    card("0004", { files: ["test/"] }),
  ]);
  const p = propose(b, { config: conflicts(), max: 3 });
  assert.deepEqual(p.inFlight.map((c) => c.id), ["0001", "0002"]);
  assert.deepEqual(ran(p), ["0004"]);
  assert.match(held(p)["0003"], /overlaps 0001 \(in flight\) on src\/index\.mjs/);
  assert.match(held(propose(b, { config: conflicts() }))["0004"], /parallel limit is 2, with 2 in flight/);
});

test("a regenerated file is ignored and a merge file only warns", () => {
  const b = board([
    card("0001", { files: ["plugins/agentic-teamwork/skills/marketplace-guide/SKILL.md", "README.md", "plugins/a/lib/x.mjs"] }),
    card("0002", { files: ["plugins/agentic-teamwork/skills/marketplace-guide/SKILL.md", "README.md", "plugins/b/lib/y.mjs"] }),
  ]);
  const p = propose(b, { config: REPO_CONFIG });
  assert.deepEqual(ran(p), ["0001", "0002"]);
  assert.deepEqual(p.warnings, ["0002 and 0001 both touch README.md, a merge file: whichever lands second syncs and keeps both sides' entries."]);
  assert.deepEqual(p.run[1].warnings, p.warnings);
});

test("a broad path that only meets another card on a merge file warns rather than holds", () => {
  const b = board([card("0001", { files: ["plugins/"] }), card("0002", { files: ["plugins/AGENTS.md"] })]);
  const p = propose(b, { config: REPO_CONFIG });
  assert.deepEqual(ran(p), ["0001", "0002"]);
  assert.match(p.warnings[0], /plugins\/AGENTS\.md, a merge file/);
});

test("a shared path always holds: two cards in one plugin both bump its version line", () => {
  const b = board([
    card("0001", { files: ["plugins/agent-works/hooks/kanban/"] }),
    card("0002", { files: ["plugins/agent-works/lib/conflicts.mjs"] }),
    card("0003", { files: ["plugins/perceptual-loop/lib/motion.mjs"] }),
  ]);
  const p = propose(b, { config: REPO_CONFIG, max: 3 });
  assert.deepEqual(ran(p), ["0001", "0003"]);
  assert.match(held(p)["0002"], /meets 0001 \(proposed\) on plugins\/agent-works\/\.claude-plugin\/plugin\.json, plugins\/agent-works\/README\.md/);
});

test("a shared path holds even where a merge entry would only warn", () => {
  const config = conflicts({ merge: ["README.md"], shared: ["README.md"] });
  const p = propose(board([card("0001", { files: ["README.md"] }), card("0002", { files: ["README.md"] })]), { config });
  assert.deepEqual(ran(p), ["0001"]);
  assert.deepEqual(p.warnings, []);
});

test("dependencies, the person, and the plan hold a card, with the reason", () => {
  const b = board([
    card("0001", { files: ["a/"] }),
    card("0002", { files: ["b/"], after: ["0001"] }),
    card("0003", { files: ["c/"], needs: "the person" }),
    card("0004", { files: ["d/"], after: ["0404"] }),
    card("0005", { kind: "epic" }),
  ]);
  const p = propose(b, { config: conflicts(), max: 4 });
  assert.deepEqual(ran(p), ["0001"]);
  assert.deepEqual(held(p), {
    "0002": "waits on 0001 (backlog)",
    "0003": "needs the person",
    "0004": "waits on 0404, which is not on the board",
  });
});

test("a card that names no files runs alone", () => {
  const first = board([card("0001"), card("0002", { files: ["b/"] })]);
  const p = propose(first, { config: conflicts() });
  assert.deepEqual(ran(p), ["0001"]);
  assert.match(held(p)["0002"], /0001 \(proposed\) names no files, so nothing runs beside it/);

  const second = board([card("0001", { files: ["a/"] }), card("0002")]);
  assert.match(held(propose(second, { config: conflicts() }))["0002"], /names no files, so it cannot run beside 0001 \(proposed\)/);
});

test("--ids limits the candidates, and a card not in the backlog is held with its status", () => {
  const b = board([card("0001", { files: ["a/"] }), card("0002", { files: ["b/"] }), card("0003", { status: "review", mr: 2, files: ["c/"] })]);
  const p = propose(b, { config: conflicts(), ids: ["0002", "0003"] });
  assert.deepEqual(ran(p), ["0002"]);
  assert.match(held(p)["0003"], /is review, not in the backlog/);
  assert.throws(() => propose(b, { config: conflicts(), ids: ["0404"] }), /no card with id "0404"/);
});

test("the locks a card needs come from the resources its files touch, in the declared order", () => {
  const c = card("0001", { files: ["ios/App/", "db/migrations/0001.sql"] });
  assert.deepEqual(locksFor(c, REPO_CONFIG), [
    { resource: "test-db", scope: "project", long: true },
    { resource: "simulator", scope: "machine", long: false },
  ]);
  const p = propose(board([c]), { config: REPO_CONFIG });
  assert.deepEqual(p.run[0].locks.map((l) => l.resource), ["test-db", "simulator"]);
});

test("two cards that both need a long-held lock do not run together; a short one only serializes", () => {
  const b = board([
    card("0001", { files: ["db/a.sql"] }), card("0002", { files: ["db/b.sql"] }),
    card("0003", { files: ["ios/A/"] }), card("0004", { files: ["ios/B/"] }),
  ]);
  const p = propose(b, { config: REPO_CONFIG, max: 4 });
  assert.deepEqual(ran(p), ["0001", "0003", "0004"]);
  assert.match(held(p)["0002"], /shares the long-held lock test-db with 0001 \(proposed\)/);
});

test("conflictConfig fills the defaults and takes a bare path as a regenerated file", () => {
  assert.deepEqual(conflicts(), { shared: [], merge: [], rederived: [], resources: {}, lockOrder: [] });
  assert.deepEqual(conflicts({ rederived: ["./gen/out.json/"] }).rederived, [{ path: "gen/out.json", command: null }]);
});
