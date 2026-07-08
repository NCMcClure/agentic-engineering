"""Plan-status funnel — the single deterministic way to read and write the
completion status of an epic / sprint / issue across every plan surface.

Read-only deps: stdlib only (subprocess + shutil for the optional `gh` calls).
Lives beside `verify-plan-tree.py` in `.plan/plan/`; roots itself the same way.

Two verbs:

    plan-status.py set   <EE-SS-II> <status> [--evidence "..."]
    plan-status.py check [<coords>]

`set` mutates ONE issue's status and then deterministically propagates it:

  1. the issue file's `**Status**:` field (and its `## Acceptance criteria` boxes),
  2. the issue's row in the parent sprint's `## Issues` table,
  3. the parent `sprint.md` `**Status**:` field (rolled up from its issues),
  4. the sprint's row in the grandparent `epic.md` `## Sprints` table,
  5. the `epic.md` `**Status**:` field (rolled up from its sprints),
  6. the epic's row in `plan/index.md`'s `## Epics` table,

plus the tracker issue (GitHub close/reopen + Project board Status, or GitLab
close/reopen + `status::*` label swaps via `glab`), if an external tracker is
configured in `.plan/tracker.md`. Sprint and epic statuses are
NEVER set directly — they are always derived from their children by `rollup()`.

With `--evidence` on a `done` transition, a verified-complete row is also appended
to `.plan/progress/completed/<epic>.md` (this is build-next-issue's ledger; build-sprint builders
flip status WITHOUT evidence so unverified rows never enter the ledger).

`check` recomputes the rolled-up truth for a node (issue / sprint / epic / whole
tree) and verifies every surface agrees. It exits 0 only when the node rolls up to
`done` and all surfaces agree — the deterministic replacement for the old
`grep -L "Status: done"` checkpoint, which never matched the `**Status**: done`
bold form. With a non-done or inconsistent node it prints what's off and exits 1.

Tracker failures (missing `gh`/`glab`, network, an `<unassigned>` issue) are
warnings, never fatal: the markdown surfaces are always written first, so the
deterministic contract holds offline.

Exit codes: 0 = success / consistent-and-done; 1 = check found not-done or drift;
2 = structural failure (bad coords, bad status, malformed table row).
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

PLAN_ROOT = Path(__file__).resolve().parent          # .plan/plan/
REPO_ROOT = PLAN_ROOT.parent                          # .plan/
INDEX_MD = PLAN_ROOT / "index.md"
TRACKER_MD = REPO_ROOT / "tracker.md"
COMPLETED_DIR = REPO_ROOT / "progress" / "completed"

STATUSES = ("not-started", "in-progress", "blocked", "done")
# Plan-tree status -> GitHub Project built-in Status option name.
GH_STATUS = {
    "not-started": "Todo",
    "in-progress": "In Progress",
    "blocked": "Todo",
    "done": "Done",
}
# Plan-tree status -> GitLab scoped status label (open/closed carries the rest:
# not-started = open + no status label, done = closed).
GL_STATUS_LABEL = {
    "in-progress": "status::in-progress",
    "blocked": "status::blocked",
}

ISSUE_FILE_RE = re.compile(r"^([0-9]{2})_issue_[A-Z][A-Z0-9-]+\.md$")
STATUS_FIELD_RE = re.compile(r"(\*\*Status\*\*:[ \t]*)(\S+)")
GITHUB_FIELD_RE = re.compile(r"\*\*GitHub\*\*:[ \t]*(\S+)")
H1_RE = re.compile(r"^#\s+(.*?)\s*$", re.MULTILINE)
ACCEPTANCE_SECTION_RE = re.compile(
    r"(^## Acceptance criteria\s*$)(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
)


def warn(msg: str) -> None:
    print(f"WARN: {msg}", file=sys.stderr)


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(2)


# --------------------------------------------------------------------------- #
# Coordinate resolution
# --------------------------------------------------------------------------- #
def parse_coords(raw: str) -> list[str]:
    """`01-03-07` / `01-03/07` / `01` -> ['01', '03', '07']. Parts must be 2-digit."""
    parts = [p for p in re.split(r"[-/]", raw.strip()) if p]
    for p in parts:
        if not re.fullmatch(r"[0-9]{2}", p):
            die(f"coordinate part '{p}' is not a two-digit number (got '{raw}')")
    if not 1 <= len(parts) <= 3:
        die(f"coordinates must be EE, EE-SS, or EE-SS-II (got '{raw}')")
    return parts


def epic_dir_for(ee: str) -> Path:
    matches = [
        d for d in PLAN_ROOT.iterdir() if d.is_dir() and re.match(rf"^{ee}-", d.name)
    ]
    if not matches:
        die(f"no epic directory starting with '{ee}-' under {PLAN_ROOT}")
    if len(matches) > 1:
        die(f"ambiguous epic prefix '{ee}-': {[m.name for m in matches]}")
    return matches[0]


def sprint_dir_for(epic_dir: Path, ss: str) -> Path:
    matches = [
        d for d in epic_dir.iterdir() if d.is_dir() and re.match(rf"^{ss}-", d.name)
    ]
    if not matches:
        die(f"no sprint directory starting with '{ss}-' under {epic_dir.name}")
    if len(matches) > 1:
        die(f"ambiguous sprint prefix '{ss}-': {[m.name for m in matches]}")
    return matches[0]


def issue_file_for(sprint_dir: Path, ii: str) -> Path:
    issues_dir = sprint_dir / "issues"
    if not issues_dir.is_dir():
        die(f"no issues/ directory under {sprint_dir.name}")
    matches = [
        f
        for f in issues_dir.iterdir()
        if f.is_file() and re.match(rf"^{ii}_issue_", f.name)
    ]
    if not matches:
        die(f"no issue file starting with '{ii}_issue_' under {sprint_dir.name}/issues")
    if len(matches) > 1:
        die(f"ambiguous issue prefix '{ii}_': {[m.name for m in matches]}")
    return matches[0]


def resolve_issue_path(arg: str) -> tuple[Path, Path, Path]:
    """Return (epic_dir, sprint_dir, issue_file) from coords or a direct path."""
    if arg.endswith(".md") or "/" in arg or "\\" in arg:
        p = Path(arg)
        candidate = p if p.is_absolute() else (Path.cwd() / p)
        if candidate.is_file() and ISSUE_FILE_RE.match(candidate.name):
            issue_file = candidate.resolve()
            sprint_dir = issue_file.parent.parent
            epic_dir = sprint_dir.parent
            return epic_dir, sprint_dir, issue_file
        # fall through to coord parsing if it wasn't a real issue path
    parts = parse_coords(arg)
    if len(parts) != 3:
        die(f"`set` needs full issue coordinates EE-SS-II (got '{arg}')")
    ee, ss, ii = parts
    epic_dir = epic_dir_for(ee)
    sprint_dir = sprint_dir_for(epic_dir, ss)
    issue_file = issue_file_for(sprint_dir, ii)
    return epic_dir, sprint_dir, issue_file


# --------------------------------------------------------------------------- #
# Status reading / roll-up
# --------------------------------------------------------------------------- #
def read_status_field(path: Path) -> str | None:
    m = STATUS_FIELD_RE.search(path.read_text())
    return m.group(2) if m else None


def issue_statuses(sprint_dir: Path) -> list[str]:
    issues_dir = sprint_dir / "issues"
    out = []
    for f in sorted(issues_dir.iterdir()):
        if f.is_file() and ISSUE_FILE_RE.match(f.name):
            s = read_status_field(f)
            if s:
                out.append(s)
    return out


def sprint_dirs(epic_dir: Path) -> list[Path]:
    return sorted(
        d for d in epic_dir.iterdir() if d.is_dir() and re.match(r"^\d{2}-", d.name)
    )


def sprint_statuses(epic_dir: Path) -> list[str]:
    out = []
    for sd in sprint_dirs(epic_dir):
        sm = sd / "sprint.md"
        if sm.exists():
            s = read_status_field(sm)
            if s:
                out.append(s)
    return out


def epic_dirs() -> list[Path]:
    return sorted(
        d for d in PLAN_ROOT.iterdir() if d.is_dir() and re.match(r"^\d{2}-", d.name)
    )


def rollup(children: list[str]) -> str:
    """Derive a parent's status from its children's statuses (deterministic).

    `in-progress` is evaluated BEFORE `blocked`, so a node with any active work
    reads in-progress rather than being mislabeled blocked; `blocked` is reserved
    for "something is blocked and nothing is moving."
    """
    if not children:
        return "not-started"
    if all(c == "done" for c in children):
        return "done"
    if all(c == "not-started" for c in children):
        return "not-started"
    if any(c == "in-progress" for c in children):
        return "in-progress"
    if any(c == "done" for c in children) and all(
        c in ("done", "not-started") for c in children
    ):
        return "in-progress"
    if any(c == "blocked" for c in children):
        return "blocked"
    return "in-progress"


# --------------------------------------------------------------------------- #
# Markdown rewriting
# --------------------------------------------------------------------------- #
def set_status_field(text: str, status: str) -> str:
    new, n = STATUS_FIELD_RE.subn(lambda m: m.group(1) + status, text, count=1)
    if n == 0:
        warn("no `**Status**:` field found to update")
    return new


def set_acceptance_boxes(text: str, done: bool) -> str:
    """Tick/untick every checkbox inside the `## Acceptance criteria` section only."""

    def repl(m: re.Match) -> str:
        body = m.group(2)
        if done:
            body = re.sub(r"-\s\[\s\]", "- [x]", body)
        else:
            body = re.sub(r"-\s\[[xX]\]", "- [ ]", body)
        return m.group(1) + body

    return ACCEPTANCE_SECTION_RE.sub(repl, text, count=1)


def set_table_cell(text: str, link_needle: str, status: str, what: str) -> str:
    """Rewrite ONLY the trailing Status cell of the table row whose link matches.

    Splits the matched row on `|` and replaces the last data cell, so adjacent
    cells (Type, Title, GitHub, counts) are never disturbed. Warns and skips if
    the row doesn't look like a table row.
    """
    lines = text.splitlines(keepends=True)
    hit = False
    for i, line in enumerate(lines):
        if link_needle not in line:
            continue
        stripped = line.rstrip("\n")
        if stripped.count("|") < 3:
            warn(f"{what}: matched row is not a well-formed table row; skipping")
            continue
        eol = "\n" if line.endswith("\n") else ""
        cells = stripped.split("|")
        # cells[0] and cells[-1] are the empty strings outside the leading/trailing pipes.
        cells[-2] = f" {status} "
        lines[i] = "|".join(cells) + eol
        hit = True
        break
    if not hit:
        warn(f"{what}: no table row containing '{link_needle}' found")
    return "".join(lines)


def write_if_changed(path: Path, new_text: str, old_text: str) -> None:
    if new_text != old_text:
        path.write_text(new_text)


# --------------------------------------------------------------------------- #
# GitHub (optional, best-effort)
# --------------------------------------------------------------------------- #
def tracker_mode() -> tuple[str, str | None, str | None]:
    """Return (mode, a, b). mode ∈ {'local','github','github+board','gitlab'}.

    For 'github+board' (a, b) = (project owner, project number).
    For 'gitlab'       (a, b) = (project path, numeric project id).
    """
    if not TRACKER_MD.exists():
        return "local", None, None
    text = TRACKER_MD.read_text()
    if re.search(r"#\s*Issue tracker:\s*local", text, re.IGNORECASE):
        return "local", None, None
    if re.search(r"#\s*Issue tracker:\s*GitLab", text, re.IGNORECASE):
        proj_m = re.search(r"\*\*Project\*\*:\s*`?([^`\s]+)`?", text)
        id_m = re.search(r"\*\*Project ID\*\*:\s*`?(\d+)`?", text)
        return (
            "gitlab",
            proj_m.group(1) if proj_m else None,
            id_m.group(1) if id_m else None,
        )
    if not re.search(r"#\s*Issue tracker:\s*GitHub", text, re.IGNORECASE):
        return "local", None, None
    owner_m = re.search(r"\*\*Owner\*\*:\s*`?([^`\s]+)`?", text)
    number_m = re.search(r"\*\*Number\*\*:\s*`?([^`\s]+)`?", text)
    owner = owner_m.group(1) if owner_m else None
    number = number_m.group(1) if number_m else None

    def filled(v: str | None) -> bool:
        return bool(v) and "{{" not in v and v not in ("<unset>", "-")

    if filled(owner) and filled(number) and re.fullmatch(r"\d+", number or ""):
        return "github+board", owner, number
    return "github", None, None


def gh_available() -> bool:
    return shutil.which("gh") is not None


def gh_run(args: list[str]) -> tuple[int, str]:
    try:
        p = subprocess.run(
            ["gh", *args], capture_output=True, text=True, timeout=60
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as exc:  # noqa: BLE001 — gh is best-effort
        return 1, str(exc)


def issue_number(issue_file: Path) -> str | None:
    m = GITHUB_FIELD_RE.search(issue_file.read_text())
    if not m:
        return None
    ref = m.group(1)
    nm = re.match(r"#?(\d+)", ref)
    return nm.group(1) if nm else None


def github_sync(issue_file: Path, status: str) -> None:
    """Close/reopen the issue and set the board Status. All failures are warnings."""
    mode, owner, number = tracker_mode()
    if mode == "local":
        return
    if not gh_available():
        warn("`gh` not on PATH — skipping GitHub update (markdown already updated)")
        return
    num = issue_number(issue_file)
    if not num:
        warn(
            f"{issue_file.name}: GitHub ref is <unassigned> — publish the sprint "
            "(plan-1) before status syncs to GitHub"
        )
        return

    rc, out = gh_run(["issue", "view", num, "--json", "state", "-q", ".state"])
    state = out.strip().upper() if rc == 0 else ""
    if status == "done" and state != "CLOSED":
        rc, out = gh_run(["issue", "close", num])
        if rc != 0:
            warn(f"gh issue close {num} failed: {out.strip()}")
    elif status != "done" and state == "CLOSED":
        rc, out = gh_run(["issue", "reopen", num])
        if rc != 0:
            warn(f"gh issue reopen {num} failed: {out.strip()}")

    if mode == "github+board":
        github_board_status(owner, number, num, status)


def github_board_status(owner: str, number: str, num: str, status: str) -> None:
    import json

    want = GH_STATUS[status]
    rc, out = gh_run(["project", "view", number, "--owner", owner, "--format", "json"])
    if rc != 0:
        warn(f"gh project view failed; skipping board Status: {out.strip()}")
        return
    try:
        proj_id = json.loads(out)["id"]
    except Exception:  # noqa: BLE001
        warn("could not parse project id; skipping board Status")
        return

    # Fetch only the Status field (id + its option ids) via the project node id,
    # NOT `gh project field-list`. field-list paginates a costly nested
    # fields/options connection (~100 GraphQL points on a real board); querying
    # the single field off the project node costs ~1 point. Using the node id
    # also sidesteps the user-vs-org `owner` ambiguity of a typed GraphQL query.
    field_query = (
        'query($pid:ID!){node(id:$pid){... on ProjectV2{'
        'field(name:"Status"){... on ProjectV2SingleSelectField{'
        "id options{id name}}}}}}"
    )
    rc, out = gh_run(["api", "graphql", "-F", f"pid={proj_id}", "-f", f"query={field_query}"])
    if rc != 0:
        warn(f"gh api graphql (Status field) failed; skipping board Status: {out.strip()}")
        return
    field_id = option_id = None
    try:
        field = (
            json.loads(out).get("data", {}).get("node", {}).get("field") or {}
        )
        field_id = field.get("id")
        for opt in field.get("options", []):
            if opt.get("name") == want:
                option_id = opt.get("id")
    except Exception:  # noqa: BLE001
        warn("could not parse Status field; skipping board Status")
        return
    if not field_id or not option_id:
        warn(f"no Status option '{want}' on the board; skipping")
        return

    # Resolve the issue's project-item id by querying *from the issue* to its
    # project items, NOT by listing the whole board. `gh project item-list`
    # fetches every item AND every item's field values; GitHub's GraphQL cost
    # scales with board_size × fields (~1.2 pts/item), so on a 300+ item board a
    # single list costs ~400 points — and this runs once per issue marked done,
    # so a sprint can exhaust the 5000/hr budget. This targeted query costs ~1
    # point. `{owner}`/`{repo}` are substituted by gh from the clone's remote.
    item_query = (
        "query($owner:String!,$repo:String!,$num:Int!){"
        "repository(owner:$owner,name:$repo){"
        "issue(number:$num){projectItems(first:20){nodes{id project{number}}}}}}"
    )
    rc, out = gh_run(
        ["api", "graphql",
         "-F", "owner={owner}", "-F", "repo={repo}", "-F", f"num={num}",
         "-f", f"query={item_query}"]
    )
    if rc != 0:
        warn(f"gh api graphql (projectItems) failed; skipping board Status: {out.strip()}")
        return
    item_id = None
    try:
        nodes = (
            json.loads(out)
            .get("data", {})
            .get("repository", {})
            .get("issue", {})
            .get("projectItems", {})
            .get("nodes", [])
        )
        for n in nodes:
            if str((n.get("project") or {}).get("number")) == str(number):
                item_id = n.get("id")
                break
    except Exception:  # noqa: BLE001
        warn("could not parse projectItems; skipping board Status")
        return
    if not item_id:
        warn(f"issue #{num} not on project {number}; skipping board Status")
        return

    rc, out = gh_run(
        [
            "project",
            "item-edit",
            "--id",
            item_id,
            "--project-id",
            proj_id,
            "--field-id",
            field_id,
            "--single-select-option-id",
            option_id,
        ]
    )
    if rc != 0:
        warn(f"gh project item-edit failed: {out.strip()}")


# --------------------------------------------------------------------------- #
# GitLab (optional, best-effort)
# --------------------------------------------------------------------------- #
def glab_available() -> bool:
    return shutil.which("glab") is not None


def glab_run(args: list[str]) -> tuple[int, str]:
    try:
        p = subprocess.run(
            ["glab", *args], capture_output=True, text=True, timeout=60
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as exc:  # noqa: BLE001 — glab is best-effort
        return 1, str(exc)


def gitlab_sync(issue_file: Path, status: str, reason: str | None = None) -> None:
    """Close/reopen the GitLab issue and swap `status::*` labels via `glab`.

    The board is label-driven, so lists update automatically — no board API.
    `reason` (from --evidence on a blocked transition) is posted as a comment.
    All failures are warnings; markdown surfaces are already written.
    """
    mode, proj, proj_id = tracker_mode()
    if mode != "gitlab":
        return
    if not glab_available():
        warn("`glab` not on PATH — skipping GitLab update (markdown already updated)")
        return
    num = issue_number(issue_file)
    if not num:
        warn(
            f"{issue_file.name}: GitHub ref is <unassigned> — publish the sprint "
            "(plan-1) before status syncs to GitLab"
        )
        return
    repo = ["-R", proj] if proj else []

    # Current open/closed state (via the numeric project id when known).
    state = ""
    if proj_id:
        rc, out = glab_run(["api", f"projects/{proj_id}/issues/{num}"])
        if rc == 0:
            import json

            try:
                state = json.loads(out).get("state", "")
            except Exception:  # noqa: BLE001
                pass

    # Label swap: add this status's label, drop the other status labels.
    add = GL_STATUS_LABEL.get(status)
    drop = [v for k, v in GL_STATUS_LABEL.items() if k != status]
    upd = ["issue", "update", num, *repo]
    if add:
        upd += ["--label", add]
    for lbl in drop:
        upd += ["--unlabel", lbl]
    rc, out = glab_run(upd)
    if rc != 0:
        warn(f"glab issue update {num} (labels) failed: {out.strip()}")

    if status == "done" and state != "closed":
        rc, out = glab_run(["issue", "close", num, *repo])
        if rc != 0:
            warn(f"glab issue close {num} failed: {out.strip()}")
    elif status != "done" and state == "closed":
        rc, out = glab_run(["issue", "reopen", num, *repo])
        if rc != 0:
            warn(f"glab issue reopen {num} failed: {out.strip()}")

    if status == "blocked" and reason:
        rc, out = glab_run(["issue", "note", num, "-m", f"Blocked: {reason}", *repo])
        if rc != 0:
            warn(f"glab issue note {num} (blocked reason) failed: {out.strip()}")


def tracker_sync(issue_file: Path, status: str, evidence: str | None) -> None:
    mode = tracker_mode()[0]
    if mode == "gitlab":
        gitlab_sync(issue_file, status, reason=evidence if status == "blocked" else None)
    else:
        github_sync(issue_file, status)


# --------------------------------------------------------------------------- #
# Completed ledger
# --------------------------------------------------------------------------- #
def heading_title(path: Path) -> str:
    m = H1_RE.search(path.read_text())
    return m.group(1).strip() if m else path.stem


def append_completed_row(
    epic_dir: Path,
    sprint_dir: Path,
    issue_file: Path,
    evidence: str,
) -> None:
    COMPLETED_DIR.mkdir(parents=True, exist_ok=True)
    ledger = COMPLETED_DIR / f"{epic_dir.name}.md"
    ee = epic_dir.name[:2]
    ss = sprint_dir.name[:2]
    ii = issue_file.name[:2]
    issue_id = f"{ee}-{ss}/{ii}"
    title = heading_title(issue_file)
    num = issue_number(issue_file)
    ref = f"#{num}" if num else "—"
    verified = date.today().isoformat()
    evidence_cell = evidence.replace("|", "\\|").replace("\n", " ").strip()
    row = f"| {issue_id} | {title} | {ref} | {verified} | {evidence_cell} |\n"

    if not ledger.exists():
        epic_title = heading_title(epic_dir / "epic.md")
        header = (
            f"# Completed — {epic_title}\n\n"
            "Verified-complete issues for this epic (newest last). One row per issue; "
            "evidence is what convinced the verifier, not a checkmark.\n\n"
            "| Issue | Title | Tracker ref | Verified | Evidence |\n"
            "|-------|-------|-------------|----------|----------|\n"
        )
        ledger.write_text(header + row)
        return

    text = ledger.read_text()
    row_prefix = f"| {issue_id} |"
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith(row_prefix):  # replace existing row (idempotent)
            lines[i] = row
            ledger.write_text("".join(lines))
            return
    if not text.endswith("\n"):
        text += "\n"
    ledger.write_text(text + row)


# --------------------------------------------------------------------------- #
# `set`
# --------------------------------------------------------------------------- #
def cmd_set(args: argparse.Namespace) -> int:
    status = args.status
    if status not in STATUSES:
        die(f"status must be one of {STATUSES} (got '{status}')")
    if args.evidence and status not in ("done", "blocked"):
        warn("--evidence is ignored except on done (ledger) and blocked (tracker comment)")

    epic_dir, sprint_dir, issue_file = resolve_issue_path(args.coords)

    # 1. issue file: status field + acceptance boxes
    text = issue_file.read_text()
    new = set_status_field(text, status)
    new = set_acceptance_boxes(new, done=(status == "done"))
    write_if_changed(issue_file, new, text)

    # 2 + 3. sprint table row (by issue filename) + sprint.md rolled-up field
    sprint_md = sprint_dir / "sprint.md"
    if sprint_md.exists():
        s_text = sprint_md.read_text()
        s_new = set_table_cell(
            s_text, f"(issues/{issue_file.name})", status, "sprint Issues table"
        )
        sprint_status = rollup(issue_statuses(sprint_dir))
        s_new = set_status_field(s_new, sprint_status)
        write_if_changed(sprint_md, s_new, s_text)
    else:
        warn(f"{sprint_dir.name}/sprint.md missing; skipping sprint roll-up")
        sprint_status = status

    # 4 + 5. epic Sprints table row (by sprint dir) + epic.md rolled-up field
    epic_md = epic_dir / "epic.md"
    if epic_md.exists():
        e_text = epic_md.read_text()
        e_new = set_table_cell(
            e_text, f"({sprint_dir.name}/sprint.md)", sprint_status, "epic Sprints table"
        )
        epic_status = rollup(sprint_statuses(epic_dir))
        e_new = set_status_field(e_new, epic_status)
        write_if_changed(epic_md, e_new, e_text)
    else:
        warn(f"{epic_dir.name}/epic.md missing; skipping epic roll-up")
        epic_status = sprint_status

    # 6. plan index Epics table row (by epic dir)
    if INDEX_MD.exists():
        i_text = INDEX_MD.read_text()
        i_new = set_table_cell(
            i_text, f"({epic_dir.name}/epic.md)", epic_status, "index Epics table"
        )
        write_if_changed(INDEX_MD, i_new, i_text)
    else:
        warn("plan/index.md missing; skipping index update")

    # Tracker (best-effort, after markdown is durably written)
    tracker_sync(issue_file, status, args.evidence)

    # Completed ledger (only a verified done with evidence)
    if status == "done" and args.evidence:
        append_completed_row(epic_dir, sprint_dir, issue_file, args.evidence)

    ee, ss, ii = epic_dir.name[:2], sprint_dir.name[:2], issue_file.name[:2]
    print(
        f"OK: {ee}-{ss}-{ii} -> {status}; "
        f"sprint {ee}-{ss} -> {sprint_status}; epic {ee} -> {epic_status}"
    )
    return 0


# --------------------------------------------------------------------------- #
# `check`
# --------------------------------------------------------------------------- #
def table_cell_status(text: str, link_needle: str) -> str | None:
    for line in text.splitlines():
        if link_needle in line and line.count("|") >= 3:
            cells = line.rstrip().split("|")
            return cells[-2].strip()
    return None


def check_sprint(epic_dir: Path, sprint_dir: Path, problems: list[str]) -> str:
    sprint_md = sprint_dir / "sprint.md"
    statuses = issue_statuses(sprint_dir)
    truth = rollup(statuses)
    field = read_status_field(sprint_md) if sprint_md.exists() else None
    if field is not None and field != truth:
        problems.append(
            f"{sprint_dir.name}/sprint.md `**Status**: {field}` != rolled-up {truth}"
        )
    # each issue's table cell agrees with its field
    if sprint_md.exists():
        s_text = sprint_md.read_text()
        for f in sorted((sprint_dir / "issues").iterdir()):
            if f.is_file() and ISSUE_FILE_RE.match(f.name):
                cell = table_cell_status(s_text, f"(issues/{f.name})")
                fld = read_status_field(f)
                if cell is not None and cell != fld:
                    problems.append(
                        f"{sprint_dir.name}: table cell '{cell}' != {f.name} field '{fld}'"
                    )
    return truth


def check_epic(epic_dir: Path, problems: list[str]) -> str:
    epic_md = epic_dir / "epic.md"
    child_truths = []
    e_text = epic_md.read_text() if epic_md.exists() else ""
    for sd in sprint_dirs(epic_dir):
        st = check_sprint(epic_dir, sd, problems)
        child_truths.append(st)
        cell = table_cell_status(e_text, f"({sd.name}/sprint.md)")
        if cell is not None and cell != st:
            problems.append(
                f"{epic_dir.name}: Sprints-table cell '{cell}' for {sd.name} "
                f"!= rolled-up {st}"
            )
    truth = rollup(child_truths)
    field = read_status_field(epic_md) if epic_md.exists() else None
    if field is not None and field != truth:
        problems.append(
            f"{epic_dir.name}/epic.md `**Status**: {field}` != rolled-up {truth}"
        )
    if INDEX_MD.exists():
        cell = table_cell_status(INDEX_MD.read_text(), f"({epic_dir.name}/epic.md)")
        if cell is not None and cell != truth:
            problems.append(
                f"index Epics-table cell '{cell}' for {epic_dir.name} != rolled-up {truth}"
            )
    return truth


def cmd_check(args: argparse.Namespace) -> int:
    problems: list[str] = []
    if not args.coords:
        truths = [check_epic(ed, problems) for ed in epic_dirs()]
        node = "plan tree"
        truth = rollup(truths)
    else:
        parts = parse_coords(args.coords)
        if len(parts) == 1:
            ed = epic_dir_for(parts[0])
            truth = check_epic(ed, problems)
            node = ed.name
        elif len(parts) == 2:
            ed = epic_dir_for(parts[0])
            sd = sprint_dir_for(ed, parts[1])
            truth = check_sprint(ed, sd, problems)
            node = f"{ed.name}/{sd.name}"
        else:
            ed, sd, isf = resolve_issue_path(args.coords)
            truth = read_status_field(isf) or "not-started"
            node = isf.name
            check_sprint(ed, sd, problems)  # surface-agreement for the parent sprint

    print(f"{node}: {truth}")
    for p in problems:
        print(f"DRIFT: {p}")
    if problems:
        return 1
    if truth != "done":
        print(f"NOT DONE: {node} is '{truth}'")
        return 1
    return 0


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="plan-status.py", description=__doc__)
    sub = parser.add_subparsers(dest="verb", required=True)

    p_set = sub.add_parser("set", help="set one issue's status and roll up")
    p_set.add_argument("coords", help="issue coordinates EE-SS-II (or a path to the issue file)")
    p_set.add_argument("status", help=f"one of {', '.join(STATUSES)}")
    p_set.add_argument(
        "--evidence",
        default=None,
        help="verified-complete evidence (done) or blocked reason (blocked, GitLab comment)",
    )
    p_set.set_defaults(func=cmd_set)

    p_check = sub.add_parser("check", help="report/verify status of a node")
    p_check.add_argument("coords", nargs="?", default=None, help="EE, EE-SS, EE-SS-II (default: whole tree)")
    p_check.set_defaults(func=cmd_check)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
