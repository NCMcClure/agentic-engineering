// agent-works guard staging rules: the owner's files are never staged, by any
// spelling. A blanket add, the file itself, a folder above it, a glob that
// reaches it, from another folder, behind an exclusion, in another shell's
// line. Made-up paths throughout; nothing here touches a file or git.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO } from "./helpers.mjs";

const load = (rel) => import(pathToFileURL(path.join(REPO, "plugins", "agent-works", rel)).href);
const rules = await load("lib/guard-rules.mjs");
const { defaults } = await load("lib/config.mjs");

const HOST = "apps/desktop/Host";
const OWNER_FILES = [
  ".editor/settings.json",
  `${HOST}/Config/LocalEditor.ini`,
  `${HOST}/Host.project`,
  `${HOST}/Config/LocalEngine.ini`,
  `${HOST}/Config/LocalGame.ini`,
  `${HOST}/.toolconfig`,
  `${HOST}/Content/Maps/`,
];
const ROOT = "/srv/work/acme";

function config(guard = {}) {
  const cfg = defaults();
  Object.assign(cfg.guard, { ownerFiles: [...OWNER_FILES] }, guard);
  return cfg;
}

const FACTS = { branch: "feat/x", agent: null };
const run = (command, tool = "Bash", facts = {}, cfg = config()) => rules.decide(tool, { command }, cfg, { ...FACTS, ...facts });
const rule = (command, facts, tool) => run(command, tool, facts)?.rule ?? null;
const edit = (file, cfg = config(), facts = { root: ROOT }, tool = "Edit") => rules.decide(tool, { file_path: file }, cfg, { ...FACTS, ...facts });

test("agent-works guard staging: the owner's files are the ones the edit rule reads", () => {
  for (const f of OWNER_FILES) {
    for (const [root, sep] of [[ROOT, "/"], ["Q:\\work\\acme", "\\"]]) {
      const file = root + sep + f.replaceAll("/", sep) + (f.endsWith("/") ? "Main.map" : "");
      const d = edit(file, config(), { root });
      assert.deepEqual([f, d?.rule, d?.kind], [f, "owner-file-edit", "ask"]);
      assert.equal(d.message, `${file} is the owner's own file: agents leave it as it is and never commit it.`);
    }
  }
  assert.equal(edit(`${HOST}/Config/LocalInput.ini`), null);
  // the same name somewhere else in the checkout is not the owner's file
  assert.equal(edit(`${ROOT}/pkg/.editor/settings.json`), null);
  // ... but in another checkout the path is read by its tail
  assert.equal(edit("/srv/other/tree/.editor/settings.json", config(), { root: ROOT }, "Write").rule, "owner-file-edit");
  assert.equal(edit(`${ROOT}/${HOST}/Host.project`, config({ ownerFilesEdit: "deny" })).kind, "deny");
  assert.equal(edit(`${ROOT}/${HOST}/Host.project`, config({ ownerFilesEdit: "warn" })).kind, "warn");
  assert.equal(edit(`${ROOT}/${HOST}/Host.project`, config({ ownerFilesEdit: "off" })), null);
});

test("agent-works guard staging: the files themselves are refused", () => {
  const files = [`${HOST}/Host.project`, `${HOST}/Config/LocalEngine.ini`, `${HOST}/Config/LocalGame.ini`,
    `${HOST}/.toolconfig`, `${HOST}/Content/Maps`, `${HOST}/Content/Maps/`, `${HOST}/Content/Maps/Main.map`,
    `${HOST.replaceAll("/", "\\")}\\Config\\LocalEngine.ini`, `./${HOST}/../Host/.toolconfig`, "-f .editor/settings.json"];
  for (const f of files) {
    for (const verb of ["git add", "git stage", "git commit -m x", "git commit -m x --", "git add tools/dev/guard.ts"]) {
      const d = run(`${verb} ${f}`, "PowerShell");
      assert.deepEqual([verb, f, d?.rule, d?.kind], [verb, f, "staging-owner-files", "deny"]);
    }
  }
});

