export const dynamic = 'force-dynamic'

// app/api/integrations/claude-code/install/route.ts
// Serves a bash installer script that sets up the Claude Code hook
// for automatic session syncing to HeyWren.
// Usage: curl -fsSL "https://app.heywren.ai/api/integrations/claude-code/install?token=xxx" | bash

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

  if (!token) {
    return new NextResponse('echo "Error: No token provided. Get a setup command from HeyWren Integrations page."', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const script = `#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# HeyWren Claude Code Integration Installer
# Installs a hook that automatically syncs session data after
# each Claude Code session.
# ────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
NC='\\033[0m'

log()  { echo -e "\${GREEN}[heywren]\${NC} $*"; }
warn() { echo -e "\${YELLOW}[heywren]\${NC} $*"; }

CLAUDE_DIR="\${HOME}/.claude"
HOOKS_DIR="\${CLAUDE_DIR}/hooks"
SETTINGS_FILE="\${CLAUDE_DIR}/settings.json"
HOOK_SCRIPT="\${HOOKS_DIR}/heywren-sync.sh"

log "Installing HeyWren Claude Code integration..."

# Create directories
mkdir -p "\${HOOKS_DIR}"

# Write the hook script
cat > "\${HOOK_SCRIPT}" << 'HOOKEOF'
#!/usr/bin/env bash
# HeyWren session sync hook
# Runs after each Claude Code session (Stop hook) to sync usage data.
# Installed by HeyWren — do not edit manually.
#
# Reads session data from ~/.claude/projects/<project>/<session-id>.jsonl
# (current Claude Code file layout) and POSTs it to HeyWren.
# Logs outcomes to ~/.claude/logs/heywren-sync.log so failures are diagnosable.

set -uo pipefail

HEYWREN_TOKEN="${token}"
HEYWREN_API="${appUrl}/api/ai-usage/sync"
CLAUDE_DIR="\${HOME}/.claude"
LOG_DIR="\${CLAUDE_DIR}/logs"
LOG_FILE="\${LOG_DIR}/heywren-sync.log"

mkdir -p "\${LOG_DIR}"

log() {
  echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] \$*" >> "\${LOG_FILE}"
}

# Rotate log if it exceeds ~2000 lines (keep last 1000)
if [[ -f "\${LOG_FILE}" ]]; then
  line_count=\$(wc -l < "\${LOG_FILE}" 2>/dev/null || echo 0)
  if [[ "\${line_count}" -gt 2000 ]]; then
    tail -1000 "\${LOG_FILE}" > "\${LOG_FILE}.tmp" 2>/dev/null && mv "\${LOG_FILE}.tmp" "\${LOG_FILE}"
  fi
fi

log "=== hook fired ==="

# ── Find the session JSONL to sync ──────────────────────────────
# Prefer the session id Claude Code provides via env; fall back to
# the most recently modified JSONL anywhere under projects/.
SESSION_ID="\${CLAUDE_SESSION_ID:-}"
JSONL_FILE=""

if [[ -n "\${SESSION_ID}" ]]; then
  log "CLAUDE_SESSION_ID=\${SESSION_ID}"
  for candidate in "\${CLAUDE_DIR}/projects/"*/"\${SESSION_ID}.jsonl"; do
    if [[ -f "\${candidate}" ]]; then
      JSONL_FILE="\${candidate}"
      break
    fi
  done
fi

if [[ -z "\${JSONL_FILE}" ]]; then
  log "no session id from env or not found; falling back to most recent jsonl"
  JSONL_FILE=\$(ls -t "\${CLAUDE_DIR}/projects/"*/*.jsonl 2>/dev/null | head -1 || true)
fi

if [[ -z "\${JSONL_FILE}" || ! -f "\${JSONL_FILE}" ]]; then
  log "no session jsonl found, exiting"
  exit 0
fi

SESSION_ID=\$(basename "\${JSONL_FILE}" .jsonl)
PROJECT_NAME=\$(basename "\$(dirname "\${JSONL_FILE}")")

log "syncing session \${SESSION_ID} from \${JSONL_FILE}"

# ── Parse JSONL and build JSON payload in one Python pass ───────
PAYLOAD=\$(JSONL_FILE="\${JSONL_FILE}" SESSION_ID="\${SESSION_ID}" PROJECT_NAME="\${PROJECT_NAME}" python3 << 'PYEOF'
import json, os, sys

jsonl_file = os.environ.get("JSONL_FILE", "")
session_id = os.environ.get("SESSION_ID", "")
project_name = os.environ.get("PROJECT_NAME", "")

first_ts = ""
last_ts = ""
messages = 0
tool_calls = 0
model = ""
git_branch = ""

try:
    with open(jsonl_file, "r") as f:
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

            msg_type = obj.get("type", "")
            if msg_type == "user" and not obj.get("isMeta"):
                messages += 1
            elif msg_type == "assistant":
                m = obj.get("message", {})
                if isinstance(m, dict) and m.get("model"):
                    model = m["model"]
                content = m.get("content", []) if isinstance(m, dict) else []
                if isinstance(content, list):
                    tool_calls += sum(
                        1 for c in content
                        if isinstance(c, dict) and c.get("type") == "tool_use"
                    )

            branch = obj.get("gitBranch", "")
            if branch:
                git_branch = branch
except Exception as e:
    print(f"__PARSE_ERROR__: {e}", file=sys.stderr)
    sys.exit(2)

if not first_ts:
    print("__NO_TIMESTAMP__", file=sys.stderr)
    sys.exit(3)

# Decode project path: Claude Code encodes /Users/foo/bar as -Users-foo-bar.
# Best-effort decode (paths with literal hyphens are not round-trippable).
cwd = project_name.lstrip("-")
cwd = "/" + cwd.replace("-", "/") if cwd else ""

session = {
    "session_id": session_id,
    "tool": "claude_code",
    "started_at": first_ts,
    "ended_at": last_ts or None,
    "entrypoint": "cli",
    "project_path": cwd or None,
    "messages_count": messages,
    "tool_calls_count": tool_calls,
    "model": model or None,
    "input_tokens": 0,
    "output_tokens": 0,
    "estimated_cost_cents": 0,
    "metadata": {
        "git_branch": git_branch or None,
        "sync_source": "hook",
    },
}
print(json.dumps({"sessions": [session]}))
PYEOF
)
PARSE_EXIT=\$?

if [[ \${PARSE_EXIT} -ne 0 || -z "\${PAYLOAD}" ]]; then
  log "payload build failed (exit=\${PARSE_EXIT}), skipping sync"
  exit 0
fi

log "posting \${SESSION_ID} to \${HEYWREN_API}"

# ── POST to HeyWren and capture the response ────────────────────
RESPONSE_FILE=\$(mktemp -t heywren-sync-XXXXXX)
HTTP_STATUS=\$(curl -s -o "\${RESPONSE_FILE}" -w "%{http_code}" \\
  -X POST "\${HEYWREN_API}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${HEYWREN_TOKEN}" \\
  -d "\${PAYLOAD}" \\
  --max-time 10 2>/dev/null)
HTTP_STATUS="\${HTTP_STATUS:-000}"

RESPONSE_BODY=\$(cat "\${RESPONSE_FILE}" 2>/dev/null || echo "")
rm -f "\${RESPONSE_FILE}"

if [[ "\${HTTP_STATUS}" =~ ^2[0-9][0-9]\$ ]]; then
  log "success HTTP \${HTTP_STATUS}: \${RESPONSE_BODY}"
else
  log "FAILED HTTP \${HTTP_STATUS}: \${RESPONSE_BODY}"
fi

exit 0
HOOKEOF

chmod +x "\${HOOK_SCRIPT}"
log "Hook script installed at \${HOOK_SCRIPT}"

# Update Claude Code settings.json to register the hook
if [[ -f "\${SETTINGS_FILE}" ]]; then
  # Parse existing settings and add/update the hook
  SETTINGS_FILE="\${SETTINGS_FILE}" HOOK_SCRIPT="\${HOOK_SCRIPT}" python3 << 'PYEOF'
import json, os

settings_file = os.environ.get("SETTINGS_FILE", "")
hook_script = os.environ.get("HOOK_SCRIPT", "")

try:
    with open(settings_file, "r") as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    settings = {}

# Ensure hooks structure exists
if "hooks" not in settings:
    settings["hooks"] = {}
if "Stop" not in settings["hooks"]:
    settings["hooks"]["Stop"] = []

# Remove any existing HeyWren hook
settings["hooks"]["Stop"] = [
    h for h in settings["hooks"]["Stop"]
    if not (isinstance(h, dict) and h.get("command", "").startswith("bash") and "heywren" in h.get("command", "").lower())
]

# Add the new hook
settings["hooks"]["Stop"].append({
    "command": f"bash {hook_script}",
    "timeout": 15000,
})

with open(settings_file, "w") as f:
    json.dump(settings, f, indent=2)

print(f"Updated {settings_file}")
PYEOF
else
  # Create settings with the hook
  cat > "\${SETTINGS_FILE}" << SETTINGSEOF
{
  "hooks": {
    "Stop": [
      {
        "command": "bash \${HOOK_SCRIPT}",
        "timeout": 15000
      }
    ]
  }
}
SETTINGSEOF
  log "Created \${SETTINGS_FILE} with hook configuration"
fi

log ""
log "Setup complete! HeyWren will now automatically sync your Claude Code sessions."
log "View your AI usage at: ${appUrl}/ai-usage"
log ""
log "To verify it's working, start a Claude Code session and check your dashboard after."
`

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
