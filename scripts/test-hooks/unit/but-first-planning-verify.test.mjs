// but-first-planning's read-only checkers, each run from a workspace the way a
// project runs it: verify-plan-tree.mjs (the epic, sprint, issue tree),
// verify-spec-tree.mjs (the spec site's pages), and drift-status.mjs (the
// index of recorded drift). Exit 0 is clean, 1 is warnings only, 2 is critical.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const { scaffold } = await import(pathToFileURL(path.join(REPO, "plugins", "but-first-planning", "skills", "spec-init", "scaffold.mjs")).href);

const P = ".agents/plan";
const SPRINT = "plan/01-core/01-store";

const issue = ({ type = "AFK", tracker = "**Tracker**: <unassigned>", facing = "**User-facing**: no - internal", blocked = "- None", anchor = "../../../../spec/02-runtime/events.md" } = {}) => `# Event type

**Sprint**: [01-store](../sprint.md)
**Type**: ${type}
${tracker}
**Status**: not-started

## Parent

[Sprint 01-01](../sprint.md)

## What to build

The slice. Anchor: [events](${anchor})

${facing}

## Acceptance criteria

- [ ] it works

## Testing checkpoint

\`echo ok\`

## Blocked by

${blocked}
`;

/** A workspace with one epic, one sprint, one issue and one spec page. `marker` is the plan-format line of plan/index.md. */
function workspace(t, { marker = "<!-- plan-format: 5.0 -->", issueText = issue() } = {}) {
  const root = tempDir(t, "bfp-verify-");
  write(root, `${P}/plan/index.md`, `# Plan\n\n${marker}\n\n## Epics\n\n| # | Epic | Sprints | Issues | Status |\n|---|---|---|---|---|\n| 01 | [Core](01-core/epic.md) | 1 | 1 | not-started |\n`);
  write(root, `${P}/plan/01-core/epic.md`, "# Epic 01: Core\n\n**Status**: not-started\n\n## Sprints\n\n| # | Sprint | Issues | Status |\n|---|---|---|---|\n| 01 | [Store](01-store/sprint.md) | 1 | not-started |\n");
  write(root, `${P}/${SPRINT}/sprint.md`, "# Sprint 01-01: Store\n\n**Status**: not-started\n\n## Issues\n\n| # | Type | Title | Tracker | Status |\n|---|---|---|---|---|\n| 01 | AFK | [Event type](issues/01_issue_EVENT-TYPE.md) | <unassigned> | not-started |\n");
  write(root, `${P}/${SPRINT}/issues/01_issue_EVENT-TYPE.md`, issueText);
  write(root, `${P}/spec/index.md`, "# Spec\n\n- [runtime](02-runtime/index.md)\n");
  write(root, `${P}/spec/02-runtime/index.md`, "# Runtime\n\n- [events](events.md)\n");
  write(root, `${P}/spec/02-runtime/events.md`, "---\ntags: [runtime]\nsummary: How events move.\ncreated: 2026-01\nupdated: 2026-01-15\nrelates-to:\n  - repository-layout.md\n---\n# Events\n");
  write(root, `${P}/spec/02-runtime/repository-layout.md`, "---\ntags: [layout]\nsummary: Where code lives.\ncreated: 2026-01\nupdated: 2026-01\n---\n# Layout\n");
  write(root, `${P}/spec/02-runtime/user-docs-plan.md`, "---\ntags: [docs]\nsummary: The page map.\ncreated: 2026-01\nupdated: 2026-01\n---\n# Docs\n");
  scaffold(root);
  return root;
}

const plan = (root) => runNode(path.join(root, P, "plan", "verify-plan-tree.mjs"), [], { cwd: root });
const spec = (root) => runNode(path.join(root, P, "spec", "scripts", "verify-spec-tree.mjs"), [], { cwd: root });
const drift = (root, args = []) => runNode(path.join(root, P, "progress", "drift-status.mjs"), args, { cwd: root });

// ---- verify-plan-tree -------------------------------------------------------

test("a well-formed plan tree passes and reports what it counted", (t) => {
  const r = plan(workspace(t));
  assert.equal(r.stdout, "OK: 1 epics, 1 sprints, 1 issues, 0 broken links, 0 missing fields\n");
  assert.equal(r.status, 0);
});

test("an empty plan tree is a valid fresh workspace", (t) => {
  const root = tempDir(t, "bfp-empty-");
  write(root, `${P}/plan/index.md`, "# Plan\n");
  scaffold(root);
  const r = plan(root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK: 0 epics, 0 sprints, 0 issues/);
});

