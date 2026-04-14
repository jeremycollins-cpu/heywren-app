// lib/ai/token-usage.ts
// Centralized token usage tracking across all AI modules.
// Call recordTokenUsage(message.usage) after every Anthropic API call.
// Retrieve accumulated stats with getTokenUsage() (resets on read).

export interface TokenUsageSnapshot {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  api_calls: number
}

const _usage: TokenUsageSnapshot = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  api_calls: 0,
}

/**
 * Record token usage from an Anthropic API response.
 * Call after every `client.messages.create()`.
 */
export function recordTokenUsage(usage: {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
} | undefined | null): void {
  if (!usage) return
  _usage.input_tokens += usage.input_tokens || 0
  _usage.output_tokens += usage.output_tokens || 0
  _usage.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0
  _usage.cache_read_input_tokens += usage.cache_read_input_tokens || 0
  _usage.api_calls += 1
}

/**
 * Get accumulated token usage since last call and reset counters.
 */
export function getTokenUsage(): TokenUsageSnapshot {
  const snapshot = { ..._usage }
  _usage.input_tokens = 0
  _usage.output_tokens = 0
  _usage.cache_creation_input_tokens = 0
  _usage.cache_read_input_tokens = 0
  _usage.api_calls = 0
  return snapshot
}

// ── Input truncation ───────────────────────────────────────────────────

const DEFAULT_MAX_CHARS = 4000 // ~1000 tokens

/**
 * Truncate long input text to stay within token budgets.
 * Uses a 70/30 head/tail split so the AI sees the beginning (context,
 * greeting, subject) and the end (closing, signature, call to action).
 */
export function truncateForAI(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  const headSize = Math.floor(maxChars * 0.7)
  const tailSize = maxChars - headSize - 20
  return text.slice(0, headSize) + '\n[...truncated...]\n' + text.slice(-tailSize)
}
