// The workflow-studio area, read as an agent reads it: its one route, with a
// name that matches its folder, a description that says when to take it and a
// route's frontmatter keys only; and the area's own page, which opens the
// studio. The launch command is checked word by word, since the agent runs it
// exactly as written.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pluginRootPaths } from "../../lib.mjs";
import { AGENTCRAFT, area, routeBasics } from "./area-routes.mjs";

const AREA = area("workflow-studio");
const launch = AREA.skill;

test("workflow-studio routes: the area ships exactly its one route, and no hooks", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name), ["author-workflow"]);
  assert.equal(AREA.door.default, "author-workflow");
  assert.equal(fs.existsSync(path.join(AREA.dir, "hooks")), false);
});

routeBasics(test, AREA, { when: /\bUse\s+when\b/, cap: 700 });

test("workflow-studio routes: every plugin-root path the area's page names exists", () => {
  const paths = launch.text.split("\n").flatMap((line) => pluginRootPaths(line)).filter((p) => !p.placeholder).map((p) => p.path.replace(/\.$/, ""));
  assert.ok(paths.length >= 1, "the page that opens the studio points into the plugin");
  for (const rel of paths) assert.ok(fs.existsSync(path.join(AGENTCRAFT, rel)), `\${CLAUDE_PLUGIN_ROOT}/${rel}`);
});

test("workflow-studio routes: opening the studio is the area's own job, and its page says the route is the other one", () => {
  assert.match(launch.body, /^## Launch$/m);
  assert.match(launch.body, /`author-workflow` route/);
});

test("workflow-studio routes: the launch command runs the launcher with node and hands it the three folders, in order", () => {
  const command = launch.text.split("\n").find((l) => l.includes("launch-studio"));
  assert.equal(command.trim(), 'node "${CLAUDE_PLUGIN_ROOT}/skills/workflow-studio/scripts/launch-studio.mjs" "${CLAUDE_PLUGIN_ROOT}/skills/workflow-studio" "$STUDIO_ROOT" "${CLAUDE_PLUGIN_DATA}/workflow-studio"');
  const block = launch.text.slice(launch.text.indexOf("```bash"), launch.text.indexOf("```", launch.text.indexOf("```bash") + 7));
  assert.match(block, /STUDIO_ROOT="\$\{CLAUDE_PROJECT_DIR:-\$HOME\}\/\.claude\/workflow-studio"/, "the studio root is the project's, or the home's outside a project");
  assert.match(block, /WORKFLOW_EXPORT_ROOT="\$\{CLAUDE_PROJECT_DIR:-\$HOME\}" \\\n/, "Publish is confined to the same folder");
});

test("workflow-studio routes: what the page promises about a missing prerequisite is what the launcher prints", () => {
  const source = fs.readFileSync(path.join(AREA.dir, "scripts", "launch-studio.mjs"), "utf8");
  assert.match(launch.text, /`npm` is missing or Node is older\s+than 20/);
  assert.match(source, /'npm' was not found on PATH/);
  assert.match(source, /needs Node 20\+/);
  assert.match(launch.text, /Node\.js 20 or newer/);
});

test("workflow-studio routes: the area ships no shell script outside the bundled app, and no document names one", () => {
  const files = fs.readdirSync(AREA.dir, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/")).filter((f) => !f.startsWith("app/"));
  assert.deepEqual(files.filter((f) => /\.(py|pyc|sh|bash)$/.test(f)), []);
  for (const file of files.filter((f) => f.endsWith(".md") && f !== "CHANGELOG.md")) {
    assert.doesNotMatch(fs.readFileSync(path.join(AREA.dir, file), "utf8"), /launch-studio\.sh|\bbash "|\bpython3?\b/, file);
  }
});