test("the tracker field is `<unassigned>`, `#NNN` or a local handle, under either of its two names", (t) => {
  for (const ok of ["**Tracker**: #42", "**Tracker**: local:01-01/01", "**GitHub**: <unassigned>", "**GitHub**: #7"]) {
    assert.equal(plan(workspace(t, { issueText: issue({ tracker: ok }) })).status, 0, ok);
  }
  const bad = plan(workspace(t, { issueText: issue({ tracker: "**Tracker**: soon" }) }));
  assert.equal(bad.status, 2);
  assert.match(bad.stdout, /FAIL: .*01_issue_EVENT-TYPE\.md: Tracker field is neither '<unassigned>' nor a '#NNN' reference/);
  const none = plan(workspace(t, { issueText: issue({ tracker: "" }) }));
  assert.equal(none.status, 2);
  assert.match(none.stdout, /missing required field\/section: \*\*Tracker\*\*/);
});

test("a missing section, an unknown type, a dead blocker link and a dead spec anchor are each critical", (t) => {
  const cases = [
    [issue().replace("## Testing checkpoint", "## Checks"), /missing required field\/section: ## Testing checkpoint/],
    [issue({ type: "LATER" }), /Type must be AFK, HITL, or REVIEW \(got 'LATER'\)/],
    [issue({ blocked: "- [gone](./09_issue_GONE.md)" }), /Blocked-by link does not resolve: \.\/09_issue_GONE\.md/],
    [issue({ anchor: "../../../../spec/02-runtime/missing.md" }), /spec anchor does not resolve/],
  ];
  for (const [issueText, message] of cases) {
    const r = plan(workspace(t, { issueText }));
    assert.equal(r.status, 2, String(message));
    assert.match(r.stdout, message);
    assert.match(r.stdout, /\n1 failure\(s\), 0 warning\(s\)\n$/);
  }
});

test("the User-facing line is critical on a marked tree and a warning on an unmarked one; a REVIEW issue needs none", (t) => {
  const missing = issue({ facing: "" });
  for (const marker of ["<!-- plan-format: 5.0 -->", "<!-- plan-format: 3.7 -->"]) {
    const strict = plan(workspace(t, { marker, issueText: missing }));
    assert.equal(strict.status, 2, marker);
    assert.match(strict.stdout, /FAIL: .*missing or malformed \*\*User-facing\*\* line/);
  }
  for (const marker of ["", "<!-- plan-format: 3.6 -->"]) {
    const loose = plan(workspace(t, { marker, issueText: missing }));
    assert.equal(loose.status, 1, marker || "no marker");
    assert.match(loose.stdout, /^WARN: .*\*\*User-facing\*\* line/);
    assert.match(loose.stdout, /OK: 1 epics, 1 sprints, 1 issues, 0 broken links, 0 missing fields, 1 warning\(s\)\n$/);
  }
  assert.equal(plan(workspace(t, { issueText: issue({ type: "REVIEW", facing: "" }) })).status, 0);
  for (const line of ["**User-facing**: yes - the `export` command", "**User-facing**: yes — the export command", "**User-facing**: no, internal"]) {
    assert.equal(plan(workspace(t, { issueText: issue({ facing: line }) })).status, 0, line);
  }
});

test("a sprint table and its issue files, and an epic table and its sprint folders, must list the same things", (t) => {
  const root = workspace(t);
  write(root, `${P}/${SPRINT}/issues/02_issue_STRAY.md`, issue());
  const stray = plan(root);
  assert.equal(stray.status, 2);
  assert.match(stray.stdout, /issues on disk not listed in sprint\.md: \["02_issue_STRAY\.md"\]/);

  const other = workspace(t);
  fs.mkdirSync(path.join(other, P, "plan/01-core/02-extra/issues"), { recursive: true });
  write(other, `${P}/plan/01-core/02-extra/sprint.md`, "# Sprint\n\n**Status**: not-started\n");
  assert.match(plan(other).stdout, /sprint dirs on disk not listed in epic\.md: \["02-extra"\]/);

  const named = workspace(t);
  fs.renameSync(path.join(named, P, SPRINT, "issues/01_issue_EVENT-TYPE.md"), path.join(named, P, SPRINT, "issues/01-event-type.md"));
  assert.match(plan(named).stdout, /filename does not match pattern NN_issue_SLUG\.md/);
});

// ---- verify-spec-tree -------------------------------------------------------

test("a well-formed spec passes and reports what it counted", (t) => {
  const r = spec(workspace(t));
  assert.equal(r.stdout, "OK: 1 categories, 3 content files, 2 index hubs, 0 broken links\n");
  assert.equal(r.status, 0);
});

test("a fresh spec warns about the two mandatory pages and nothing else", (t) => {
  const root = workspace(t);
  fs.rmSync(path.join(root, P, "spec/02-runtime/repository-layout.md"));
  fs.rmSync(path.join(root, P, "spec/02-runtime/user-docs-plan.md"));
  write(root, `${P}/spec/02-runtime/events.md`, "---\ntags: [runtime]\nsummary: s\ncreated: 2026-01\nupdated: 2026-01\n---\n# Events\n");
  const r = spec(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /WARN: spec\/: no content file named repository-layout\.md/);
  assert.match(r.stdout, /WARN: spec\/: no content file named user-docs-plan\.md/);
});

test("a content page without frontmatter, with a bad date, or with a dead relates-to link is critical", (t) => {
  const page = (rel, text) => { const root = workspace(t); write(root, `${P}/spec/02-runtime/${rel}`, text); return spec(root); };
  const bare = page("bare.md", "# No frontmatter\n");
  assert.equal(bare.status, 2);
  assert.match(bare.stdout, /FAIL: spec\/02-runtime[\\/]bare\.md: MISSING_FRONTMATTER/);
  assert.match(page("dated.md", "---\ntags: [x]\nsummary: s\ncreated: January\nupdated: 2026-01\n---\n# x\n").stdout, /'created' must be YYYY-MM or YYYY-MM-DD, got 'January'/);
  assert.match(page("partial.md", "---\ntags: [x]\ncreated: 2026-01\nupdated: 2026-01\n---\n# x\n").stdout, /INVALID_FRONTMATTER \(missing 'summary'\)/);
  assert.match(page("linked.md", "---\ntags: [x]\nsummary: s\ncreated: 2026-01\nupdated: 2026-01\nrelates-to: [gone.md]\n---\n# x\n").stdout, /relates-to link does not resolve: gone\.md/);
});

test("an index page with frontmatter and an oversized page are warnings; assets, scripts and prototypes are not read", (t) => {
  const root = workspace(t);
  write(root, `${P}/spec/02-runtime/index.md`, "---\ntags: [x]\n---\n# Runtime\n");
  write(root, `${P}/spec/02-runtime/long.md`, `---\ntags: []\nsummary: s\ncreated: 2026-01\nupdated: 2026-01\n---\n${"line\n".repeat(220)}`);
  write(root, `${P}/spec/prototypes/notes.md`, "# no frontmatter, and not a spec page\n");
  write(root, `${P}/spec/assets/readme.md`, "# not a spec page either\n");
  const r = spec(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /index\.md should be a navigation hub with no frontmatter/);
  assert.match(r.stdout, /long\.md: oversized \(> 200 lines\)/);
  assert.match(r.stdout, /long\.md: EMPTY_TAGS/);
  assert.doesNotMatch(r.stdout, /prototypes|assets/);
});

test("a workspace with no spec index is critical", (t) => {
  const root = tempDir(t, "bfp-nospec-");
  scaffold(root);
  const r = spec(root);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /FAIL: spec\/: missing root index\.md/);
});

