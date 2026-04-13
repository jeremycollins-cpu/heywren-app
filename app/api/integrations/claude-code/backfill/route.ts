export const dynamic = 'force-dynamic'

// app/api/integrations/claude-code/backfill/route.ts
// Serves a bash script that walks every ~/.claude/projects/*/*.jsonl,
// parses each session, and POSTs them to /api/ai-usage/sync in batches.
// Safe to re-run: the sync endpoint upserts on (user_id, session_id, tool).
//
// Usage: curl -fsSL "${appUrl}/api/integrations/claude-code/backfill?token=xxx" | bash

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

  if (!token) {
    return new NextResponse(
      'echo "Error: No token provided. Get the backfill command from HeyWren Integrations page."',
      { headers: { 'Content-Type': 'text/plain' } }
    )
  }

  const script = `#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# HeyWren Claude Code Backfill
# Scans every session JSONL under ~/.claude/projects/ and syncs it.
# Safe to re-run — existing sessions are upserted (not duplicated).
# ────────────────────────────────────────────────────────────────

set -uo pipefail

GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
RED='\\033[0;31m'
NC='\\033[0m'

log()  { echo -e "\${GREEN}[heywren-backfill]\${NC} $*"; }
warn() { echo -e "\${YELLOW}[heywren-backfill]\${NC} $*"; }
err()  { echo -e "\${RED}[heywren-backfill]\${NC} $*" >&2; }

HEYWREN_TOKEN="${token}"
HEYWREN_API="${appUrl}/api/ai-usage/sync"
CLAUDE_DIR="\${HOME}/.claude"
PROJECTS_DIR="\${CLAUDE_DIR}/projects"
BATCH_SIZE=50

if ! command -v python3 &>/dev/null; then
  err "python3 is required but not installed."
  exit 1
fi

if [[ ! -d "\${PROJECTS_DIR}" ]]; then
  warn "No projects directory at \${PROJECTS_DIR}. Nothing to backfill."
  exit 0
fi

JSONL_COUNT=\$(find "\${PROJECTS_DIR}" -name '*.jsonl' -type f 2>/dev/null | wc -l | tr -d ' ')

if [[ "\${JSONL_COUNT}" -eq 0 ]]; then
  warn "No session JSONL files found. Nothing to backfill."
  exit 0
fi

log "Found \${JSONL_COUNT} session file(s). Parsing..."

# ── Parse all sessions in one Python pass, emitting NDJSON (one session per line) ──
TMP_NDJSON=\$(mktemp -t heywren-backfill-XXXXXX)
trap 'rm -f "\${TMP_NDJSON}" "\${TMP_NDJSON}".batch' EXIT

PROJECTS_DIR="\${PROJECTS_DIR}" OUTPUT_FILE="\${TMP_NDJSON}" python3 << 'PYEOF'
import json, os, glob

projects_dir = os.environ["PROJECTS_DIR"]
output_file = os.environ["OUTPUT_FILE"]

def parse_jsonl(path, project_name):
    first_ts = ""
    last_ts = ""
    messages = 0
    tool_calls = 0
    model = ""
    git_branch = ""
    try:
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = obj.get("timestamp", "")
                if ts:
                    if not first_ts:
                        first_ts = ts
                    last_ts = ts
                t = obj.get("type", "")
                if t == "user" and not obj.get("isMeta"):
                    messages += 1
                elif t == "assistant":
                    m = obj.get("message", {})
                    if isinstance(m, dict) and m.get("model"):
                        model = m["model"]
                    content = m.get("content", []) if isinstance(m, dict) else []
                    if isinstance(content, list):
                        tool_calls += sum(
                            1 for c in content
                            if isinstance(c, dict) and c.get("type") == "tool_use"
                        )
                b = obj.get("gitBranch", "")
                if b:
                    git_branch = b
    except Exception:
        return None
    if not first_ts:
        return None
    cwd_decoded = project_name.lstrip("-")
    cwd_decoded = "/" + cwd_decoded.replace("-", "/") if cwd_decoded else ""
    return {
        "session_id": os.path.splitext(os.path.basename(path))[0],
        "tool": "claude_code",
        "started_at": first_ts,
        "ended_at": last_ts or None,
        "entrypoint": "cli",
        "project_path": cwd_decoded or None,
        "messages_count": messages,
        "tool_calls_count": tool_calls,
        "model": model or None,
        "input_tokens": 0,
        "output_tokens": 0,
        "estimated_cost_cents": 0,
        "metadata": {
            "git_branch": git_branch or None,
            "sync_source": "backfill",
        },
    }

count = 0
skipped = 0
with open(output_file, "w") as out:
    for project_path in sorted(glob.glob(os.path.join(projects_dir, "*"))):
        if not os.path.isdir(project_path):
            continue
        project_name = os.path.basename(project_path)
        for jsonl in sorted(glob.glob(os.path.join(project_path, "*.jsonl"))):
            session = parse_jsonl(jsonl, project_name)
            if session is None:
                skipped += 1
                continue
            out.write(json.dumps(session) + "\\n")
            count += 1
PYEOF

PARSED_COUNT=\$(wc -l < "\${TMP_NDJSON}" | tr -d ' ')

if [[ "\${PARSED_COUNT}" -eq 0 ]]; then
  warn "No parseable sessions found (files may be empty or missing timestamps)."
  exit 0
fi

log "Parsed \${PARSED_COUNT} session(s). Posting in batches of \${BATCH_SIZE}..."

# ── POST in batches ─────────────────────────────────────────────
TOTAL_SYNCED=0
TOTAL_FAILED=0
BATCH_NUM=0
BATCH_FILE="\${TMP_NDJSON}.batch"

post_batch() {
  local batch_json="$1"
  RESPONSE_FILE=\$(mktemp -t heywren-backfill-resp-XXXXXX)
  HTTP_STATUS=\$(curl -s -o "\${RESPONSE_FILE}" -w "%{http_code}" \\
    -X POST "\${HEYWREN_API}" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer \${HEYWREN_TOKEN}" \\
    -d "\${batch_json}" \\
    --max-time 30 2>/dev/null)
  HTTP_STATUS="\${HTTP_STATUS:-000}"
  BODY=\$(cat "\${RESPONSE_FILE}" 2>/dev/null || echo "")
  rm -f "\${RESPONSE_FILE}"
  if [[ "\${HTTP_STATUS}" =~ ^2[0-9][0-9]\$ ]]; then
    SYNCED=\$(echo "\${BODY}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('synced',0))" 2>/dev/null || echo 0)
    echo "\${SYNCED}"
  else
    err "Batch failed: HTTP \${HTTP_STATUS} \${BODY}"
    echo "0"
  fi
}

# Read NDJSON in chunks of BATCH_SIZE lines and POST each chunk as a JSON batch
OFFSET=0
while [[ \${OFFSET} -lt \${PARSED_COUNT} ]]; do
  BATCH_NUM=\$((BATCH_NUM + 1))
  # Extract the next BATCH_SIZE lines and wrap into { sessions: [...] }
  sed -n "\$((OFFSET + 1)),\$((OFFSET + BATCH_SIZE))p" "\${TMP_NDJSON}" \\
    | python3 -c "import sys,json; print(json.dumps({'sessions':[json.loads(l) for l in sys.stdin if l.strip()]}))" \\
    > "\${BATCH_FILE}"

  BATCH_JSON=\$(cat "\${BATCH_FILE}")
  if [[ -z "\${BATCH_JSON}" ]]; then
    break
  fi

  SYNCED_IN_BATCH=\$(post_batch "\${BATCH_JSON}")
  TOTAL_SYNCED=\$((TOTAL_SYNCED + SYNCED_IN_BATCH))

  BATCH_END=\$((OFFSET + BATCH_SIZE))
  [[ \${BATCH_END} -gt \${PARSED_COUNT} ]] && BATCH_END=\${PARSED_COUNT}
  log "Batch \${BATCH_NUM}: posted \${BATCH_END}/\${PARSED_COUNT} (synced so far: \${TOTAL_SYNCED})"

  OFFSET=\$((OFFSET + BATCH_SIZE))
done

log ""
log "Done. Synced \${TOTAL_SYNCED} session(s)."
log "View your AI usage at: ${appUrl}/ai-usage"
`

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
