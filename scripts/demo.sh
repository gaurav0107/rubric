#!/usr/bin/env bash
# scripts/demo.sh — end-to-end rubric demo, safe to record.
#
# What this script does (all mock-mode, no API keys needed):
#   1.  rubric init            → fresh workspace under ./.demo/
#   2.  rubric run             → baseline pairwise eval (human format)
#   3.  rubric run --format compact
#                              → one-line summary for grep/awk
#   4.  rubric run --format json > /tmp/rubric-run.json
#                              → structured output for bots
#   5.  rubric runs list       → show the registry
#   6.  rubric run --detach    → spawn a background worker
#      rubric runs wait <id>   → join on it
#
# Intent: a terminalizer/asciinema-friendly replay that shows off v1.2+v1.3
# without needing OpenAI credentials. Paste a cast URL into README after.
#
# Usage:
#   ./scripts/demo.sh          # run interactively
#   ./scripts/demo.sh --replay # omit sleeps (fast for CI smoke test)

set -euo pipefail

REPLAY_MODE=${1:-}
DEMO_DIR="${DEMO_DIR:-.demo}"

# Prefer the repo-local bin so the demo runs against the checkout, not a
# globally installed stale rubric. Callers can override with RUBRIC=/path/to/rubric.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUBRIC="${RUBRIC:-bun $REPO_ROOT/packages/cli/src/bin.ts}"

step() {
  if [[ "$REPLAY_MODE" != "--replay" ]]; then sleep 0.8; fi
  printf '\n\033[1;36m$ %s\033[0m\n' "$*"
  if [[ "$REPLAY_MODE" != "--replay" ]]; then sleep 0.3; fi
}

run() {
  step "$*"
  eval "$*"
}

banner() {
  printf '\n\033[1;33m=== %s ===\033[0m\n' "$1"
  if [[ "$REPLAY_MODE" != "--replay" ]]; then sleep 0.6; fi
}

# Clean slate every run so the demo is idempotent.
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

banner "1. Scaffold a workspace"
run "$RUBRIC init"

banner "2. Baseline: human format (default)"
run "$RUBRIC run --mock"

banner "3. Compact format — one line, grep-friendly"
run "$RUBRIC run --mock --format compact"

banner "4. JSON format — structured, parseable"
run "$RUBRIC run --mock --format json > /tmp/rubric-run.json"
run "cat /tmp/rubric-run.json | head -c 400 && echo ..."

banner "5. Run registry"
run "$RUBRIC runs list --limit 5"

banner "6. Detached worker (async pattern)"
# Kick off a detached run, capture + display the id, then wait on it.
step "$RUBRIC run --mock --detach"
DETACH_OUTPUT=$(eval "$RUBRIC run --mock --detach" 2>&1)
echo "$DETACH_OUTPUT"
RUN_ID=$(echo "$DETACH_OUTPUT" | grep -Eo 'r-[A-Za-z0-9-]+' | head -1 || true)
if [[ -n "$RUN_ID" ]]; then
  run "$RUBRIC runs wait $RUN_ID"
  run "$RUBRIC runs show $RUN_ID"
fi

banner "Done — every run is archived under ~/.rubric/runs"
echo "Replay with: ./scripts/demo.sh --replay (skip sleeps)"
