#!/usr/bin/env python3
"""Deterministic scanner and scoring calculator for the evaluate-plugin skill.

Scan mode walks a Claude Code plugin directory and emits a single JSON profile
to stdout: component census, per-skill frontmatter facts, context-footprint
estimates, hooks/workflow static checks, lint findings, mechanical check
grades, the N/A set, and any triggered verdict gates. The grading step (model
or workflow) reasons from these facts instead of re-deriving them by hand.

Score mode merges the model's judgment grades (grades.json) with the
mechanical grades, applies the weight tables below, and emits the composite,
per-dimension scores, and the verdict. ALL scoring arithmetic lives here —
weights, bands, renormalization, gates, tier thresholds — so the inline and
workflow evaluation paths produce identical numbers and the model never does
scoring math in prose.

Stdlib only — no pip installs, so it runs anywhere a plugin can be checked out.

Usage:
    python3 plugin_scan.py <plugin_path>                       # scan
    python3 plugin_scan.py <plugin_path> --score <grades.json> # score

Honesty notes baked into the output: token counts are chars//4 estimates
(`claude plugin details <name>` is ground truth for an installed plugin), the
frontmatter parser is a flat-YAML reader that reports "partial" rather than
guessing, and workflow checks are regex signals for a grader to confirm —
never verdicts by themselves.
"""

import argparse
import json
import os
import re
import sys

# Never leave __pycache__ next to this script — it would be cruft inside the
# plugin tree (and inside any target that vendors the script).
sys.dont_write_bytecode = True

# ---------------------------------------------------------------------------
# The rubric's numeric skeleton. Check kinds: "m" = mechanical (graded here),
# "j" = judgment (graded by the model against references/rubric.md anchors).
# Weights are relative within their dimension; dimension weights are relative
# within the applicable set (renormalized when a dimension is N/A).
# ---------------------------------------------------------------------------

DIMENSIONS = {
    "SQ": {"label": "Skill quality", "weight": 30},
    "CS": {"label": "Component symbiosis", "weight": 15},
    "WQ": {"label": "Workflow quality", "weight": 10},
    "AN": {"label": "Architecture & navigability", "weight": 15},
    "CF": {"label": "Context-window footprint", "weight": 20},
    "MH": {"label": "Manifest & distribution hygiene", "weight": 10},
}

CHECKS = {
    # id: (dimension, kind, weight, label)
    "SQ1": ("SQ", "j", 3, "Description quality (leading word, one trigger per branch)"),
    "SQ2": ("SQ", "j", 2, "Invocation-mode fitness"),
    "SQ3": ("SQ", "j", 2, "Information hierarchy & progressive disclosure"),
    "SQ4": ("SQ", "j", 2, "Completion criteria checkable + exhaustive"),
    "SQ5": ("SQ", "j", 2, "Failure modes: duplication, sediment, sprawl, no-ops"),
    "SQ6": ("SQ", "j", 1, "Leading words earning their repetitions"),
    "SQ7": ("SQ", "m", 1, "Relative links resolve"),
    "CS1": ("CS", "j", 2, "Hooks complement skills"),
    "CS2": ("CS", "j", 3, "Deterministic offload to scripts"),
    "CS3": ("CS", "m", 1, "No orphaned components"),
    "CS4": ("CS", "j", 1, "Commands/agents/MCP coherence"),
    "CS5": ("CS", "j", 1, "Visualization/report component where warranted"),
    "CS6": ("CS", "j", 2, "Asset reuse over regeneration"),
    "WQ1": ("WQ", "m", 1, "Workflow meta correctness + phase/title match"),
    "WQ2": ("WQ", "m", 1, "Args coercion + resume safety"),
    "WQ3": ("WQ", "j", 2, "Model/effort tier intelligence"),
    "WQ4": ("WQ", "j", 1, "Pipeline vs parallel correctness"),
    "WQ5": ("WQ", "j", 1, "Schemas, null-handling, log coverage"),
    "WQ6": ("WQ", "j", 1, "No obvious logic flaws"),
    "AN1": ("AN", "j", 2, "Tree tells the story"),
    "AN2": ("AN", "m", 2, "Self-containment (paths)"),
    "AN3": ("AN", "j", 1, "Extensibility"),
    "AN4": ("AN", "j", 1, "Single source of truth"),
    "AN5": ("AN", "m", 1, "No cruft or never-loaded files"),
    "CF1": ("CF", "m", 2, "Passive token footprint"),
    "CF2": ("CF", "m", 1, "Description length caps"),
    "CF3": ("CF", "j", 2, "Passive cost buys autonomous reach"),
    "CF4": ("CF", "m", 1, "On-invoke body size"),
    "CF5": ("CF", "j", 1, "Hook context-injection cost"),
    "MH1": ("MH", "m", 1, "Manifest completeness"),
    "MH2": ("MH", "j", 1, "README answers problem/how/install/skills"),
    "MH3": ("MH", "m", 1, "Changelog present and current"),
    "MH4": ("MH", "j", 1, "Pitch quality"),
}

