#!/bin/bash
# SessionStart hook: brief every new session on the team workflow rules
# (agentic-teamwork). Config-driven; no-op unless the repo opted in.
set -uo pipefail

# Fast no-op unless this repo opted in (no jq on this path).
ROOT_GUESS="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -f "${ROOT_GUESS}/.claude/teamwork.json" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

if ! command -v jq >/dev/null 2>&1; then
    echo "agentic-teamwork: this repo has .claude/teamwork.json but jq is not installed, so the git guards CANNOT run (they fail open). Install jq (apt install jq / brew install jq) to restore enforcement."
    exit 0
fi

ROOT=$(tw_repo_root)
BRANCH=$(git -C "${ROOT:-.}" symbolic-ref --short -q HEAD 2>/dev/null || echo "detached")
REMOTE=$(tw_cfg '.remote' 'origin')
BASE=$(tw_cfg '.baseBranch' 'main')
PR_NOUN=$(tw_pr_noun)
PR_CREATE=$(tw_pr_create_cmd)
CI_NAME=$(tw_ci_name)
PREFIXES=$(tw_cfg_list '.branchPrefixes' | paste -sd' ' -)
[ -n "$PREFIXES" ] || PREFIXES="feature/ fix/ chore/"
FIRST_PREFIX="${PREFIXES%% *}"
TEST_CMD=$(tw_cfg '.test.command' '')
[ -n "$TEST_CMD" ] || TEST_CMD=$(tw_cfg '.build.command' '')

echo "Teamwork session briefing:"
echo "- Current branch: $BRANCH"
if tw_is_protected "$BRANCH"; then
    echo "- **You are on $BRANCH. Before making ANY changes, create a branch off an up-to-date $BASE: git pull, then git switch -c ${FIRST_PREFIX}<topic> (prefixes: $PREFIXES). Commits and pushes on $BRANCH are blocked by hooks; changes land only through ${PR_NOUN}s ($PR_CREATE).**"
else
    # Stale-base warning: a branch cut from an old base and never synced is how
    # PRs/MRs end up missing shared changes and conflicting at merge time.
    # Compared against the last-fetched remote base (no network here), so the
    # fix is always "fetch first, then merge".
    if [ -n "${ROOT:-}" ] && git -C "$ROOT" rev-parse --verify -q "$REMOTE/$BASE" >/dev/null 2>&1; then
        BEHIND=$(git -C "$ROOT" rev-list --count "HEAD..$REMOTE/$BASE" 2>/dev/null || echo 0)
        if [ "${BEHIND:-0}" -gt 0 ]; then
            echo "- **This branch is $BEHIND commit(s) behind $REMOTE/$BASE (as last fetched). Sync before building on it: git fetch $REMOTE && git merge $REMOTE/$BASE (or rebase your un-pushed work). A stale base is how a branch silently loses shared changes and hits merge conflicts.**"
        fi
    fi
fi
if [ -n "$TEST_CMD" ]; then
    echo "- Tests: $TEST_CMD — must pass before every commit (hook-enforced) and re-run by $CI_NAME on every $PR_NOUN."
fi

HOOKS_PATH=$(git -C "${ROOT:-.}" config core.hooksPath 2>/dev/null || echo "")
if [ "$HOOKS_PATH" != ".githooks" ]; then
    echo "- Warning: core.hooksPath is not set to .githooks in this clone, so terminal commits skip the team pre-commit checks. Fix: git config core.hooksPath .githooks (or run /teamwork-audit)."
fi
MIRROR="$ROOT/.githooks/lib-guard.sh"
if [ -f "$MIRROR" ]; then
    MIRROR_VERSION=$(sed -n 's/^TW_LIB_VERSION="\(.*\)"$/\1/p' "$MIRROR" | head -n1)
    if [ "$MIRROR_VERSION" != "$TW_LIB_VERSION" ]; then
        echo "- Warning: .githooks/lib-guard.sh is version '${MIRROR_VERSION:-unknown}' but the plugin library is '$TW_LIB_VERSION' — the terminal mirror has drifted. Run /teamwork-audit to refresh it."
    fi
fi
echo "- Read .claude/rules/team-workflow.md before committing — it is the per-change checklist behind these guards."
exit 0
