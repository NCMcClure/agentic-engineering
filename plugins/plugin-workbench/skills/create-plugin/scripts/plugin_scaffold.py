#!/usr/bin/env python3
"""Deterministic plugin scaffolder for the create-plugin skill.

Reads a confirmed spec (JSON) and emits a complete, installable plugin
skeleton from the stubs in ../assets/stubs/: plugin-json.stub,
readme.stub, skill-md.stub, workflow-js.stub, script-py.stub. The model
never types boilerplate; it authors into the TODO(author) markers the
stubs leave behind.

Usage:
    plugin_scaffold.py <target-dir> --spec <spec.json> [--force]

Spec shape:
    {
      "name": "<must equal basename of target-dir>",
      "description": "<one-sentence pitch>",
      "author": {"name": "...", "email": "..."},
      "version": "0.1.0",              # optional, default 0.1.0, semver
      "displayName": "...",            # optional, derived from name
      "keywords": ["..."],             # optional
      "skills": [
        {"name": "<skill-slug>",
         "mode": "model" | "user",     # user => disable-model-invocation
         "argumentHint": "...",        # optional
         "withWorkflow": false,        # optional: workflows/<name>.js stub
         "withScripts": false,         # optional: scripts/<name>.py stub
         "withReferences": false}      # optional: references/ dir + notes.md
      ],
      "install": "<install command block for the README>"   # optional
    }

Behavior: refuses to overwrite any existing file that no longer contains a
TODO(author) marker unless --force; never creates empty directories; prints
a JSON summary of created/skipped files; exits non-zero with a reason on any
failure.
"""

import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True

STUBS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "assets", "stubs")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TODO_MARK = "TODO(author)"


def die(msg):
    print(json.dumps({"ok": False, "error": msg}))
    return 1


def read_stub(name):
    path = os.path.join(STUBS, name)
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def fill(template, mapping):
    out = template
    for key, value in mapping.items():
        out = out.replace("{{" + key + "}}", value)
    return out


def plan_files(target, spec):
    """Return [(relpath, content)] for the whole skeleton."""
    name = spec["name"]
    version = spec.get("version", "0.1.0")
    display = spec.get("displayName") or name.replace("-", " ").title()
    keywords = spec.get("keywords") or [name]
    install = spec.get("install") or (
        "/plugin marketplace add <path-or-repo>\n"
        f"/plugin install {name}@<marketplace-name>"
    )

    files = []
    files.append((os.path.join(".claude-plugin", "plugin.json"), fill(
        read_stub("plugin-json.stub"), {
            "NAME": name,
            "DISPLAY_NAME": display,
            "VERSION": version,
            "DESCRIPTION": spec["description"],
            "AUTHOR_NAME": spec["author"]["name"],
            "AUTHOR_EMAIL": spec["author"]["email"],
            "KEYWORDS": json.dumps(keywords),
        })))

    skill_rows = []
    for skill in spec["skills"]:
        s_name = skill["name"]
        mode = skill.get("mode", "model")
        hint = skill.get("argumentHint", "")
        mode_line = ("disable-model-invocation: true\n"
                     if mode == "user" else "")
        mode_note = (
            " — loads only when invoked, so spend words on the contract, "
            "not triggers." if mode == "user" else
            " AND when to trigger it. This sits in context every turn "
            "and must earn it.")
        hint_line = (f'argument-hint: "{hint}"\n' if hint else "")
        files.append((os.path.join("skills", s_name, "SKILL.md"), fill(
            read_stub("skill-md.stub"), {
                "SKILL_NAME": s_name,
                "MODE_LINE": mode_line,
                "MODE_NOTE": mode_note,
                "ARGUMENT_HINT_LINE": hint_line,
            })))
        if skill.get("withWorkflow"):
            files.append((
                os.path.join("skills", s_name, "workflows", f"{s_name}.js"),
                fill(read_stub("workflow-js.stub"),
                     {"WORKFLOW_NAME": s_name})))
        if skill.get("withScripts"):
            files.append((
                os.path.join("skills", s_name, "scripts",
                             f"{s_name.replace('-', '_')}.py"),
                fill(read_stub("script-py.stub"), {"SKILL_NAME": s_name})))
        if skill.get("withReferences"):
            files.append((
                os.path.join("skills", s_name, "references", "notes.md"),
                f"# {s_name} notes\n\n{TODO_MARK}: move detail here when "
                "SKILL.md outgrows a quick read; SKILL.md must link this "
                "file by name.\n"))
        invocation = (f"`/{name}:{s_name}{' ' + hint if hint else ''}`"
                      if mode == "user" else "model-invoked")
        skill_rows.append(
            f"| `{s_name}` | {invocation} | {TODO_MARK} |")

    files.append(("README.md", fill(read_stub("readme.stub"), {
        "NAME": name,
        "VERSION": version,
        "INSTALL_BLOCK": install,
        "SKILL_ROWS": "\n".join(skill_rows),
    })))
    return files


def main():
    parser = argparse.ArgumentParser(
        description="Scaffold a Claude Code plugin from a spec")
    parser.add_argument("target", help="plugin directory to create")
    parser.add_argument("--spec", required=True, help="spec JSON path")
    parser.add_argument("--force", action="store_true",
                        help="overwrite files that lost their "
                             "TODO(author) markers")
    args = parser.parse_args()

    try:
        with open(args.spec, encoding="utf-8") as fh:
            spec = json.load(fh)
    except (OSError, ValueError) as exc:
        return die(f"spec unreadable: {exc}")

    for key in ("name", "description", "author", "skills"):
        if not spec.get(key):
            return die(f"spec missing required key: {key}")
    if not isinstance(spec["author"], dict) or \
            not spec["author"].get("name") or not spec["author"].get("email"):
        return die("spec.author needs name and email")
    if not spec["skills"]:
        return die("spec.skills must list at least one skill")

    target = os.path.abspath(args.target.rstrip("/"))
    name = spec["name"]
    if not SLUG.match(name):
        return die(f"name {name!r} is not a lowercase-hyphen slug")
    if os.path.basename(target) != name:
        return die(f"spec name {name!r} != target dir basename "
                   f"{os.path.basename(target)!r}")
    version = spec.get("version", "0.1.0")
    if not SEMVER.match(version):
        return die(f"version {version!r} is not semver")
    for skill in spec["skills"]:
        if not SLUG.match(skill.get("name", "")):
            return die(f"skill name {skill.get('name')!r} is not a "
                       "lowercase-hyphen slug")
        if skill.get("mode", "model") not in ("model", "user"):
            return die(f"skill {skill['name']}: mode must be model or user")

    created, skipped = [], []
    for relpath, content in plan_files(target, spec):
        path = os.path.join(target, relpath)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                current = fh.read()
            if TODO_MARK not in current and not args.force:
                skipped.append(relpath)
                continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        created.append(relpath)

    result = {"ok": True, "target": target,
              "created": created, "skipped": skipped}
    if skipped:
        result["note"] = ("skipped files were authored already (no "
                          "TODO(author) marker); pass --force to overwrite")
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