# Checks graded once per skill by the model; score mode averages the entries.
PER_SKILL_CHECKS = {"SQ1", "SQ2", "SQ3", "SQ4", "SQ5", "SQ6"}

VERDICT_TIERS = [  # (floor, name) — first match wins, highest floor first
    (85, "adopt"),
    (70, "adopt-with-fixes"),
    (50, "rework"),
    (0, "avoid"),
]
TIER_ORDER = ["adopt", "adopt-with-fixes", "rework", "avoid"]  # best → worst

# CF1 bands: estimated always-on tokens → grade.
PASSIVE_TOKEN_BANDS = [(200, 4), (400, 3), (800, 2), (1500, 1)]

# The combined description + when_to_use listing cap (chars) per skill.
DESCRIPTION_CAP = 1536
# Recommended max SKILL.md body length (lines) before disclosure should kick in.
BODY_LINE_GUIDANCE = 500
# Fenced code blocks at or above this many lines are CS6 extraction candidates.
BIG_FENCE_LINES = 40
# A directory with more direct source files than this reads as overstuffed.
OVERSTUFFED = 25

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv",
             ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build",
             ".next", ".turbo", ".cache"}

CRUFT_NAMES = {".DS_Store", "Thumbs.db"}
CRUFT_DIRS = {"node_modules", "__pycache__", ".pytest_cache", ".mypy_cache"}

ABS_PATH_RE = re.compile(r"(?:^|[\"'\s(=:])(/(?:home|Users|fast|mnt/c/Users)/[A-Za-z0-9._-]+[^\s\"')]*)")
TEXT_EXTS = {".md", ".sh", ".js", ".mjs", ".cjs", ".json", ".py", ".yml", ".yaml",
             ".ts", ".tsx", ".css", ".txt", ".html"}

# Frontmatter fields the harness actually reads; anything else is noted.
KNOWN_SKILL_FIELDS = {
    "name", "description", "when_to_use", "argument-hint", "arguments",
    "disable-model-invocation", "user-invocable", "allowed-tools",
    "disallowed-tools", "model", "effort", "context", "agent", "hooks",
    "paths", "shell", "license", "metadata",
}

EST_NOTE = "chars//4 estimate; `claude plugin details <name>` is ground truth when installed"


def tokens(chars):
    return chars // 4


def walk_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            yield os.path.join(dirpath, f)


def rel(root, path):
    return os.path.relpath(path, root)


def read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Frontmatter: a deliberately naive flat-YAML reader. Handles `key: value`,
# `key: >`/`key: |` block scalars, and quoted strings. Anything nested or
# exotic flips parse_ok to "partial" so the grader knows to look itself.
# ---------------------------------------------------------------------------

def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, False, []
    lines = text.split("\n")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}, "partial", []
    fields, order, partial = {}, [], False
    i = 1
    while i < end:
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not m:
            partial = True
            i += 1
            continue
        key, val = m.group(1), m.group(2).strip()
        order.append(key)
        if val in (">", "|", ">-", "|-"):
            block = []
            i += 1
            while i < end and (not lines[i].strip() or lines[i].startswith((" ", "\t"))):
                block.append(lines[i].strip())
                i += 1
            fields[key] = " ".join(b for b in block if b)
            continue
        if val == "":
            # nested mapping/sequence — record presence, don't pretend to read it
            fields[key] = True
            depth_re = re.compile(r"^(\s+)\S")
            j = i + 1
            nested = False
            while j < end and (not lines[j].strip() or depth_re.match(lines[j])):
                if lines[j].strip():
                    nested = True
                j += 1
            if nested:
                partial = True
                i = j
                continue
        else:
            fields[key] = val.strip("\"'")
        i += 1
    return fields, ("partial" if partial else True), order


def truthy(val):
    return str(val).strip().lower() in ("true", "yes", "1")


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------

def find_skill_files(root):
    out = []
    skills_dir = os.path.join(root, "skills")
    if os.path.isdir(skills_dir):
        for entry in sorted(os.listdir(skills_dir)):
            p = os.path.join(skills_dir, entry, "SKILL.md")
            if os.path.isfile(p):
                out.append(p)
    root_skill = os.path.join(root, "SKILL.md")
    if os.path.isfile(root_skill):
        out.append(root_skill)
    return out


MD_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)#\s]+)\)")


