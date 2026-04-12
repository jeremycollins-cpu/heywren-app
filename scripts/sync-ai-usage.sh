#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# sync-ai-usage.sh
#
# Reads Claude Code session data from ~/.claude/ and syncs it to
# the HeyWren AI Usage API. Designed to be run:
#   1. Manually:  bash scripts/sync-ai-usage.sh
#   2. As a Claude Code post-session hook
#   3. As a cron job
#
# Required env vars:
#   HEYWREN_API_URL  — Your HeyWren instance URL (e.g. https://app.heywren.com)
#   HEYWREN_API_KEY  — Your HeyWren API key or session token
#
# Dependencies: jq, curl
# ────────────────────────────────────────────────────────────────

set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SESSIONS_DIR="$CLAUDE_DIR/sessions"
PROJECTS_DIR="$CLAUDE_DIR/projects"
SYNC_STATE_FILE="$CLAUDE_DIR/.heywren-sync-state"

API_URL="${HEYWREN_API_URL:-}"
API_KEY="${HEYWREN_API_KEY:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[heywren-sync]${NC} $*"; }
warn() { echo -e "${YELLOW}[heywren-sync]${NC} $*"; }
err()  { echo -e "${RED}[heywren-sync]${NC} $*" >&2; }

# ── Preflight checks ────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  err "jq is required but not installed. Install it: brew install jq / apt install jq"
  exit 1
fi

if [[ -z "$API_URL" ]]; then
  err "HEYWREN_API_URL is not set. Export it before running this script."
  err "  export HEYWREN_API_URL=https://app.heywren.com"
  exit 1
fi

if [[ -z "$API_KEY" ]]; then
  err "HEYWREN_API_KEY is not set. Export it before running this script."
  err "  export HEYWREN_API_KEY=your-api-key"
  exit 1
fi

if [[ ! -d "$SESSIONS_DIR" ]]; then
  warn "No Claude Code sessions directory found at $SESSIONS_DIR"
  exit 0
fi

# ── Load last sync timestamp ────────────────────────────────────

LAST_SYNC=0
if [[ -f "$SYNC_STATE_FILE" ]]; then
  LAST_SYNC=$(cat "$SYNC_STATE_FILE" 2>/dev/null || echo 0)
fi

log "Looking for sessions newer than $(date -d "@$((LAST_SYNC / 1000))" 2>/dev/null || date -r "$((LAST_SYNC / 1000))" 2>/dev/null || echo "epoch")..."

# ── Collect session data ─────────────────────────────────────────

SESSIONS_JSON="[]"
SESSION_COUNT=0

for session_file in "$SESSIONS_DIR"/*.json; do
  [[ -f "$session_file" ]] || continue

  # Parse session metadata
  session_data=$(cat "$session_file")
  session_id=$(echo "$session_data" | jq -r '.sessionId // empty')
  started_at_ms=$(echo "$session_data" | jq -r '.startedAt // 0')
  cwd=$(echo "$session_data" | jq -r '.cwd // empty')
  entrypoint=$(echo "$session_data" | jq -r '.entrypoint // "cli"')

  [[ -z "$session_id" ]] && continue

  # Skip if older than last sync
  if [[ "$started_at_ms" -le "$LAST_SYNC" ]]; then
    continue
  fi

  # Convert ms timestamp to ISO
  started_at_sec=$((started_at_ms / 1000))
  started_at=$(date -u -d "@$started_at_sec" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
               date -u -r "$started_at_sec" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
  [[ -z "$started_at" ]] && continue

  # Find the matching JSONL conversation file to count messages and tool calls
  messages_count=0
  tool_calls_count=0
  last_timestamp=""

  # Search project directories for the session JSONL
  for project_dir in "$PROJECTS_DIR"/*/; do
    jsonl_file="${project_dir}${session_id}.jsonl"
    if [[ -f "$jsonl_file" ]]; then
      messages_count=$(grep -c '"type":"user"' "$jsonl_file" 2>/dev/null || echo 0)
      tool_calls_count=$(grep -c '"type":"tool_' "$jsonl_file" 2>/dev/null || echo 0)
      # Get the last timestamp for ended_at
      last_timestamp=$(tail -1 "$jsonl_file" 2>/dev/null | jq -r '.timestamp // empty' 2>/dev/null || echo "")
      break
    fi
  done

  # Build ended_at from last message timestamp
  ended_at="null"
  if [[ -n "$last_timestamp" && "$last_timestamp" != "null" ]]; then
    ended_at="\"$last_timestamp\""
  fi

  # Build session JSON
  session_json=$(jq -n \
    --arg sid "$session_id" \
    --arg started "$started_at" \
    --argjson ended "$ended_at" \
    --arg ep "$entrypoint" \
    --arg proj "$cwd" \
    --argjson msgs "$messages_count" \
    --argjson tools "$tool_calls_count" \
    '{
      session_id: $sid,
      tool: "claude_code",
      started_at: $started,
      ended_at: $ended,
      entrypoint: $ep,
      project_path: $proj,
      messages_count: $msgs,
      tool_calls_count: $tools,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_cents: 0
    }')

  SESSIONS_JSON=$(echo "$SESSIONS_JSON" | jq --argjson s "$session_json" '. + [$s]')
  SESSION_COUNT=$((SESSION_COUNT + 1))
done

if [[ "$SESSION_COUNT" -eq 0 ]]; then
  log "No new sessions to sync."
  exit 0
fi

log "Found $SESSION_COUNT new session(s) to sync."

# ── Send to API ──────────────────────────────────────────────────

PAYLOAD=$(jq -n --argjson sessions "$SESSIONS_JSON" '{ sessions: $sessions }')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_URL}/api/ai-usage" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  SYNCED=$(echo "$BODY" | jq -r '.synced // 0')
  log "Successfully synced $SYNCED session(s)."

  # Update sync state
  CURRENT_MS=$(date +%s)000
  echo "$CURRENT_MS" > "$SYNC_STATE_FILE"
else
  err "Sync failed (HTTP $HTTP_CODE): $BODY"
  exit 1
fi
