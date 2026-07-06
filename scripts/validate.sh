#!/usr/bin/env bash
# validate.sh — structural checks for the agentic-engineering marketplace.
# Requires: bash, jq, find, grep. CI runs it on every push/PR.
# Every rule here is stated in .claude/rules/dev-rules.md — change both together.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKET="$ROOT/.claude-plugin/marketplace.json"
FAIL=0

pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAIL=1; }

command -v jq >/dev/null 2>&1 || { echo "FAIL jq is required"; exit 1; }

# 1. marketplace.json parses with the required top-level shape
if jq -e '.name and .owner.name and (.plugins | type == "array" and length > 0)' \
     "$MARKET" >/dev/null 2>&1; then
  pass "marketplace.json parses with name/owner/plugins"
else
  fail "marketplace.json missing/invalid (name, owner.name, plugins[])"
fi

# 2–5. per-entry checks + orphan check
declare -A CATALOGUED
ENTRY_FAIL=0
while IFS=$'\t' read -r name src srctype hasver; do
  [ -n "$name" ] || { fail "entry with no name"; ENTRY_FAIL=1; continue; }
  if [ "$hasver" = "true" ]; then
    fail "entry $name carries a version key (version lives ONLY in plugin.json)"; ENTRY_FAIL=1
  fi
  if [ "$srctype" = "string" ]; then
    case "$src" in
      ./*) : ;;
      *) fail "entry $name: relative source must start with ./"; ENTRY_FAIL=1; continue ;;
    esac
    dir="$ROOT/${src#./}"
    base="$(basename "$dir")"
    CATALOGUED["$base"]=1
    pj="$dir/.claude-plugin/plugin.json"
    if [ ! -d "$dir" ];  then fail "entry $name: $src does not exist"; ENTRY_FAIL=1; continue; fi
    if [ ! -f "$pj" ];   then fail "entry $name: missing .claude-plugin/plugin.json"; ENTRY_FAIL=1; continue; fi
    if [ ! -f "$dir/README.md" ]; then fail "entry $name: missing README.md"; ENTRY_FAIL=1; fi
    if [ -f "$dir/.claude-plugin/marketplace.json" ]; then
      fail "entry $name: plugin carries its own marketplace.json (only the root catalog exists)"; ENTRY_FAIL=1
    fi
    if ! jq -e '.name and .version and .description' "$pj" >/dev/null 2>&1; then
      fail "entry $name: plugin.json invalid or missing name/version/description"; ENTRY_FAIL=1; continue
    fi
    pname="$(jq -r '.name' "$pj")"
    if [ "$name" != "$pname" ] || [ "$name" != "$base" ]; then
      fail "entry $name: name mismatch (plugin.json=$pname dir=$base)"; ENTRY_FAIL=1
    fi
  elif [ "$srctype" = "object" ]; then
    kind="$(jq -r --arg n "$name" '.plugins[] | select(.name==$n) | .source.source' "$MARKET")"
    case "$kind" in
      github|git) : ;;
      *) fail "entry $name: unknown object source kind '$kind'"; ENTRY_FAIL=1 ;;
    esac
  fi
done < <(jq -r '.plugins[] | [.name, (if (.source|type)=="string" then .source else "" end), (.source|type), (has("version")|tostring)] | @tsv' "$MARKET" 2>/dev/null)

for d in "$ROOT"/plugins/*/; do
  [ -d "$d" ] || continue
  base="$(basename "$d")"
  if [ -z "${CATALOGUED[$base]:-}" ]; then
    fail "plugins/$base exists but has no marketplace.json entry"; ENTRY_FAIL=1
  fi
done
[ "$ENTRY_FAIL" -eq 0 ] && pass "entries: source dirs, manifests, name agreement, no versions, no orphans"

# 6. junk files
JUNK=$(find "$ROOT" -path "$ROOT/.git" -prune -o \( -name .DS_Store -o -name node_modules -o -name __pycache__ \) -print 2>/dev/null | head -5)
if [ -z "$JUNK" ]; then
  pass "no .DS_Store / node_modules / __pycache__ in the tree"
else
  fail "junk present:"$'\n'"$JUNK"
fi

# 7. absolute machine paths in plugin content (vendored app/ trees exempt)
ABS=$(grep -rEl '(/fast/|/Users/|/home/[a-z])' "$ROOT/plugins" \
        --include='*.md' --include='*.sh' --include='*.js' --include='*.json' 2>/dev/null \
      | grep -v '/app/' | head -5)
if [ -z "$ABS" ]; then
  pass "no absolute machine paths in plugin content"
else
  fail "absolute paths found in:"$'\n'"$ABS"
fi

# 8. shell scripts parse
SH_BAD=""
while IFS= read -r f; do
  bash -n "$f" 2>/dev/null || SH_BAD="$SH_BAD $f"
done < <(find "$ROOT/plugins" "$ROOT/scripts" -name '*.sh' -not -path '*/node_modules/*' 2>/dev/null)
if [ -z "$SH_BAD" ]; then
  pass "all shell scripts pass bash -n"
else
  fail "bash -n failures:$SH_BAD"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "validate: all green"
else
  echo "validate: FAILURES above"
fi
exit "$FAIL"