def scan_skill(root, path):
    text = read_text(path) or ""
    fm, parse_ok, order = parse_frontmatter(text)
    body = text
    if text.startswith("---"):
        parts = text.split("\n---", 2)
        if len(parts) >= 2:
            body = parts[-1] if len(parts) == 2 else parts[2]
    body_lines = body.count("\n") + 1
    skill_dir = os.path.dirname(path)

    desc = str(fm.get("description", "")) if fm.get("description") not in (None, True) else ""
    wtu = str(fm.get("when_to_use", "")) if fm.get("when_to_use") not in (None, True) else ""
    combined = len(desc) + len(wtu)
    model_invoked = not truthy(fm.get("disable-model-invocation", ""))

    links, broken = [], []
    for target in MD_LINK_RE.findall(text):
        if target.startswith(("http://", "https://", "mailto:", "${", "/")):
            continue
        links.append(target)
        resolved = os.path.normpath(os.path.join(skill_dir, target))
        if not os.path.exists(resolved):
            broken.append(target)
        elif not (resolved + os.sep).startswith(os.path.abspath(root) + os.sep) \
                and resolved != os.path.abspath(root):
            broken.append(target + " (escapes plugin root)")

    # sibling support files never mentioned anywhere in the skill dir's text
    mentioned = text
    for other in walk_files(skill_dir):
        if other == path:
            continue
        t = read_text(other)
        if t and other.endswith((".md", ".js", ".json")):
            mentioned += t
    unlinked = []
    for other in walk_files(skill_dir):
        if other == path:
            continue
        base = os.path.basename(other)
        if base not in mentioned:
            unlinked.append(rel(root, other))

    fences = []
    for m in re.finditer(r"```[^\n]*\n(.*?)```", body, re.S):
        n = m.group(1).count("\n")
        if n >= BIG_FENCE_LINES:
            fences.append(n)

    return {
        "name": fm.get("name", os.path.basename(skill_dir)),
        "path": rel(root, path),
        "frontmatter": {
            "parse_ok": parse_ok,
            "fields": order,
            "unknown_fields": sorted(set(order) - KNOWN_SKILL_FIELDS),
        },
        "model_invoked": model_invoked,
        "user_invocable": not (str(fm.get("user-invocable", "")).strip().lower() == "false"),
        "description_chars": len(desc),
        "when_to_use_chars": len(wtu),
        "combined_chars": combined,
        "over_1536": combined > DESCRIPTION_CAP,
        "body_lines": body_lines,
        "body_chars": len(body),
        "est_passive_tokens": tokens(combined) if model_invoked else 0,
        "est_body_tokens": tokens(len(body)),
        "big_fenced_blocks": fences,
        "md_links": links,
        "broken_links": broken,
        "sibling_files_unlinked": unlinked,
    }


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

CONTEXT_INJECTING_EVENTS = {"SessionStart", "UserPromptSubmit", "UserPromptExpansion"}


def scan_hooks(root):
    path = os.path.join(root, "hooks", "hooks.json")
    if not os.path.isfile(path):
        return {"present": False}
    raw = read_text(path)
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"present": True, "parse_ok": False}
    entries = []
    hooks_obj = data.get("hooks", data)
    if not isinstance(hooks_obj, dict):
        return {"present": True, "parse_ok": False}
    for event, groups in hooks_obj.items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            for h in group.get("hooks", []):
                cmd = h.get("command", "")
                uses_root = "${CLAUDE_PLUGIN_ROOT}" in cmd
                ref_exists = None
                m = re.search(r"\$\{CLAUDE_PLUGIN_ROOT\}[\"']?(/[^\s\"']+)", cmd)
                if m:
                    ref_exists = os.path.isfile(os.path.join(root, m.group(1).lstrip("/")))
                entries.append({
                    "event": event,
                    "matcher": group.get("matcher", ""),
                    "type": h.get("type", "command"),
                    "command": cmd[:200],
                    "uses_plugin_root": uses_root,
                    "referenced_file_exists": ref_exists,
                    "injects_context": event in CONTEXT_INJECTING_EVENTS
                                       or h.get("type") in ("prompt", "agent"),
                })
    return {
        "present": True,
        "parse_ok": True,
        "hook_count": len(entries),
        "events": sorted({e["event"] for e in entries}),
        "entries": entries,
        "context_injectors": sum(1 for e in entries if e["injects_context"]),
        "missing_referenced_files": [e["command"] for e in entries
                                     if e["referenced_file_exists"] is False],
    }


# ---------------------------------------------------------------------------
# Workflows: regex signals over *.js under any workflows/ directory. These are
# hints for a grader to confirm — a regex cannot judge a barrier.
# ---------------------------------------------------------------------------

