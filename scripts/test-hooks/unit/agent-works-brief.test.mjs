// The brief is the whole prompt a child session starts from, so it has to
// stand alone: the task and its done criteria, the files it owns and the
// files other children own right now, the cadence down to the one push a
// grant covers, and the CARD line it ends with. It is pasted into a session
// where no plugin root is set, so every path in it is absolute.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardError, boardConfig } from "../../../plugins/agent-works/lib/board.mjs";
import { BRANCH, BRIEF_TEMPLATE as TEMPLATE, defaultBranch, grantText, renderBrief } from "../../../plugins/agent-works/lib/brief.mjs";
import { conflictConfig } from "../../../plugins/agent-works/lib/conflicts.mjs";

const CLI = { board: 'node "/opt/plugin/scripts/aw.mjs" board', lock: 'node "/opt/plugin/scripts/aw.mjs" lock' };
const T0 = "2026-10-01T09:00:00.000Z";
const card = (id, over = {}) => ({
  id, title: `Card ${id}`, status: "backlog", order: Number(id), priority: "normal", kind: "task",
  labels: [], skills: [], after: [], files: [], unknown: [], file: `${id}-card-${id}.md`, created: T0, updated: T0,
  body: "Add the kebab helper beside truncate.\n\n## Done when\n- `kebab(\"A B\")` is `a-b`, by its unit test\n\n## Notes\nSee the truncate tests.\n\n## Review\nold findings",
  ...over,
});
const board = (cards) => ({ ...boardConfig(), cards });
const brief = (c, cards, extra = {}) => renderBrief(TEMPLATE, {
  card: c, board: board(cards), config: conflictConfig(), cli: CLI, cardPath: `/repo/.agents/kanban/${c.file}`, base: "main", ...extra,
});

