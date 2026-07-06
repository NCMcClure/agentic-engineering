#!/bin/bash
# Stop hook: backstop verification when Claude finishes a turn
# (agentic-teamwork).
# - BLOCKS the stop if uncommitted source changes exist and the test gate fails.
# - Warns (allows) on docs drift, stray root-level files, and logic changes
#   that ship without test changes.
set -uo pipefail

# Fast no-op unless this repo opted in (no jq on this path).
[ -f "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}/.claude/teamwork.json" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

tw_enabled || exit 0

INPUT=$(cat)
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0 # loop guard: never re-block a hook-driven continuation

ROOT=$(tw_repo_root)
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

dirty=$(git status --porcelain -uall 2>/dev/null | awk '{print $NF}')

SRC_RE=$(tw_cfg_list '.test.sourcePatterns' | paste -sd'|' -)
TEST_CMD=$(tw_cfg '.test.command' '')
[ -n "$TEST_CMD" ] || TEST_CMD=$(tw_cfg '.build.command' '')
[ -n "$TEST_CMD" ] || TEST_CMD="the test gate"

# Hard gate: never end a turn with broken source work in the tree.
if [ -n "$SRC_RE" ] && tw_rule stopGate && tw_rule requireTestsPass &&
    printf '%s\n' "$dirty" | grep -qE "$SRC_RE"; then
    if ! test_out=$(tw_run_tests "$ROOT"); then
        jq -n --arg r "'$TEST_CMD' is failing with uncommitted source changes in the tree:
$test_out

Fix the build/tests before finishing — do not leave the tree broken." \
            '{decision: "block", reason: $r}'
        exit 0
    fi
fi

warnings=()

REMOTE=$(tw_cfg '.remote' 'origin')
BASE=$(tw_cfg '.baseBranch' 'main')

# Changed set for this branch: working tree + commits not on the remote base.
changed=$({
    printf '%s\n' "$dirty"
    git diff --name-only "$REMOTE/$BASE...HEAD" 2>/dev/null
} | grep -v '^$' | sort -u)

# Docs drift: watched files changed but none of the doc files did.
WATCH_RE=$(tw_cfg_list '.docs.watchPatterns' | paste -sd'|' -)
[ -n "$WATCH_RE" ] || WATCH_RE="$SRC_RE"
DOC_FILES=$(tw_cfg_list '.docs.files')
[ -n "$DOC_FILES" ] || DOC_FILES=$'README.md\nCLAUDE.md'
if [ -n "$WATCH_RE" ] && printf '%s\n' "$changed" | grep -qE "$WATCH_RE"; then
    docs_touched=0
    while IFS= read -r doc; do
        [ -n "$doc" ] || continue
        printf '%s\n' "$changed" | grep -qxF "$doc" && docs_touched=1
    done <<<"$DOC_FILES"
    if [ "$docs_touched" = 0 ]; then
        warnings+=("Architecture-relevant files changed on this branch but none of ($(printf '%s' "$DOC_FILES" | tr '\n' ' ' | sed 's/ $//')) was touched — check whether the docs drifted.")
    fi
fi

# Stray root files: scratch files left at the repo root.
stray=$(git ls-files --others --exclude-standard 2>/dev/null | grep -v / || true)
if [ -n "$stray" ]; then
    warnings+=("Untracked files sitting at the repo root: $(printf '%s' "$stray" | tr '\n' ' '). Commit them, add them to .gitignore, or delete them — don't leave scratch files in the repo.")
fi

# Logic without tests: source changed but no test files did.
TEST_RE=$(tw_cfg_list '.test.testPatterns' | paste -sd'|' -)
if [ -n "$SRC_RE" ] && [ -n "$TEST_RE" ] &&
    printf '%s\n' "$changed" | grep -qE "$SRC_RE" &&
    ! printf '%s\n' "$changed" | grep -qE "$TEST_RE"; then
    warnings+=("Source files changed without any test changes — consider adding or updating tests (new logic should ship with tests).")
fi

if [ ${#warnings[@]} -gt 0 ]; then
    msg="Hygiene check:"
    for w in "${warnings[@]}"; do
        msg="$msg
- $w"
    done
    jq -n --arg m "$msg" '{systemMessage: $m}'
fi
exit 0