def scan_workflow(root, path):
    text = read_text(path) or ""
    meta_m = re.search(r"export\s+const\s+meta\s*=", text)
    meta_name = re.search(r"name:\s*['\"]([^'\"]+)['\"]", text)
    phase_titles = re.findall(r"\{\s*title:\s*['\"]([^'\"]+)['\"]", text)
    phase_calls = re.findall(r"(?<!\.)phase\(\s*['\"]([^'\"]+)['\"]", text)
    mismatch = sorted(set(phase_calls) - set(phase_titles))
    agent_calls = len(re.findall(r"\bagent\(", text))
    schemas = len(re.findall(r"schema:", text))
    models = {
        "haiku": len(re.findall(r"model:\s*['\"]haiku['\"]", text)),
        "sonnet": len(re.findall(r"model:\s*['\"]sonnet['\"]", text)),
        "opus": len(re.findall(r"model:\s*['\"]opus['\"]", text)),
    }
    models["omitted"] = max(agent_calls - sum(models.values()), 0)
    parallels = re.findall(r"^.*parallel\(.*$", text, re.M)
    lines = text.split("\n")
    justified = 0
    for i, line in enumerate(lines):
        if "parallel(" in line and not line.strip().startswith("//"):
            window = "\n".join(lines[max(0, i - 2):i + 1])
            if "//" in window:
                justified += 1
    return {
        "path": rel(root, path),
        "meta_ok": bool(meta_m and meta_name),
        "meta_name": meta_name.group(1) if meta_name else None,
        "phase_titles": phase_titles,
        "phase_calls": phase_calls,
        "phase_title_mismatch": mismatch,
        "has_args_coercion": bool(re.search(r"typeof\s+A\s*===\s*['\"]string['\"]", text)
                                  or re.search(r"JSON\.parse\(\s*args", text)),
        "uses_date_now": "Date.now(" in text,
        "uses_math_random": "Math.random(" in text,
        "uses_new_date": bool(re.search(r"new\s+Date\s*\(\s*\)", text)),
        "agent_calls": agent_calls,
        "agent_calls_with_schema": schemas,
        "models": models,
        "parallel_calls": len([l for l in parallels if not l.strip().startswith("//")]),
        "parallel_with_nearby_comment": justified,
        "filter_boolean_uses": text.count(".filter(Boolean)"),
        "log_calls": len(re.findall(r"(?<![.\w])log\(", text)),
        "note": "regex signals for a grader to confirm, not verdicts",
    }


# ---------------------------------------------------------------------------
# Lint, tree, README, manifest
# ---------------------------------------------------------------------------

def scan_lint(root, all_files):
    abs_paths, parent_escapes, cruft = [], [], []
    plugin_root_uses = plugin_data_uses = 0
    for path in all_files:
        base = os.path.basename(path)
        if base in CRUFT_NAMES:
            cruft.append(rel(root, path))
        if os.path.splitext(path)[1] not in TEXT_EXTS:
            continue
        text = read_text(path)
        if text is None:
            continue
        plugin_root_uses += text.count("${CLAUDE_PLUGIN_ROOT}")
        plugin_data_uses += text.count("${CLAUDE_PLUGIN_DATA}")
        for i, line in enumerate(text.split("\n"), 1):
            for m in ABS_PATH_RE.finditer(line):
                abs_paths.append({"file": rel(root, path), "line": i,
                                  "match": m.group(1)[:120]})
            # needle built by concatenation so this scanner never flags its
            # own source (or a target that vendors it)
            if "${CLAUDE_PLUGIN_ROOT}" + "/.." in line:
                parent_escapes.append({"file": rel(root, path), "line": i,
                                       "match": line.strip()[:120]})
    for dirpath, dirnames, _ in os.walk(root):
        for d in dirnames:
            if d in CRUFT_DIRS:
                cruft.append(rel(root, os.path.join(dirpath, d)) + "/")
    return {
        "absolute_paths": abs_paths,
        "parent_escapes": parent_escapes,
        "plugin_root_uses": plugin_root_uses,
        "plugin_data_uses": plugin_data_uses,
        "cruft": sorted(set(cruft)),
        "own_marketplace_json": os.path.isfile(
            os.path.join(root, ".claude-plugin", "marketplace.json")),
    }


def scan_tree(root, all_files):
    by_top, depth = {}, 0
    dir_counts = {}
    for path in all_files:
        r = rel(root, path)
        parts = r.split(os.sep)
        depth = max(depth, len(parts))
        by_top[parts[0]] = by_top.get(parts[0], 0) + 1
        d = os.path.dirname(r) or "."
        dir_counts[d] = dir_counts.get(d, 0) + 1
    overstuffed = [{"dir": d, "files": n} for d, n in sorted(dir_counts.items())
                   if n > OVERSTUFFED]
    return {"total_files": len(all_files), "max_depth": depth,
            "by_top_dir": by_top, "overstuffed_dirs": overstuffed}


