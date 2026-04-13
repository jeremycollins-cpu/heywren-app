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
# Runs after each Claude Code session to sync usage data.
# Installed by HeyWren — do not edit manually.

set -euo pipefail

HEYWREN_TOKEN="${token}"
HEYWREN_API="${appUrl}/api/ai-usage/sync"
CLAUDE_DIR="\${HOME}/.claude"

# This hook receives session context from Claude Code via environment
# SESSION_ID is set by Claude Code when the hook runs
SESSION_ID="\${CLAUDE_SESSION_ID:-}"

# If no session ID from env, try to find the most recent session
if [[ -z "\${SESSION_ID}" ]]; then
  LATEST_SESSION=\$(ls -t "\${CLAUDE_DIR}/sessions/"*.json 2>/dev/null | head -1)
  if [[ -n "\${LATEST_SESSION}" ]]; then
    SESSION_ID=\$(python3 -c "import json; print(json.load(open('\${LATEST_SESSION}'))['sessionId'])" 2>/dev/null || true)
  fi
fi

[[ -z "\${SESSION_ID}" ]] && exit 0

# Find session metadata
SESSION_META=""
for f in "\${CLAUDE_DIR}/sessions/"*.json; do
  [[ -f "\$f" ]] || continue
  sid=\$(python3 -c "import json; print(json.load(open('\$f')).get('sessionId',''))" 2>/dev/null || true)
  if [[ "\$sid" == "\${SESSION_ID}" ]]; then
    SESSION_META="\$f"
    break
  fi
done

[[ -z "\${SESSION_META}" ]] && exit 0

# Parse session metadata
STARTED_AT_MS=\$(python3 -c "import json; print(json.load(open('\${SESSION_META}')).get('startedAt', 0))" 2>/dev/null || echo "0")
CWD=\$(python3 -c "import json; print(json.load(open('\${SESSION_META}')).get('cwd', ''))" 2>/dev/null || echo "")
ENTRYPOINT=\$(python3 -c "import json; print(json.load(open('\${SESSION_META}')).get('entrypoint', 'cli'))" 2>/dev/null || echo "cli")

# Convert ms timestamp to ISO
STARTED_AT_SEC=\$((STARTED_AT_MS / 1000))
STARTED_AT=\$(date -u -d "@\${STARTED_AT_SEC}" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \\
             date -u -r "\${STARTED_AT_SEC}" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
[[ -z "\${STARTED_AT}" ]] && exit 0

# Find the JSONL conversation file for rich data extraction
JSONL_FILE=""
for project_dir in "\${CLAUDE_DIR}/projects/"*/; do
  candidate="\${project_dir}\${SESSION_ID}.jsonl"
  if [[ -f "\${candidate}" ]]; then
    JSONL_FILE="\${candidate}"
    break
  fi
  # Check subdirectories (subagents)
  candidate="\${project_dir}\${SESSION_ID}/\${SESSION_ID}.jsonl"
  if [[ -f "\${candidate}" ]]; then
    JSONL_FILE="\${candidate}"
    break
  fi
done

# Extract rich data from JSONL
MESSAGES_COUNT=0
TOOL_CALLS=0
LAST_TIMESTAMP=""
MODEL=""
GIT_BRANCH=""

if [[ -n "\${JSONL_FILE}" && -f "\${JSONL_FILE}" ]]; then
  # Use python for reliable JSON parsing
  read -r MESSAGES_COUNT TOOL_CALLS LAST_TIMESTAMP MODEL GIT_BRANCH < <(JSONL_FILE="\${JSONL_FILE}" python3 << 'PYEOF'
import json, os

messages = 0
tool_calls = 0
last_ts = ""
model = ""
git_branch = ""

try:
    with open(os.environ.get("JSONL_FILE", ""), "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg_type = obj.get("type", "")
            ts = obj.get("timestamp", "")
            if ts:
                last_ts = ts

            if msg_type == "user" and not obj.get("isMeta"):
                messages += 1
            elif msg_type == "assistant":
                m = obj.get("message", {})
                if isinstance(m, dict) and m.get("model"):
                    model = m["model"]
                # Count tool_use blocks
                content = m.get("content", []) if isinstance(m, dict) else []
                if isinstance(content, list):
                    tool_calls += sum(1 for c in content if isinstance(c, dict) and c.get("type") == "tool_use")

            branch = obj.get("gitBranch", "")
            if branch:
                git_branch = branch

except Exception:
    pass

print(f"{messages} {tool_calls} {last_ts} {model} {git_branch}")
PYEOF
  ) 2>/dev/null || true
fi

ENDED_AT="\${LAST_TIMESTAMP:-}"

# Build JSON payload
PAYLOAD=\$(python3 -c "
import json, sys
session = {
    'session_id': '\${SESSION_ID}',
    'tool': 'claude_code',
    'started_at': '\${STARTED_AT}',
    'ended_at': '\${ENDED_AT}' if '\${ENDED_AT}' else None,
    'entrypoint': '\${ENTRYPOINT}',
    'project_path': '\${CWD}',
    'messages_count': int('\${MESSAGES_COUNT}' or '0'),
    'tool_calls_count': int('\${TOOL_CALLS}' or '0'),
    'model': '\${MODEL}' if '\${MODEL}' else None,
    'input_tokens': 0,
    'output_tokens': 0,
    'estimated_cost_cents': 0,
    'metadata': {
        'git_branch': '\${GIT_BRANCH}' if '\${GIT_BRANCH}' else None,
        'sync_source': 'hook',
    }
}
print(json.dumps({'sessions': [session]}))
" 2>/dev/null)

[[ -z "\${PAYLOAD}" ]] && exit 0

# Send to HeyWren (silent, non-blocking)
curl -s -f -X POST "\${HEYWREN_API}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${HEYWREN_TOKEN}" \\
  -d "\${PAYLOAD}" \\
  --max-time 10 \\
  > /dev/null 2>&1 || true
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