test("agent-works guard staging: the refusal names the files and says to stage by exact path", () => {
  const d = run("git add apps");
  assert.equal(d.kind, "deny");
  for (const f of [`${HOST}/Host.project`, `${HOST}/Config/LocalEngine.ini`, `${HOST}/Config/LocalGame.ini`, `${HOST}/.toolconfig`, `${HOST}/Content/Maps/`]) {
    assert.ok(d.message.includes(f), f);
  }
  assert.ok(d.message.startsWith("`git add apps` would take the owner's own files with it:\n"));
  assert.ok(!d.message.includes(".editor/settings.json"));
  assert.match(d.message, /exact paths/);
  assert.match(d.message, /Leave the owner's files as they are: do not revert, stash, move or delete them\.$/);
  assert.ok(!run(`git add ${HOST}/Config`).message.includes(".project"));
});

test("agent-works guard staging: every folder above them, in both shells", () => {
  const dirs = ["apps", "apps/", "apps/desktop", "apps\\desktop\\", HOST, `${HOST}/Config`, `${HOST}/Content`,
    `"${HOST}"`, `'${HOST}/Config/'`, ":/apps", ":(top)apps/desktop", "tools/../apps"];
  for (const d of dirs) {
    for (const tool of ["Bash", "PowerShell"]) {
      for (const c of [`git add ${d}`, `git add docs/README.md ${d}; git commit -m x`, `git commit -m "paint" ${d}`, `git commit --only -m "paint" -- ${d}`]) {
        assert.equal(rule(c, {}, tool), "staging-owner-files", `${tool}: ${c}`);
      }
    }
  }
});

test("agent-works guard staging: the whole tree is a blanket add", () => {
  for (const c of ["git add .", "git add :/", "git add '*'", "git add -A", "git add --all", "git add -u", "git add --update",
    "git add -u tools", "git add -Av", "git stage -A", "git add --no-ignore-removal", "git commit -a -m x", "git commit --all -m x",
    "git commit -qam x", "git -C apps add .", "git -c core.autocrlf=false add -A", "sleep 1 & git add -A"]) {
    const d = run(c);
    assert.deepEqual([c, d?.kind, d?.rule], [c, "deny", "staging-blanket"]);
  }
  assert.ok(run("git add -A").message.includes(`${HOST}/Host.project`));
  assert.equal(run("git add -A", "Bash", {}, defaults()).message,
    "Stage files by path. `git add -A` / `-u` / `git add .` / `git commit -a` take everything in the tree with them: the "
    + "owner's own files and whatever another agent left there. Stage the files you changed by their exact paths "
    + "(`git add <file> <file>`), then `git commit -m …` without -a and without paths above them.");
});

test("agent-works guard staging: blanket staging is a setting", () => {
  assert.equal(run("git add -A", "Bash", {}, config({ staging: { blanket: "ask", unseen: "deny" } })).kind, "ask");
  assert.equal(run("git add -A", "Bash", {}, config({ staging: { blanket: "warn", unseen: "deny" } })).kind, "warn");
  // with the blanket rule off, the whole tree still takes the owner's files
  const off = config({ staging: { blanket: "off", unseen: "deny" } });
  assert.equal(run("git add .", "Bash", {}, off).rule, "staging-owner-files");
  assert.equal(run("git add -A", "Bash", {}, off).rule, "staging-owner-files");
  const none = defaults();
  none.guard.staging.blanket = "off";
  assert.equal(run("git add -A", "Bash", {}, none), null);
  assert.equal(run("git add -A", "Bash", {}, defaults()).rule, "staging-blanket");
});

test("agent-works guard staging: globs that reach the owner's files", () => {
  for (const g of ["apps/*", "'apps/**'", "app*", `${HOST}/*.project`, `'${HOST}/Config/*.ini'`, `${HOST}/Config/Local[EG]*.ini`,
    `${HOST}/Config/LocalGam?.ini`, "'*.ini'", "'*.project'", `${HOST}/.tool*`, `${HOST}/Content/M*`, `'${HOST}/Content/Maps/*.map'`,
    "apps/deskto?", ":/app*"]) {
    assert.equal(rule(`git add ${g}`), "staging-owner-files", g);
    assert.equal(rule(`git commit -m x ${g}`), "staging-owner-files", g);
  }
  for (const g of [`${HOST}/Source/*`, "'*.ts'", `${HOST}/Config/LocalInp*.ini`, "apps/web/*", "docs/*.md"]) {
    assert.equal(rule(`git add ${g}`), null, g);
  }
});

test("agent-works guard staging: a pathspec is read from the folder the command runs in", () => {
  for (const c of ["cd apps && git add desktop", "cd apps/desktop; git add Host", `cd ${HOST} && git add Config/LocalEngine.ini`,
    `cd ${HOST}/Config && git add ../.toolconfig`, "cd tools/dev && git add ../../apps", "pushd apps/desktop && git add Host",
    "git -C apps add desktop", "git -C apps -C desktop add Host", `git -C ${HOST} commit -m x Config`, "(cd apps && git add desktop)",
    `cd "${ROOT}" && git add apps`, "cd /e/elsewhere/acme/apps && git add desktop", "cd $REPO && git add apps",
    "cd ~/acme/apps/desktop && git add Host"]) {
    assert.equal(rule(c, { root: ROOT }), "staging-owner-files", c);
  }
  assert.equal(rule("Set-Location apps\\desktop; git add Host", {}, "PowerShell"), "staging-owner-files");
  for (const [root, sep] of [[ROOT, "/"], ["Q:/work/acme", "\\"]]) {
    const inHost = { root, cwd: root.replaceAll("/", sep) + sep + HOST.replaceAll("/", sep) };
    assert.equal(rule("git add Config", inHost), "staging-owner-files");
    assert.equal(rule("git add Host.project", inHost), "staging-owner-files");
    assert.equal(rule("git add Source/Host/Host.cpp", inHost), null);
    assert.equal(rule("git add ../Plugins/Acme/Acme.plugin", inHost), null);
    assert.equal(rule("git add ../../../docs", inHost), null);
    assert.equal(rule("git add ../..", inHost), "staging-owner-files");
    assert.equal(rule("git add :/tools/dev/guard.ts", inHost), null);
    assert.equal(rule(`git add "${root}/apps/desktop"`, { root, cwd: `${root}/tools` }), "staging-owner-files");
    // Another checkout than the hook's: read by its tail.
    assert.equal(rule("git add desktop", { root: `${root}/.claude/worktrees/w1`, cwd: `${root}/apps` }), "staging-owner-files");
  }
  assert.equal(rule("cd tools && git add apps"), null);
});

test("agent-works guard staging: what the guard cannot read is refused", () => {
  for (const c of ["git add $(git diff --name-only)", 'git add "$f"', "git ls-files -m | xargs git add",
    "git add --pathspec-from-file=list.txt", "git add --pathspec-from-file list.txt",
    "git commit -m x --pathspec-from-file=list.txt", "git add `git ls-files -m`"]) {
    assert.equal(rule(c), "staging-owner-files", c);
  }
  assert.equal(rule("git add $files", {}, "PowerShell"), "staging-owner-files");
  assert.equal(rule("git add @files", {}, "PowerShell"), "staging-owner-files");
  const d = run("git add $(git diff --name-only)");
  assert.match(d.message, /^The guard cannot see which files `git add` takes here \(\$\(git diff --name-only\): a variable/);
  assert.match(d.message, /Write the paths out/);
  // nothing to protect: nothing to refuse
  assert.equal(run("git add $(git diff --name-only)", "Bash", {}, defaults()), null);
  assert.equal(run('git add "$f"', "Bash", {}, config({ staging: { blanket: "deny", unseen: "ask" } })).kind, "ask");
  assert.equal(run('git add "$f"', "Bash", {}, config({ staging: { blanket: "deny", unseen: "off" } })), null);
});

test("agent-works guard staging: an exclusion is honoured when it covers the files", () => {
  assert.equal(rule(`git add apps ':!${HOST}'`), null);
  assert.equal(rule("git add apps ':(exclude)apps/desktop'"), null);
  assert.equal(rule(`git add apps ':^${HOST}/Config' ':!${HOST}/Content' ':!${HOST}/.toolconfig' ':!${HOST}/*.project'`), null);
  const d = run(`git add apps ':!${HOST}/Config'`);
  assert.equal(d.rule, "staging-owner-files");
  assert.ok(d.message.includes(".project"));
  assert.ok(!d.message.includes("LocalEngine.ini"));
  assert.equal(rule("git add ':!docs'"), "staging-owner-files");
  assert.equal(rule(`git add ${HOST}/Content ':!${HOST}/Content/Maps/Main.map'`), "staging-owner-files");
});

test("agent-works guard staging: exact paths, dry runs and everything else go through", () => {
  for (const c of ["git add tools/dev/guard.ts tools/dev/guard.test.ts AGENTS.md .gitignore",
    `git add ${HOST}/Source/Host/Host.cpp ${HOST}/Config/LocalInput.ini ${HOST}/Content/.gitkeep`,
    "git add apps/desktop/Plugins/Acme apps/desktop/scripts apps/web apps/AGENTS.md", "git add -p tools/dev/guard.ts",
    "git add -n apps", "git add --dry-run -A", "git commit --dry-run -a", "git commit -m x", "git commit --amend --no-edit",
    "git commit -F msg.txt", "git commit -m x tools/dev/guard.ts", "git commit -uno -m x", "git commit -S -m x",
    "git commit -m x 2>&1 | tail -3", "git status --short apps", "git diff apps", "git log --oneline -- apps",
    "git restore --staged apps", "git ls-files apps", "echo git add apps", 'gh pr create --title x --body "never git add apps"',
    "git status # then git add apps", "cat <<< 'git add apps'"]) {
    assert.equal(run(c), null, c);
  }
});

test("agent-works guard staging: a commit message is not a pathspec", () => {
  for (const c of ['git commit -m "Guard: refuse git add apps; . and :/ too | see #196"',
    "git commit -m 'apps && git add apps' -m \"apps\"",
    'git commit --message "apps" --author "A <a@b.c>"',
    'git commit -m "He said \\"git add apps\\"; apps"',
    "git commit -m \"$(cat <<'EOF'\nThe guard refuses a folder add.\n\ngit add apps\n\"quoted\" (and a paren) ; apps\n\nCo-Authored-By: x <y@z>\nEOF\n)\"",
    "git commit -F - <<EOF\ngit add apps\nEOF",
    "git add tools/dev/guard.ts && git commit -m \"$(cat <<'EOF'\napps\nEOF\n)\" && git push -u origin fix/x"]) {
    assert.equal(run(c), null, c);
  }
  const ps = "git commit -m @'\nGuard: git add apps\n$literal; apps\n'@";
  assert.equal(run(ps, "PowerShell"), null);
  // ... and what follows the message is still read.
  assert.equal(rule("git commit -m \"$(cat <<'EOF'\nmessage\nEOF\n)\" apps"), "staging-owner-files");
  assert.equal(rule(`${ps} apps`, {}, "PowerShell"), "staging-owner-files");
  assert.equal(rule("git commit -m 'a; b' && git add apps"), "staging-owner-files");
});

test("agent-works guard staging: a line given to another shell, or to the lock wrapper, is read", () => {
  assert.equal(rule('bash -c "git add -A"'), "staging-blanket");
  assert.equal(rule('powershell -NoProfile -Command "git add apps"', {}, "PowerShell"), "staging-owner-files");
  assert.equal(rule('pwsh -c "git add -A"', {}, "PowerShell"), "staging-blanket");
  assert.equal(rule("bash -c 'bash -c \"git add apps\"'"), "staging-owner-files");
  assert.equal(rule('bash -lc "git add tools/dev/guard.ts"'), null);
  assert.equal(rule("aw lock run editor --for x -- git add -A"), "staging-blanket");
  assert.equal(rule("aw lease gpu --for x -- git add apps"), "staging-owner-files");
  assert.equal(rule('aw lock run editor --for x -- bash -c "git commit -am x"'), "staging-blanket");
  assert.equal(rule("aw lock run editor --for x -- git add tools/dev/guard.ts"), null);
});

test("agent-works guard staging: every add and commit of a command is read where it runs", () => {
  const found = rules.stagings("cd apps && git add desktop ':!desktop/web' && X=1 git -C .. commit -m x -- docs", null, ROOT);
  assert.deepEqual(found.map((s) => [s.verb, s.dir, s.specs, s.include, s.exclude, s.lead]), [
    ["add", "apps", ["desktop", ":!desktop/web"], [["apps/desktop"]], [["apps/desktop/web"]], []],
    ["commit", "", ["docs"], [["docs"]], [], ["X=1"]],
  ]);
  assert.deepEqual(rules.stagings("git add -n . ; git commit --dry-run -a").map((s) => [s.all, s.dry]), [[false, true], [true, true]]);
  assert.deepEqual(rules.stagings("git status && echo git add x"), []);
});