def scan_readme(root, manifest_version):
    path = os.path.join(root, "README.md")
    if not os.path.isfile(path):
        return {"present": False}
    text = read_text(path) or ""
    headings = re.findall(r"^#+\s+(.+)$", text, re.M)
    low = [h.lower() for h in headings]
    top_ver = None
    m = re.search(r"^[-*]\s+\*{0,2}v?(\d+\.\d+\.\d+)", text, re.M)
    if not m:
        m = re.search(r"^#+\s+v?(\d+\.\d+\.\d+)", text, re.M)
    if m:
        top_ver = m.group(1)
    return {
        "present": True,
        "lines": text.count("\n") + 1,
        "headings": headings,
        "has_install_heading": any("install" in h for h in low),
        "has_changelog_heading": any("changelog" in h for h in low),
        "changelog_top_version": top_ver,
        "changelog_matches_manifest": (top_ver == manifest_version
                                       if top_ver and manifest_version else False),
    }


SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def scan_manifest(root):
    path = os.path.join(root, ".claude-plugin", "plugin.json")
    if not os.path.isfile(path):
        return {"present": False, "parse_ok": False, "missing_fields": ["<file>"]}
    try:
        data = json.loads(read_text(path) or "")
    except json.JSONDecodeError:
        return {"present": True, "parse_ok": False, "missing_fields": ["<unparseable>"]}
    missing = [f for f in ("name", "version", "description", "author") if f not in data]
    return {
        "present": True,
        "parse_ok": True,
        "name": data.get("name"),
        "version": data.get("version"),
        "version_semver_ok": bool(SEMVER_RE.match(str(data.get("version", "")))),
        "description_chars": len(data.get("description", "") or ""),
        "author_ok": isinstance(data.get("author"), dict) and "name" in data.get("author", {}),
        "keywords": len(data.get("keywords", []) or []),
        "name_matches_dir": data.get("name") == os.path.basename(os.path.abspath(root)),
        "missing_fields": missing,
    }


# ---------------------------------------------------------------------------
# Census + footprint + orphans
# ---------------------------------------------------------------------------

def scan_components(root, skills, workflows):
    def count_md(d):
        p = os.path.join(root, d)
        return len([f for f in os.listdir(p) if f.endswith(".md")]) if os.path.isdir(p) else 0

    script_files = []
    for path in walk_files(root):
        if os.path.splitext(path)[1] in (".py", ".sh") and ".claude-plugin" not in path:
            script_files.append(rel(root, path))
    return {
        "skills": len(skills),
        "commands": count_md("commands"),
        "agents": count_md("agents"),
        "hooks": os.path.isfile(os.path.join(root, "hooks", "hooks.json")),
        "mcp": os.path.isfile(os.path.join(root, ".mcp.json")),
        "workflows": len(workflows),
        "scripts": len(script_files),
        "script_files": sorted(script_files),
        "monitors": os.path.isfile(os.path.join(root, "monitors", "monitors.json")),
        "bin": os.path.isdir(os.path.join(root, "bin")),
        "assets_or_templates_dirs": sorted(
            rel(root, d) for d in (os.path.join(dp, dn)
                                   for dp, dns, _ in os.walk(root) for dn in dns)
            if os.path.basename(d) in ("assets", "templates")),
        "output_styles": count_md("output-styles"),
        "settings_json": os.path.isfile(os.path.join(root, "settings.json")),
        "root_claude_md": os.path.isfile(os.path.join(root, "CLAUDE.md")),
    }


def scan_agents_passive(root):
    out = []
    agents_dir = os.path.join(root, "agents")
    if not os.path.isdir(agents_dir):
        return out
    for f in sorted(os.listdir(agents_dir)):
        if not f.endswith(".md"):
            continue
        fm, _, _ = parse_frontmatter(read_text(os.path.join(agents_dir, f)) or "")
        desc = str(fm.get("description", "")) if fm.get("description") not in (None, True) else ""
        out.append({"agent": f, "description_chars": len(desc),
                    "est_passive_tokens": tokens(len(desc))})
    return out


def build_footprint(skills, agents_passive, components):
    per_source = []
    for s in skills:
        if s["model_invoked"]:
            per_source.append({"source": f"{s['path']} (description)",
                               "tokens": s["est_passive_tokens"]})
    for a in agents_passive:
        per_source.append({"source": f"agents/{a['agent']} (description)",
                           "tokens": a["est_passive_tokens"]})
    if components["mcp"]:
        per_source.append({"source": ".mcp.json tool names (deferred schemas)",
                           "tokens": 30})
    total = sum(p["tokens"] for p in per_source)
    return {
        "passive_tokens_est": total,
        "per_source": per_source,
        "cap_violations": [s["path"] for s in skills if s["over_1536"]],
        "on_invoke": [{"skill": s["path"], "body_tokens_est": s["est_body_tokens"],
                       "body_lines": s["body_lines"],
                       "over_500_lines": s["body_lines"] > BODY_LINE_GUIDANCE}
                      for s in skills],
        "note": EST_NOTE,
    }


