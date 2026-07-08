#!/usr/bin/env python3
"""Publish plan-tree issues to the configured tracker, dependency-ordered.

Lives at `.plan/plan/publish-issues.py` (copied there by spec-0-init; bundled
with plan-1-publish-issues). Deterministic and idempotent: it parses the plan
tree, topologically sorts each sprint's issues by their sibling `Blocked by`
links, creates a ticket per unpublished issue (blockers first, so blocked
bodies cite real `#NNN` refs), and backfills the ref into the issue file and
sprint table immediately — an interrupted run leaves an accurate record.

Tracker backend is read from `.plan/tracker.md`:

- `# Issue tracker: GitHub` -> `gh issue create` with the ready-for-agent /
  ready-for-human triage labels (Project-board field mirroring stays with the
  skill; see TRACKER-GITHUB.md).
- `# Issue tracker: GitLab` -> `glab` against the `**Project**:` /
  `**Project ID**:` recorded there; epic labels and sprint milestones are
  created lazily (see TRACKER-GITLAB.md).
- Local mode has nothing to publish to; the script says so and exits.

Usage:
  publish-issues.py [publish] [--sprint EE-SS] [--all] [--dry-run]
  publish-issues.py sync --iid NNN [--dry-run]

`publish` with no selector publishes the FIRST sprint (in epic/sprint order)
that still has `<unassigned>` issues — the lazy, one-sprint-per-run default.
`sync` rebuilds a published ticket's title/body from its plan file (the
spec-4-edit propagation helper). Stdlib only; failures per issue are collected,
not fatal. Exit 0 = no failures, 1 = at least one failure, 2 = usage/config.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

PLAN = Path(__file__).resolve().parent           # .plan/plan/
DOT_PLAN = PLAN.parent                            # .plan/
ROOT = DOT_PLAN.parent                            # repo root
TRACKER_MD = DOT_PLAN / "tracker.md"

EPIC_COLORS = ["#6699cc", "#b16286", "#689d6a", "#d79921",
               "#d65d0e", "#458588", "#cc241d", "#8ec07c"]


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# Tracker config
# --------------------------------------------------------------------------- #
def tracker() -> dict:
    """Parse .plan/tracker.md into a backend descriptor."""
    if not TRACKER_MD.is_file():
        die(f"{TRACKER_MD} not found — run spec-0-init first")
    text = TRACKER_MD.read_text(encoding="utf-8")
    if re.search(r"#\s*Issue tracker:\s*GitLab", text, re.IGNORECASE):
        proj = re.search(r"\*\*Project\*\*:\s*`?([^`\s]+)`?", text)
        pid = re.search(r"\*\*Project ID\*\*:\s*`?(\d+)`?", text)
        if not (proj and pid):
            die("tracker.md is GitLab mode but **Project**: / **Project ID**: are unset")
        return {"mode": "gitlab", "project": proj.group(1), "id": pid.group(1)}
    if re.search(r"#\s*Issue tracker:\s*GitHub", text, re.IGNORECASE):
        agent_lbl = "ready-for-agent"
        human_lbl = "ready-for-human"
        m = re.search(r"\|\s*ready-for-agent\s*\|\s*`([^`]+)`", text)
        if m:
            agent_lbl = m.group(1)
        m = re.search(r"\|\s*ready-for-human\s*\|\s*`([^`]+)`", text)
        if m:
            human_lbl = m.group(1)
        return {"mode": "github", "agent_label": agent_lbl, "human_label": human_lbl}
    die("tracker.md declares a local (or unknown) tracker — nothing to publish to")
    return {}  # unreachable


def cli_run(argv: list[str], retries: int = 2) -> str:
    for attempt in range(retries + 1):
        try:
            p = subprocess.run(argv, capture_output=True, text=True, timeout=120)
            if p.returncode == 0:
                return p.stdout
            if attempt == retries:
                raise RuntimeError(
                    f"{' '.join(argv[:4])}... rc={p.returncode}: {p.stderr.strip()[:300]}"
                )
        except subprocess.TimeoutExpired:
            if attempt == retries:
                raise
        time.sleep(2 * (attempt + 1))
    return ""  # unreachable


def glab_api(cfg: dict, method: str, path: str, fields: dict | None = None):
    args = ["glab", "api", "-X", method, path]
    for k, v in (fields or {}).items():
        args += ["-f", f"{k}={v}"]
    return json.loads(cli_run(args))


# --------------------------------------------------------------------------- #
# Plan-tree parsing (shapes are verifier-enforced by verify-plan-tree.py)
# --------------------------------------------------------------------------- #
def parse_issue(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    title_m = re.match(r"# (.+)", text)
    type_m = re.search(r"\*\*Type\*\*: (\w+)", text)
    ref_m = re.search(r"\*\*GitHub\*\*: (.+)", text)
    if not (title_m and type_m and ref_m):
        die(f"{path}: missing H1 / **Type** / **GitHub** — run verify-plan-tree.py")

    def section(name: str) -> str:
        m = re.search(rf"## {name}\n(.*?)(?=\n## |\Z)", text, re.S)
        return m.group(1).strip() if m else ""

    what = section("What to build")
    blocked = section("Blocked by")
    type_ = type_m.group(1)
    return {
        "path": path,
        "title": title_m.group(1).strip(),
        "type": type_,
        "ref": ref_m.group(1).strip(),
        "what": what,
        "criteria": section("Acceptance criteria"),
        "deps": re.findall(r"\]\(\./([0-9]{2}_issue_[A-Z0-9-]+\.md)\)", blocked),
        "anchors": re.findall(r"\]\((?:\.\./)+spec/([^)]+)\)", what),
        "decision": type_ == "HITL"
        and bool(re.search(r"\bDecide\b", what) or "DECISION" in path.name or "DECIDE" in path.name),
    }


def toposort(issues: list[dict]) -> list[dict]:
    by_name = {i["path"].name: i for i in issues}
    done: set[str] = set()
    order: list[dict] = []

    def visit(i: dict, stack: frozenset) -> None:
        n = i["path"].name
        if n in done or n in stack:  # cycle -> fall back to numeric order
            return
        for d in i["deps"]:
            if d in by_name:
                visit(by_name[d], stack | {n})
        done.add(n)
        order.append(i)

    for i in sorted(issues, key=lambda x: x["path"].name):
        visit(i, frozenset())
    return order


def load_tree() -> list[dict]:
    sprints = []
    for epic in sorted(d for d in PLAN.iterdir() if d.is_dir() and re.match(r"\d{2}-", d.name)):
        for sprint in sorted(d for d in epic.iterdir() if d.is_dir() and re.match(r"\d{2}-", d.name)):
            files = sorted((sprint / "issues").glob("*.md"))
            if not files:
                continue
            sprints.append({
                "enum": epic.name[:2], "eslug": epic.name[3:],
                "snum": sprint.name[:2], "sslug": sprint.name[3:],
                "sprint_md": sprint / "sprint.md",
                "issues": toposort([parse_issue(f) for f in files]),
            })
    return sprints


def build_body(issue: dict, refs: dict) -> str:
    """Ticket body from the plan file. `refs` maps issue-file path -> iid."""
    what = re.sub(
        r"\[([^\]]+)\]\((?:\.\./)+spec/([^)]+)\)", r"\1 (`.plan/spec/\2`)", issue["what"]
    )
    blocked_lines = []
    for dep in issue["deps"]:
        ref = refs.get(str(issue["path"].parent / dep))
        dep_title = dep[9:-3].replace("-", " ").lower()
        blocked_lines.append(f"- #{ref} — {dep_title}" if ref else f"- {dep} (unpublished)")
    blocked = "\n".join(blocked_lines) if blocked_lines else "- None"
    anchors = "\n".join(f"Spec anchor: `.plan/spec/{a}`" for a in dict.fromkeys(issue["anchors"]))
    return (
        f"## What to build\n\n{what}\n\n{anchors}\n\n"
        f"## Acceptance criteria\n\n{issue['criteria']}\n\n"
        f"## Blocked by\n\n{blocked}\n\n"
        f"---\n*Plan file: `{issue['path'].relative_to(ROOT)}` — the plan tree is the source of truth.*"
    )


def backfill(sprint: dict, issue: dict, iid: str) -> None:
    txt = issue["path"].read_text(encoding="utf-8")
    issue["path"].write_text(
        txt.replace("**GitHub**: <unassigned>", f"**GitHub**: #{iid}", 1), encoding="utf-8"
    )
    st = sprint["sprint_md"].read_text(encoding="utf-8")
    out = []
    for line in st.splitlines(keepends=True):
        if f"(issues/{issue['path'].name})" in line and "<unassigned>" in line:
            line = line.replace("<unassigned>", f"#{iid}", 1)
        out.append(line)
    sprint["sprint_md"].write_text("".join(out), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Backends: create one issue, return its ref number as a string
# --------------------------------------------------------------------------- #
def ensure_gitlab_sprint_objects(cfg: dict, sprint: dict, state: dict) -> None:
    pid = cfg["id"]
    if "labels" not in state:
        state["labels"] = {
            l["name"] for l in glab_api(cfg, "GET", f"projects/{pid}/labels?per_page=100")
        }
        state["milestones"] = {
            m["title"]: m["id"]
            for m in glab_api(cfg, "GET", f"projects/{pid}/milestones?per_page=100&state=active")
        }
    epic_label = f"epic::{sprint['enum']}-{sprint['eslug']}"
    if epic_label not in state["labels"]:
        color = EPIC_COLORS[(int(sprint["enum"]) - 1) % len(EPIC_COLORS)]
        glab_api(cfg, "POST", f"projects/{pid}/labels",
                 {"name": epic_label, "color": color, "description": f"Epic {sprint['enum']}"})
        state["labels"].add(epic_label)
        print(f"label created: {epic_label}", flush=True)
    ms_title = f"{sprint['enum']}-{sprint['snum']} {sprint['sslug']}"
    if ms_title not in state["milestones"]:
        m = glab_api(cfg, "POST", f"projects/{pid}/milestones", {"title": ms_title})
        state["milestones"][ms_title] = m["id"]
        print(f"milestone created: {ms_title} (id {m['id']})", flush=True)


def create_gitlab(cfg: dict, sprint: dict, issue: dict, body: str, state: dict) -> str:
    ensure_gitlab_sprint_objects(cfg, sprint, state)
    labels = [f"epic::{sprint['enum']}-{sprint['eslug']}", f"type::{issue['type']}"]
    if issue["decision"]:
        labels.append("decision")
    ms_id = state["milestones"][f"{sprint['enum']}-{sprint['snum']} {sprint['sslug']}"]
    r = glab_api(cfg, "POST", f"projects/{cfg['id']}/issues",
                 {"title": issue["title"], "description": body,
                  "labels": ",".join(labels), "milestone_id": str(ms_id)})
    return str(r["iid"])


def create_github(cfg: dict, sprint: dict, issue: dict, body: str, state: dict) -> str:
    label = cfg["human_label"] if issue["type"] == "HITL" else cfg["agent_label"]
    out = cli_run(["gh", "issue", "create", "--title", issue["title"],
                   "--label", label, "--body", body])
    m = re.search(r"/issues/(\d+)", out)
    if not m:
        raise RuntimeError(f"could not parse issue number from: {out.strip()[:200]}")
    return m.group(1)


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_publish(args: argparse.Namespace) -> int:
    cfg = tracker()
    need = "glab" if cfg["mode"] == "gitlab" else "gh"
    if not args.dry_run and shutil.which(need) is None:
        die(f"`{need}` not on PATH")

    sprints = load_tree()
    if args.sprint:
        sprints = [s for s in sprints if f"{s['enum']}-{s['snum']}" == args.sprint]
        if not sprints:
            die(f"sprint {args.sprint} not found in the plan tree")
    elif not args.all:
        # Lazy default: the first sprint with unpublished issues.
        sprints = [s for s in sprints
                   if any(i["ref"] == "<unassigned>" for i in s["issues"])][:1]
        if not sprints:
            print("nothing to publish — every issue already has a ref")
            return 0

    refs = {}  # issue-file path -> iid, for blocked-by bodies (published earlier too)
    for s in load_tree():  # all sprints, so cross-sprint blockers resolve
        for i in s["issues"]:
            m = re.match(r"#(\d+)", i["ref"])
            if m:
                refs[str(i["path"])] = m.group(1)

    total = sum(len(s["issues"]) for s in sprints)
    pending = sum(1 for s in sprints for i in s["issues"] if i["ref"] == "<unassigned>")
    scope = args.sprint or ("ALL sprints" if args.all else
                            f"{sprints[0]['enum']}-{sprints[0]['snum']} (lazy default)")
    print(f"publishing {scope}: {total} issues, {pending} unpublished, tracker={cfg['mode']}",
          flush=True)

    if args.dry_run:
        for s in sprints:
            row = ", ".join(
                f"{i['path'].name[:2]}{'*' if i['decision'] else ''}"
                f"({'#' + refs[str(i['path'])] if str(i['path']) in refs else 'new'})"
                for i in s["issues"])
            print(f"  {s['enum']}-{s['snum']} {s['sslug']}: {row}")
        return 0

    create = create_gitlab if cfg["mode"] == "gitlab" else create_github
    state: dict = {}
    created, skipped, failures = 0, 0, []
    for s in sprints:
        for i in s["issues"]:
            if str(i["path"]) in refs:
                skipped += 1
                continue
            try:
                iid = create(cfg, s, i, build_body(i, refs), state)
            except Exception as exc:  # noqa: BLE001 — per-issue, keep going
                failures.append({"issue": str(i["path"].relative_to(ROOT)), "error": str(exc)[:200]})
                print(f"FAIL {i['path'].name}: {exc}", flush=True)
                continue
            refs[str(i["path"])] = iid
            backfill(s, i, iid)
            created += 1
            print(f"#{iid}  {s['enum']}-{s['snum']}/{i['path'].name}", flush=True)
            time.sleep(0.15)

    print(json.dumps({"created": created, "skipped": skipped, "failures": failures}), flush=True)
    return 1 if failures else 0


def cmd_sync(args: argparse.Namespace) -> int:
    cfg = tracker()
    sprints = load_tree()
    refs, target = {}, None
    for s in sprints:
        for i in s["issues"]:
            m = re.match(r"#(\d+)", i["ref"])
            if m:
                refs[str(i["path"])] = m.group(1)
                if m.group(1) == str(args.iid):
                    target = i
    if target is None:
        die(f"no plan issue carries **GitHub**: #{args.iid}")
    body = build_body(target, refs)
    print(f"sync #{args.iid} <- {target['path'].relative_to(ROOT)}")
    if args.dry_run:
        print(body)
        return 0
    if cfg["mode"] == "gitlab":
        glab_api(cfg, "PUT", f"projects/{cfg['id']}/issues/{args.iid}",
                 {"title": target["title"], "description": body})
    else:
        cli_run(["gh", "issue", "edit", str(args.iid),
                 "--title", target["title"], "--body", body])
    print("synced (title + body rebuilt; labels/milestone untouched — see tracker.md for those)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd")
    p_pub = sub.add_parser("publish", help="create tickets for unpublished issues (default)")
    p_pub.add_argument("--sprint", help="publish only this sprint (EE-SS)")
    p_pub.add_argument("--all", action="store_true", help="publish every sprint (overrides lazy default)")
    p_pub.add_argument("--dry-run", action="store_true")
    p_sync = sub.add_parser("sync", help="rebuild a published ticket's title/body from its plan file")
    p_sync.add_argument("--iid", required=True, help="ticket ref number (the NNN of #NNN)")
    p_sync.add_argument("--dry-run", action="store_true")

    argv = sys.argv[1:] or ["publish"]
    if argv[0] not in ("publish", "sync"):
        argv = ["publish", *argv]
    args = ap.parse_args(argv)
    return cmd_sync(args) if args.cmd == "sync" else cmd_publish(args)


if __name__ == "__main__":
    sys.exit(main())