test("a loose card's brief carries the task, its criteria, its files, and the cadence with absolute paths", () => {
  const c = card("0007", { files: ["src/kebab.mjs"], branch: "feat/kebab", grant: "Pat 2026-10-28: push feat/kebab and open the pull or merge request (card 0007)" });
  const text = brief(c, [c]);
  assert.match(text, /^# Card 0007: Card 0007$/m);
  assert.match(text, /Add the kebab helper beside truncate\./);
  assert.match(text, /See the truncate tests\./);
  assert.doesNotMatch(text, /old findings/, "the review section is not part of the task");
  assert.match(text, /## Done when\n\n- `kebab\("A B"\)` is `a-b`, by its unit test\n/);
  assert.match(text, /- `src\/kebab\.mjs`/);
  assert.match(text, /`git switch -c feat\/kebab`, then `node "\/opt\/plugin\/scripts\/aw\.mjs" board claim 0007`/);
  assert.match(text, /Open the pull or merge request\*\*, then `node "\/opt\/plugin\/scripts\/aw\.mjs" board move 0007 review --mr <number>`/);
  assert.match(text, /exactly `git push -u origin feat\/kebab`, as a command of its own/);
  assert.match(text, /^ {4}CARD 0007 <review\|blocked\|failed> !<number> lanes=<lane>:<pass\|fail>,\.\.\. owed=<items\|->$/m);
  assert.match(text, /\/repo\/\.agents\/kanban\/0007-card-0007\.md/);
  assert.doesNotMatch(text, /\{\{|\}\}/, "every placeholder is filled");
  assert.doesNotMatch(text, /\n{3,}/, "no run of blank lines where a block was empty");
});

test("no plugin-root variable appears in the brief or in its template", () => {
  const c = card("0007", { files: ["src/"] });
  for (const text of [TEMPLATE, brief(c, [c])]) assert.doesNotMatch(text, /PLUGIN_ROOT/);
});

test("the not-yours list is every other in-flight card's files, and only theirs", () => {
  const c = card("0007", { files: ["src/kebab.mjs"] });
  const others = [
    card("0008", { status: "in-progress", session: "card-0008", files: ["src/truncate.mjs", "test/truncate.test.mjs"] }),
    card("0009", { status: "review", mr: 4, files: ["docs/"] }),
    card("0010", { status: "in-progress" }),
    card("0011", { files: ["lib/"] }),
    card("0012", { status: "done", files: ["old/"] }),
  ];
  const text = brief(c, [c, ...others]);
  const section = /## Not yours\n\n([\s\S]*?)\n## /.exec(text)[1];
  assert.match(section, /- 0008 \(card-0008\): `src\/truncate\.mjs`, `test\/truncate\.test\.mjs`/);
  assert.match(section, /- 0009: `docs\/`/);
  assert.match(section, /- 0010: names no files/);
  assert.doesNotMatch(section, /lib\/|old\/|0007/);
  assert.match(brief(c, [c]), /## Not yours\n\nNothing else is in flight\./);
});

test("without a grant the brief says the push asks the person", () => {
  const c = card("0007", { files: ["src/"] });
  const text = brief(c, [c]);
  assert.match(text, /No push grant was given for this card/);
  assert.match(text, /`git switch -c <type>\/<topic>`/);
});

test("a plan card builds with build-tdd from its acceptance criteria, and the issue is quoted", () => {
  const issue = "# Parse the flags\n\n**Type**: AFK\n\n## Acceptance criteria\n- [ ] `--max` takes a number\n- [x] `--ids` takes a list\n";
  const c = card("01-02-03", {
    source: "plan", plan: "01-02-03", type: "AFK", planStatus: "not-started", title: "Parse the flags", body: issue,
    file: ".agents/plan/plan/01-cli/02-flags/issues/03_issue_PARSE-FLAGS.md", files: ["src/flags.mjs"],
    acceptance: [{ done: false, text: "`--max` takes a number" }, { done: true, text: "`--ids` takes a list" }],
  });
  const text = brief(c, [c], { cardPath: "/repo/.agents/kanban/plan-01-02-03.md", planRef: "origin/main" });
  assert.match(text, /`\/but-first-planning:build-tdd`/);
  assert.match(text, /- \[ \] `--max` takes a number\n- \[ \] `--ids` takes a list\n- \[ \] the issue's testing checkpoint exits 0/);
  assert.match(text, /\.agents\/plan\/plan\/01-cli\/02-flags\/issues\/03_issue_PARSE-FLAGS\.md/);
  assert.match(text, /~~~~markdown\n# Parse the flags\n/);
  assert.match(text, /origin\/main/);
});

test("a task judged by eye or ear loads perceptual-loop first, and a card's own skills are named", () => {
  const c = card("0007", { files: ["src/"], labels: ["look"], skills: ["docs-parity:docs-shots"] });
  const text = brief(c, [c]);
  assert.match(text, /judged by eye or ear: if the perceptual-loop plugin is installed, load `\/perceptual-loop:iterate-shots` before the first test/);
  assert.match(text, /Load first: `\/docs-parity:docs-shots`\./);
  assert.doesNotMatch(brief(card("0008", { files: ["src/"] }), []), /perceptual-loop/);
});

test("the repo's config says how to sync: regenerate, keep both sides, re-bump", () => {
  const config = conflictConfig({
    kanban: { conflicts: {
      rederived: [{ path: "diagrams/system-map.json", command: "node .agents/scripts/system-map.mjs --write" }],
      merge: ["README.md"],
      shared: ["plugins/*/README.md"],
    } },
    resources: { "test-db": { paths: ["db/"] } },
  });
  const c = card("0007", { files: ["db/schema.sql"] });
  const text = brief(c, [c], { config });
  assert.match(text, /`diagrams\/system-map\.json` is generated: never merge it by hand; after the sync run `node \.agents\/scripts\/system-map\.mjs --write`/);
  assert.match(text, /`README\.md`: keep both sides' entries/);
  assert.match(text, /`plugins\/\*\/README\.md`: .*bump once above the base/);
  assert.match(text, /`test-db` \(project\): `node "\/opt\/plugin\/scripts\/aw\.mjs" lock run test-db --as card-0007 /);
});

test("a card from the first template is briefed from its own heading", () => {
  const c = card("0007", { files: ["src/"], body: "## What was seen\n\nThe export drops the last row.\n\n## Done looks like\n\n- The export test passes with an odd row count." });
  const text = brief(c, [c]);
  assert.match(text, /## Done when\n\n- The export test passes with an odd row count\.\n/);
  assert.match(text, /### What was seen\n\nThe export drops the last row\./);
  assert.equal(text.match(/odd row count/g).length, 1, "the criteria are not repeated in the task");
});

test("a card with no done criteria is refused: write them first", () => {
  const c = card("0007", { body: "## Done when\n\n## Notes" });
  assert.throws(() => brief(c, [c]), (e) => e instanceof BoardError && e.kind === "refused" && /no done criteria/.test(e.message));
});

test("a granted branch is conventional, defaults from the title, and the grant names it", () => {
  assert.equal(defaultBranch({ title: "R5: the review loop (with card 0006)" }), "feat/r5-the-review-loop-with-card-0006");
  assert.equal(defaultBranch({ title: "A really quite long title that goes on and on past the cut" }), "feat/a-really-quite-long-title-that-goes-on");
  assert.ok(BRANCH.test("fix/hook-stdin"));
  assert.ok(!BRANCH.test("main") && !BRANCH.test("feature/x") && !BRANCH.test("feat/"));
  assert.equal(grantText("Pat, 2026-10-28T09:00Z", "feat/kebab", "0007"), "Pat, 2026-10-28T09:00Z: push feat/kebab and open the pull or merge request (card 0007)");
});
