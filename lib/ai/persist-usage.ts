// lib/ai/persist-usage.ts
// Persists in-memory token usage to the ai_platform_usage table.
// Call logAiUsage() at the end of each Inngest function run to record
// HeyWren's own Anthropic API costs for the super-admin dashboard.

import { getTokenUsage } from './token-usage'

// ── Haiku 4.5 pricing (USD per 1M tokens) ─────────────────────────────
const PRICING = {
  input: 1.00,
  output: 5.00,
  cache_creation: 1.25,
  cache_read: 0.10,
}

function estimateCostCents(usage: {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}): number {
  const costUsd =
    (usage.input_tokens / 1_000_000) * PRICING.input +
    (usage.output_tokens / 1_000_000) * PRICING.output +
    (usage.cache_creation_input_tokens / 1_000_000) * PRICING.cache_creation +
    (usage.cache_read_input_tokens / 1_000_000) * PRICING.cache_read
  return Math.round(costUsd * 100 * 10000) / 10000 // cents with 4 decimal places
}

interface LogAiUsageParams {
  module: string
  trigger?: string
  teamId?: string | null
  userId?: string | null
  model?: string
  itemsProcessed?: number
  metadata?: Record<string, unknown>
}

/**
 * Flush accumulated token usage to the ai_platform_usage table.
 * Reads and resets the in-memory counters from recordTokenUsage().
 *
 * Call at the end of each Inngest function run:
 *   await logAiUsage(supabase, { module: 'detect-commitments', teamId, trigger: 'process-slack-message' })
 *
 * Skips the insert if no API calls were made (nothing to log).
 */
export async function logAiUsage(
  supabase: { from: (table: string) => any },
  params: LogAiUsageParams
): Promise<void> {
  const usage = getTokenUsage()
  const costCents = estimateCostCents(usage)

  // Always insert a row — System Health and the per-module dashboard need
  // a heartbeat even for runs that made zero API calls (clean inbox, nothing
  // to process). Cost queries can filter WHERE api_calls > 0.
  try {
    await supabase.from('ai_platform_usage').insert({
      team_id: params.teamId || null,
      user_id: params.userId || null,
      module: params.module,
      trigger: params.trigger || null,
      model: params.model || 'claude-haiku-4-5-20251001',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_tokens: usage.cache_creation_input_tokens,
      cache_read_tokens: usage.cache_read_input_tokens,
      api_calls: usage.api_calls,
      estimated_cost_cents: costCents,
      items_processed: params.itemsProcessed || 0,
      metadata: params.metadata || {},
    })
  } catch (err) {
    // Non-fatal — don't let usage logging break the actual AI pipeline
    console.error(`[persist-usage] Failed to log ${params.module} usage:`, (err as Error).message)
  }
}