def scan_orphans(root, skills, all_files):
    # A support file is orphaned when no OTHER text file in the plugin mentions
    # its basename or (for code) its module stem. Structural files are exempt.
    texts = {}
    for path in all_files:
        if os.path.splitext(path)[1] in TEXT_EXTS:
            texts[path] = read_text(path) or ""
    corpus = "\n".join(texts.values())
    exempt = {"plugin.json", "README.md", "SKILL.md", "hooks.json",
              "marketplace.json", ".gitignore", "LICENSE", "CLAUDE.md",
              "__init__.py", "index.md", "index.html"}
    orphans = []
    for path in all_files:
        base = os.path.basename(path)
        if base in exempt or ".claude-plugin" in path:
            continue
        own = texts.get(path, "")
        if corpus.count(base) - own.count(base) > 0:
            continue
        stem = os.path.splitext(base)[0]
        # Code modules are commonly referenced by stem: Python imports, JS/TS
        # extensionless imports ("./codegen"), shell sourcing. Match the stem.
        if os.path.splitext(base)[1] in (".py", ".js", ".mjs", ".cjs", ".ts",
                                         ".tsx", ".sh", ".css"):
            stem_re = re.compile(r"\b" + re.escape(stem) + r"\b")
            if len(stem_re.findall(corpus)) - len(stem_re.findall(own)) > 0:
                continue
        orphans.append(rel(root, path))
    return sorted(orphans)


# ---------------------------------------------------------------------------
# Mechanical grades + N/A + gates
# ---------------------------------------------------------------------------

def band_grade(value, bands, default=0):
    for limit, grade in bands:
        if value <= limit:
            return grade
    return default


def mechanical_grades(scan):
    g = {}

    broken = sum(len(s["broken_links"]) for s in scan["skills"])
    g["SQ7"] = {"grade": 4 if broken == 0 else (2 if broken == 1 else 0),
                "basis": f"{broken} broken relative link(s)"}

    orphan_n = len(scan["orphans"])
    g["CS3"] = {"grade": 4 if orphan_n == 0 else (2 if orphan_n <= 2 else 0),
                "basis": f"{orphan_n} orphaned file(s): {scan['orphans'][:5]}"}

    wf = scan["workflow_static"]
    if wf:
        meta_bad = sum(1 for w in wf if not w["meta_ok"] or w["phase_title_mismatch"])
        g["WQ1"] = {"grade": 4 if meta_bad == 0 else (2 if meta_bad == 1 else 0),
                    "basis": f"{meta_bad}/{len(wf)} workflow(s) with meta/phase issues"}
        clock = sum(1 for w in wf if w["uses_date_now"] or w["uses_math_random"]
                    or w["uses_new_date"])
        no_coerce = sum(1 for w in wf if not w["has_args_coercion"])
        if clock:
            wq2, basis = 0, f"{clock} workflow(s) use Date.now/Math.random/new Date (breaks resume)"
        elif no_coerce:
            wq2, basis = 2, f"{no_coerce} workflow(s) without defensive args coercion"
        else:
            wq2, basis = 4, "all workflows coerce args and avoid clock/random"
        g["WQ2"] = {"grade": wq2, "basis": basis}

    lint = scan["lint"]
    viol = len(lint["absolute_paths"]) + len(lint["parent_escapes"])
    g["AN2"] = {"grade": 4 if viol == 0 else 0,
                "basis": f"{len(lint['absolute_paths'])} absolute path(s), "
                         f"{len(lint['parent_escapes'])} parent escape(s)"}

    an5_issues = len(lint["cruft"]) + (1 if scan["components"]["root_claude_md"] else 0) \
        + (1 if lint["own_marketplace_json"] else 0)
    g["AN5"] = {"grade": 4 if an5_issues == 0 else (2 if an5_issues == 1 else 0),
                "basis": f"cruft={lint['cruft']}, root CLAUDE.md="
                         f"{scan['components']['root_claude_md']} (never loaded), "
                         f"own marketplace.json={lint['own_marketplace_json']}"}

    passive = scan["context_footprint"]["passive_tokens_est"]
    g["CF1"] = {"grade": band_grade(passive, PASSIVE_TOKEN_BANDS),
                "basis": f"~{passive} est passive tokens ({EST_NOTE})"}

    caps = len(scan["context_footprint"]["cap_violations"])
    g["CF2"] = {"grade": 4 if caps == 0 else 1,
                "basis": f"{caps} skill(s) over the {DESCRIPTION_CAP}-char combined cap"}

    over = [o for o in scan["context_footprint"]["on_invoke"] if o["over_500_lines"]]
    g["CF4"] = {"grade": 4 if not over else (2 if len(over) == 1 else 0),
                "basis": f"{len(over)} SKILL.md bodies over {BODY_LINE_GUIDANCE} lines: "
                         f"{[o['skill'] for o in over][:3]}"}

    man = scan["manifest"]
    if not man.get("parse_ok"):
        g["MH1"] = {"grade": 0, "basis": "plugin.json missing or unparseable"}
    else:
        deductions = len(man["missing_fields"]) \
            + (0 if man["version_semver_ok"] else 1) \
            + (0 if man["name_matches_dir"] else 1) \
            + (0 if man["author_ok"] else 1)
        g["MH1"] = {"grade": max(4 - deductions, 0),
                    "basis": f"missing={man['missing_fields']}, "
                             f"semver={man['version_semver_ok']}, "
                             f"name==dir={man['name_matches_dir']}, "
                             f"author={man['author_ok']}"}

    rd = scan["readme"]
    if not rd.get("present"):
        g["MH3"] = {"grade": 0, "basis": "no README.md"}
    elif rd["has_changelog_heading"] and rd["changelog_matches_manifest"]:
        g["MH3"] = {"grade": 4, "basis": f"changelog top {rd['changelog_top_version']} == manifest"}
    elif rd["has_changelog_heading"]:
        g["MH3"] = {"grade": 2, "basis": f"changelog present but top entry "
                                         f"({rd['changelog_top_version']}) != manifest "
                                         f"({man.get('version')})"}
    else:
        g["MH3"] = {"grade": 0, "basis": "no Changelog heading in README"}

    return g


