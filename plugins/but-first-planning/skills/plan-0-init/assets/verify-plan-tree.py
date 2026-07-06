"""Plan-tree structural verifier (count-agnostic).

Read-only. No external dependencies (stdlib only). Validates the
`.plan/plan/` epic -> sprint -> issue tree authored by the `plan-4-plan` skill.

Exits 0 on a clean pass, 1 on warnings only, 2 on any critical violation.
Critical = broken structure, missing required fields, or unresolved links.

Steady-state success output reports the actual discovered counts, e.g.:
    OK: 3 epics, 11 sprints, 84 issues, 0 broken links, 0 missing fields
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

PLAN_ROOT = Path(__file__).resolve().parent          # .plan/plan/
REPO_ROOT = PLAN_ROOT.parent                          # .plan/

ISSUE_FILENAME_RE = re.compile(r"^[0-9]{2}_issue_[A-Z][A-Z0-9-]+\.md$")
REQUIRED_ISSUE_FIELDS = [
    "**Sprint**",
    "**Type**",
    "**GitHub**",
    "**Status**",
    "## Parent",
    "## What to build",
    "## Acceptance criteria",
    "## Testing checkpoint",
    "## Blocked by",
]
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
SECTION_BLOCKED_BY_RE = re.compile(
    r"^## Blocked by\s*$(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
)
SECTION_WHAT_TO_BUILD_RE = re.compile(
    r"^## What to build\s*$(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
)


def fail(failures: list[str], path: Path, msg: str) -> None:
    failures.append(f"{path.relative_to(REPO_ROOT)}: {msg}")


def verify() -> int:
    failures: list[str] = []

    epic_dirs = sorted(
        p for p in PLAN_ROOT.iterdir() if p.is_dir() and re.match(r"^\d{2}-", p.name)
    )
    epic_mds = [d / "epic.md" for d in epic_dirs]
    sprint_mds: list[Path] = []
    issue_mds: list[Path] = []

    # An empty plan tree (no epics yet) is a valid post-init state — epics are
    # added by the plan-4-plan skill. Report zero counts rather than failing.

    for epic_dir in epic_dirs:
        if not (epic_dir / "epic.md").exists():
            failures.append(f"{epic_dir.relative_to(REPO_ROOT)}: missing epic.md")
            continue

        sprint_dirs = sorted(
            p for p in epic_dir.iterdir() if p.is_dir() and re.match(r"^\d{2}-", p.name)
        )
        for sprint_dir in sprint_dirs:
            sprint_md = sprint_dir / "sprint.md"
            if not sprint_md.exists():
                failures.append(f"{sprint_dir.relative_to(REPO_ROOT)}: missing sprint.md")
                continue
            sprint_mds.append(sprint_md)

            issues_dir = sprint_dir / "issues"
            if not issues_dir.is_dir():
                failures.append(f"{sprint_dir.relative_to(REPO_ROOT)}: missing issues/ directory")
                continue

            for issue_file in sorted(issues_dir.iterdir()):
                if not issue_file.is_file() or not issue_file.name.endswith(".md"):
                    continue
                if not ISSUE_FILENAME_RE.match(issue_file.name):
                    fail(failures, issue_file, "filename does not match pattern NN_issue_SLUG.md")
                issue_mds.append(issue_file)

    # Per-issue required fields, GitHub field, and link integrity
    for issue_md in issue_mds:
        text = issue_md.read_text()
        for required in REQUIRED_ISSUE_FIELDS:
            if required not in text:
                fail(failures, issue_md, f"missing required field/section: {required}")

        if "GitHub**:" in text and "<unassigned>" not in text and not re.search(r"#\d+", text):
            fail(failures, issue_md, "GitHub field is neither '<unassigned>' nor a '#NNN' reference")

        block = SECTION_BLOCKED_BY_RE.search(text)
        if block:
            for _, link in MD_LINK_RE.findall(block.group(1)):
                if link.startswith("http"):
                    continue
                if not (issue_md.parent / link).resolve().exists():
                    fail(failures, issue_md, f"Blocked-by link does not resolve: {link}")

        wtb = SECTION_WHAT_TO_BUILD_RE.search(text)
        if wtb:
            for _, link in MD_LINK_RE.findall(wtb.group(1)):
                if "spec/" not in link:
                    continue
                if not (issue_md.parent / link).resolve().exists():
                    fail(failures, issue_md, f"spec anchor does not resolve: {link}")

    # Sprint -> issues count integrity (table rows == files on disk)
    for sprint_md in sprint_mds:
        text = sprint_md.read_text()
        in_table = sorted(set(re.findall(r"\(issues/([^)]+)\)", text)))
        on_disk = sorted(p.name for p in (sprint_md.parent / "issues").iterdir() if p.suffix == ".md")
        if in_table != on_disk:
            missing = sorted(set(in_table) - set(on_disk))
            extra = sorted(set(on_disk) - set(in_table))
            if missing:
                fail(failures, sprint_md, f"sprint.md lists issues not on disk: {missing}")
            if extra:
                fail(failures, sprint_md, f"issues on disk not listed in sprint.md: {extra}")

    # Epic -> sprint count integrity
    for epic_md in epic_mds:
        if not epic_md.exists():
            continue
        text = epic_md.read_text()
        in_table = sorted(set(re.findall(r"\((\d{2}-[a-z0-9-]+)/sprint\.md\)", text)))
        on_disk = sorted(
            p.name for p in epic_md.parent.iterdir() if p.is_dir() and re.match(r"^\d{2}-", p.name)
        )
        if in_table != on_disk:
            missing = sorted(set(in_table) - set(on_disk))
            extra = sorted(set(on_disk) - set(in_table))
            if missing:
                fail(failures, epic_md, f"epic.md lists sprint dirs not on disk: {missing}")
            if extra:
                fail(failures, epic_md, f"sprint dirs on disk not listed in epic.md: {extra}")

    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} failure(s)")
        return 2

    print(
        f"OK: {len(epic_mds)} epics, {len(sprint_mds)} sprints, "
        f"{len(issue_mds)} issues, 0 broken links, 0 missing fields"
    )
    return 0


if __name__ == "__main__":
    sys.exit(verify())
