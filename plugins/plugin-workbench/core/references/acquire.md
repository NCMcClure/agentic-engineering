# Acquiring a target plugin

Shared acquisition contract for the workbench skills. The caller states its
mode: **evaluation** (read-only; the caller deletes temp clones when done) or
**improvement** (edits land in the acquired tree; a clone is the deliverable
and is never deleted).

## Input forms

| Input form | Action |
|---|---|
| existing local path | use as-is; no cleanup later |
| `owner/repo` | `git clone --depth 1 https://github.com/<owner>/<repo>` |
| `https://…` / `git@…` git URL (GitHub, GitLab, any host) | clone as given |
| trailing `#<ref>` | add `--branch <ref>`; if the clone fails because `<ref>` is a commit SHA, re-clone without `--depth` and `git checkout <ref>` |

Clones go in a fresh `mktemp -d` under `${TMPDIR:-/tmp}` using the prefix the
calling skill specifies. If a clone fails (auth, missing repo), report git's
error verbatim and suggest the user clone it themselves and pass the local
path — never prompt for or embed credentials.

## Locating the plugin root

Inside the checkout, the plugin root is: the directory containing
`.claude-plugin/plugin.json`, else the one containing `skills/`, else a bare
skill directory containing `SKILL.md` (treat it as a one-skill plugin —
manifest checks will grade 0, which is honest for distribution readiness). If
the checkout is a **marketplace** (a root `.claude-plugin/marketplace.json`
listing several plugins), list the entries and ask the user which one to work
on.

## Improvement mode

A local path means edits land **in place**: require a clean `git status` in
the target (or the user's explicit go-ahead) and suggest working on a branch
before touching anything. A clone is the deliverable: never delete it, and
state its absolute path in the final report.