def compute_na(scan):
    na_dims, na_checks = [], []
    if not scan["workflow_static"]:
        na_dims.append("WQ")
    if not scan["hooks"].get("present"):
        na_checks += ["CS1", "CF5"]
    c = scan["components"]
    if not (c["commands"] or c["agents"] or c["mcp"]):
        na_checks.append("CS4")
    return {"dimensions": na_dims, "checks": na_checks}


def compute_gates(scan):
    gates = []
    if not scan["manifest"].get("parse_ok"):
        gates.append({"id": "manifest", "cap": "rework",
                      "reason": "plugin.json missing or unparseable — the plugin cannot be versioned or safely installed"})
    lint = scan["lint"]
    if lint["absolute_paths"] or lint["parent_escapes"]:
        gates.append({"id": "abs-path", "cap": "rework",
                      "reason": "shipped absolute machine paths or parent-dir escapes break cached installs"})
    return gates


# ---------------------------------------------------------------------------
# Scan driver
# ---------------------------------------------------------------------------

def run_scan(root):
    root = os.path.abspath(root)
    all_files = sorted(walk_files(root))
    skill_paths = find_skill_files(root)
    skills = [scan_skill(root, p) for p in skill_paths]
    workflows = [scan_workflow(root, p) for p in all_files
                 if p.endswith(".js") and "workflows" in rel(root, p).split(os.sep)]
    manifest = scan_manifest(root)
    components = scan_components(root, skills, workflows)
    agents_passive = scan_agents_passive(root)
    scan = {
        "plugin_path": root,
        "manifest": manifest,
        "components": components,
        "skills": skills,
        "agents_passive": agents_passive,
        "context_footprint": build_footprint(skills, agents_passive, components),
        "hooks": scan_hooks(root),
        "workflow_static": workflows,
        "lint": scan_lint(root, all_files),
        "tree": scan_tree(root, all_files),
        "readme": scan_readme(root, manifest.get("version")),
        "orphans": scan_orphans(root, skills, all_files),
    }
    scan["na"] = compute_na(scan)
    na_dims, na_checks = set(scan["na"]["dimensions"]), set(scan["na"]["checks"])
    scan["applicable_judgment_checks"] = sorted(
        cid for cid, (dim, kind, _, _) in CHECKS.items()
        if kind == "j" and dim not in na_dims and cid not in na_checks)
    scan["per_skill_checks"] = sorted(PER_SKILL_CHECKS)
    scan["mechanical_grades"] = mechanical_grades(scan)
    scan["gates"] = compute_gates(scan)
    return scan


# ---------------------------------------------------------------------------
# Score mode
# ---------------------------------------------------------------------------

def tier_for(composite):
    for floor, name in VERDICT_TIERS:
        if composite >= floor:
            return name
    return "avoid"


def worst_tier(a, b):
    return a if TIER_ORDER.index(a) >= TIER_ORDER.index(b) else b