// ---- drift-status -----------------------------------------------------------

const driftFile = (id, status, title, extra = "") => `---\nid: ${id}\nkind: defect\nsurfaced: 2026-05-31 (01-03)\nwhere: spec/02-runtime/events.md\nroute: spec-edit\nstatus: ${status}\n${extra}---\n# ${title}\n\nWhat was seen.\n`;

test("drift-status lists every item, actionable first, with a counts line", (t) => {
  const root = workspace(t);
  write(root, `${P}/progress/drift/drift-b-settled.md`, driftFile("D2", "resolved (triage 2026-06-06, #376)", "Settled"));
  write(root, `${P}/progress/drift/drift-a-open.md`, driftFile("D1", "\"open\"", "Still open"));
  write(root, `${P}/progress/drift/drift-c-routed.md`, driftFile("D3", "routed", "Handed off"));
  write(root, `${P}/progress/drift/drift-d-parked.md`, driftFile("D4", "by-design", "Intended"));
  write(root, `${P}/progress/drift/drift-e-broken.md`, "# no frontmatter\n");
  write(root, `${P}/progress/drift/notes.md`, "# not a drift file\n");
  const r = drift(root);
  assert.equal(r.status, 0);
  const rows = r.stdout.split("\n").filter((l) => /^(D\d|\s)/.test(l) && l.includes("drift-")).map((l) => l.trim().split(/\s+/)[0]);
  assert.deepEqual(rows.slice(0, 4), ["D1", "D3", "D2", "D4"]);
  assert.match(r.stdout, /\n5 items: 1 open, 1 routed, 1 resolved, 1 by-design, 1 malformed\n$/);
});

test("--open and --status filter, --json answers the items, and a bad flag is exit 2", (t) => {
  const root = workspace(t);
  write(root, `${P}/progress/drift/drift-a.md`, driftFile("D1", "open", "Still open"));
  write(root, `${P}/progress/drift/drift-b.md`, driftFile("D2", "resolved", "Settled"));
  const open = JSON.parse(drift(root, ["--open", "--json"]).stdout);
  assert.deepEqual(open.map((i) => [i.id, i.status, i.title, i.file]), [["D1", "open", "Still open", "drift-a.md"]]);
  assert.match(drift(root, ["--status", "resolved"]).stdout, /\n1 item: 0 open, 0 routed, 1 resolved\n$/);
  assert.equal(drift(root, ["--frobnicate"]).status, 2);
});

test("a workspace with no drift recorded lists nothing and exits 0", (t) => {
  const r = drift(workspace(t));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "No drift items.\n");
  assert.equal(drift(workspace(t), ["--json"]).stdout, "[]\n");
});
