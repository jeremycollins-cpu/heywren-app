// lib/github/ai-signature.ts
// Pure detection of AI-authorship signatures in commit messages and PR bodies.
// This is an *honest* signal — we only detect explicit signatures left by AI
// coding tools (Co-Authored-By trailers, session-id URLs, known bot patterns).
// We deliberately do NOT try to guess AI authorship from writing style or code
// patterns — those heuristics are unreliable, create adversarial incentives,
// and would undermine the trust that makes the honest signal useful.

export type AiTool = 'claude' | 'copilot' | 'cursor' | 'aider' | 'other'

export interface AiSignatureResult {
  /** True if any AI tool signature was detected. */
  ai_assisted: boolean
  /** Which tool, when identifiable. `'other'` = unnamed AI co-author trailer. */
  tool: AiTool | null
}

// Patterns are case-insensitive, matched against the raw message/body text.
// Order matters for `tool` identification: specific tools before the generic
// `'other'` catch-all.
const PATTERNS: Array<{ tool: AiTool; re: RegExp }> = [
  // Claude Code — session-id URL is the most distinctive signature.
  { tool: 'claude', re: /https?:\/\/claude\.ai\/code\/session[_/][a-z0-9_-]+/i },
  { tool: 'claude', re: /co-authored-by:\s*claude\s*<[^>]*anthropic[^>]*>/i },
  { tool: 'claude', re: /co-authored-by:\s*claude(?:-[\w.-]+)?\s*</i },
  { tool: 'claude', re: /🤖\s*generated with \[?claude code\]?/i },

  // GitHub Copilot (workspace / pull-request agents).
  { tool: 'copilot', re: /co-authored-by:\s*(?:github-)?copilot\s*</i },
  { tool: 'copilot', re: /co-authored-by:\s*copilot-swe-agent\s*</i },

  // Cursor.
  { tool: 'cursor', re: /co-authored-by:\s*cursor\s*<[^>]*cursor\.(?:sh|com)/i },
  { tool: 'cursor', re: /\[cursor\]\s/i },

  // Aider.
  { tool: 'aider', re: /co-authored-by:\s*aider\s*</i },
  { tool: 'aider', re: /\baider\s+\(ai\)\b/i },
]

// Generic Co-Authored-By trailer that looks bot-like but isn't one of the
// named tools above. We only match `noreply@` or `bot@` / names ending in
// `[bot]` / `-bot` to avoid false positives on real human co-authors.
const GENERIC_BOT_COAUTHOR = /co-authored-by:\s*[^\n<]{1,80}<(?:[^>\s@]*(?:\[bot\]|-bot|-ai)@|noreply@(?:bot\.)?|bot@)[^>]*>/i

/**
 * Detect AI signatures in a single piece of text (commit message, PR body).
 * Pass the FULL message — some tools put signatures in the body, not the
 * subject line.
 */
export function detectAiSignature(text: string | null | undefined): AiSignatureResult {
  if (!text) return { ai_assisted: false, tool: null }

  for (const { tool, re } of PATTERNS) {
    if (re.test(text)) return { ai_assisted: true, tool }
  }

  if (GENERIC_BOT_COAUTHOR.test(text)) {
    return { ai_assisted: true, tool: 'other' }
  }

  return { ai_assisted: false, tool: null }
}

/**
 * Merge signatures across multiple sources (e.g. PR title + PR body + merge
 * commit message). Returns the most specific tool detected — any named tool
 * wins over `'other'`; `'other'` wins over no detection.
 */
export function mergeAiSignatures(...results: AiSignatureResult[]): AiSignatureResult {
  let best: AiSignatureResult = { ai_assisted: false, tool: null }
  for (const r of results) {
    if (!r.ai_assisted) continue
    if (!best.ai_assisted) { best = r; continue }
    if (best.tool === 'other' && r.tool && r.tool !== 'other') best = r
  }
  return best
}

/**
 * Human-readable tool label for the UI.
 */
export function aiToolLabel(tool: AiTool | null): string {
  switch (tool) {
    case 'claude': return 'Claude Code'
    case 'copilot': return 'Copilot'
    case 'cursor': return 'Cursor'
    case 'aider': return 'Aider'
    case 'other': return 'Other AI'
    default: return ''
  }
}
