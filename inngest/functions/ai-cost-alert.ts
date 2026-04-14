// inngest/functions/ai-cost-alert.ts
// Daily cron that checks platform AI spend and alerts via Slack webhook
// when costs exceed a configurable threshold.
// Runs at 8 AM PT — after all scan crons have finished.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Default daily threshold in cents. Override with AI_COST_ALERT_THRESHOLD_CENTS env var.
const DEFAULT_THRESHOLD_CENTS = 500 // $5.00/day

function getThresholdCents(): number {
  const env = process.env.AI_COST_ALERT_THRESHOLD_CENTS
  return env ? Number(env) : DEFAULT_THRESHOLD_CENTS
}

async function sendSlackAlert(text: string, blocks?: any[]) {
  const webhookUrl = process.env.AI_COST_ALERT_SLACK_WEBHOOK
  if (!webhookUrl) {
    console.log('[ai-cost-alert] No SLACK_WEBHOOK configured, skipping alert. Message:', text)
    return
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, blocks }),
  })
}

export const aiCostAlert = inngest.createFunction(
  { id: 'ai-cost-alert-daily' },
  { cron: 'TZ=America/Los_Angeles 0 8 * * *' },
  async () => {
    const supabase = getAdminClient()
    const thresholdCents = getThresholdCents()

    // Check yesterday's spend
    const yesterday = new Date(Date.now() - 86400000)
    const dayStart = yesterday.toISOString().slice(0, 10) + 'T00:00:00Z'
    const dayEnd = yesterday.toISOString().slice(0, 10) + 'T23:59:59Z'
    const dateLabel = yesterday.toISOString().slice(0, 10)

    const { data: rows, error } = await supabase
      .from('ai_platform_usage')
      .select('module, estimated_cost_cents, api_calls, items_processed, input_tokens, output_tokens, cache_read_tokens')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)

    if (error) {
      console.error('[ai-cost-alert] Query failed:', error.message)
      return { success: false, error: error.message }
    }

    if (!rows || rows.length === 0) {
      return { success: true, date: dateLabel, totalCostCents: 0, alert: false, reason: 'No data' }
    }

    // Aggregate
    let totalCostCents = 0
    let totalApiCalls = 0
    let totalItems = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheRead = 0
    const moduleCosts: Record<string, number> = {}

    for (const r of rows) {
      const cost = Number(r.estimated_cost_cents) || 0
      totalCostCents += cost
      totalApiCalls += r.api_calls || 0
      totalItems += r.items_processed || 0
      totalInputTokens += r.input_tokens || 0
      totalOutputTokens += r.output_tokens || 0
      totalCacheRead += r.cache_read_tokens || 0
      moduleCosts[r.module] = (moduleCosts[r.module] || 0) + cost
    }

    const totalCostDollars = (totalCostCents / 100).toFixed(2)
    const thresholdDollars = (thresholdCents / 100).toFixed(2)
    const cacheHitRate = (totalInputTokens + totalCacheRead) > 0
      ? Math.round((totalCacheRead / (totalInputTokens + totalCacheRead)) * 100)
      : 0

    const overThreshold = totalCostCents > thresholdCents

    // Sort modules by cost descending
    const topModules = Object.entries(moduleCosts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([mod, cents]) => `  ${mod}: $${(cents / 100).toFixed(2)}`)
      .join('\n')

    if (overThreshold) {
      const alertText = [
        `:warning: *AI Cost Alert — ${dateLabel}*`,
        `Daily spend *$${totalCostDollars}* exceeded threshold of $${thresholdDollars}`,
        '',
        `*Summary:*`,
        `  API Calls: ${totalApiCalls.toLocaleString()}`,
        `  Items Processed: ${totalItems.toLocaleString()}`,
        `  Cache Hit Rate: ${cacheHitRate}%`,
        '',
        `*Top modules:*`,
        topModules,
        '',
        `<${process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'}/admin|View Dashboard>`,
      ].join('\n')

      await sendSlackAlert(alertText)
      console.log(`[ai-cost-alert] ALERT: $${totalCostDollars} > $${thresholdDollars} threshold`)
    } else {
      console.log(`[ai-cost-alert] OK: $${totalCostDollars} under $${thresholdDollars} threshold`)
    }

    // Also alert if cache hit rate drops below 20% (caching may be broken)
    if (totalApiCalls > 50 && cacheHitRate < 20) {
      await sendSlackAlert(
        `:rotating_light: *Low Cache Hit Rate Alert — ${dateLabel}*\n` +
        `Cache hit rate is *${cacheHitRate}%* (expected >50%). Prompt caching may be broken.\n` +
        `API calls: ${totalApiCalls.toLocaleString()}, Spend: $${totalCostDollars}\n` +
        `<${process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'}/admin|View Dashboard>`
      )
      console.log(`[ai-cost-alert] LOW CACHE: ${cacheHitRate}% hit rate`)
    }

    return {
      success: true,
      date: dateLabel,
      totalCostCents,
      totalCostDollars,
      thresholdCents,
      overThreshold,
      cacheHitRate,
      apiCalls: totalApiCalls,
      items: totalItems,
    }
  }
)