def run_score(scan, grades_doc):
    na_dims = set(scan["na"]["dimensions"])
    na_checks = set(scan["na"]["checks"])
    mech = scan["mechanical_grades"]

    # collect judgment grades; per-skill checks may have several entries
    judgment = {}
    for entry in grades_doc.get("grades", []):
        cid = entry.get("check")
        if cid not in CHECKS:
            raise SystemExit(f"error: unknown check id in grades.json: {cid}")
        grade = entry.get("grade")
        if not isinstance(grade, (int, float)) or not 0 <= grade <= 4:
            raise SystemExit(f"error: grade for {cid} must be a number 0-4, got {grade!r}")
        judgment.setdefault(cid, []).append(entry)

    applicable_j = [cid for cid, (dim, kind, _, _) in CHECKS.items()
                    if kind == "j" and dim not in na_dims and cid not in na_checks]
    missing = sorted(cid for cid in applicable_j if cid not in judgment)
    if missing:
        raise SystemExit(
            "error: grades.json is missing grades for applicable judgment checks: "
            + ", ".join(missing)
            + " — grade every applicable check (see references/rubric.md) and re-run")

    dims_out = []
    dim_scores = {}
    for dim, dmeta in DIMENSIONS.items():
        applicable = dim not in na_dims
        checks_out = []
        num = den = 0.0
        for cid, (cdim, kind, weight, label) in CHECKS.items():
            if cdim != dim:
                continue
            if cid in na_checks or not applicable:
                checks_out.append({"id": cid, "label": label, "kind": kind,
                                   "weight": weight, "na": True})
                continue
            if kind == "m":
                if cid not in mech:  # e.g. WQ mechanical when no workflows (dim N/A anyway)
                    checks_out.append({"id": cid, "label": label, "kind": kind,
                                       "weight": weight, "na": True})
                    continue
                grade = mech[cid]["grade"]
                evidence = mech[cid]["basis"]
            else:
                entries = judgment[cid]
                grade = sum(e["grade"] for e in entries) / len(entries)
                evidence = "; ".join(
                    (f"[{e.get('skill')}] " if e.get("skill") else "") + str(e.get("evidence", ""))
                    for e in entries)[:600]
            points = grade * 25
            num += points * weight
            den += weight
            checks_out.append({"id": cid, "label": label, "kind": kind,
                               "weight": weight, "grade": round(grade, 2),
                               "points": round(points, 1), "evidence": evidence})
        score = round(num / den, 1) if den else None
        dims_out.append({"id": dim, "label": dmeta["label"], "weight": dmeta["weight"],
                         "applicable": applicable, "score": score, "checks": checks_out})
        if applicable and score is not None:
            dim_scores[dim] = score

    total_w = sum(DIMENSIONS[d]["weight"] for d in dim_scores)
    for d in dims_out:
        d["norm_weight"] = round(DIMENSIONS[d["id"]]["weight"] / total_w * 100, 1) \
            if d["applicable"] else 0.0
    composite = round(sum(dim_scores[d] * DIMENSIONS[d]["weight"] for d in dim_scores)
                      / total_w, 1)

    verdict = tier_for(composite)
    capped_by = None
    gates = list(scan["gates"])
    for f in grades_doc.get("findings", []):
        if f.get("gate") == "injection-autoloaded":
            gates.append({"id": "injection-autoloaded", "cap": "avoid",
                          "reason": "prompt-injection content in an auto-loaded surface: " + f.get("title", "")})
        elif f.get("gate") == "injection":
            gates.append({"id": "injection", "cap": "rework",
                          "reason": "prompt-injection content in an on-invoke surface: " + f.get("title", "")})
        elif f.get("severity") == "critical":
            gates.append({"id": "critical-finding", "cap": "rework",
                          "reason": "critical finding: " + f.get("title", "")})
    for gate in gates:
        capped = worst_tier(verdict, gate["cap"])
        if capped != verdict:
            verdict, capped_by = capped, gate
        elif verdict == gate["cap"] and capped_by is None and tier_for(composite) != verdict:
            capped_by = gate

    return {
        "dimensions": dims_out,
        "composite": composite,
        # pre-computed for the scorecard donut (r=54, circumference 339.292)
        # so the report filler never does arithmetic
        "composite_dash": round(composite / 100 * 339.292, 3),
        "verdict": verdict,
        "verdict_uncapped": tier_for(composite),
        "verdict_capped_by": capped_by,
        "gates": gates,
        "na": scan["na"],
        "findings": grades_doc.get("findings", []),
        "note": EST_NOTE,
    }


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("plugin_path", help="path to the plugin directory")
    ap.add_argument("--score", metavar="GRADES_JSON",
                    help="grades file from the grading step; emits the composite score")
    args = ap.parse_args()

    if not os.path.isdir(args.plugin_path):
        raise SystemExit(f"error: not a directory: {args.plugin_path}")
    scan = run_scan(args.plugin_path)

    if args.score:
        try:
            with open(args.score, encoding="utf-8") as fh:
                grades_doc = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            raise SystemExit(f"error: cannot read grades file {args.score}: {e}")
        print(json.dumps(run_score(scan, grades_doc), indent=1))
    else:
        print(json.dumps(scan, indent=1))


if __name__ == "__main__":
    main()
