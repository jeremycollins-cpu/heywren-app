export const dynamic = 'force-dynamic'
export const maxDuration = 300

// /api/integrations/anthropic-admin/sync
//
// Pulls the last N days of Claude Code usage from the Anthropic Admin API
// and upserts one row per (user, date) into ai_daily_rollups.
//
// Callable two ways:
//   • POST with an org-admin session — runs for the caller's org (manual)
//   • POST with `x-cron-secret: $CRON_SECRET` — runs for EVERY org that
//     has a stored credential (scheduled, see vercel.json crons)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { decryptAdminKey } from '@/lib/crypto/admin-key'
import {
  fetchClaudeCodeUsage,
  AnthropicAdminApiError,
  type ClaudeCodeUsageRow,
} from '@/lib/anthropic/admin-api'

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const DEFAULT_LOOKBACK_DAYS = 7

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Syncs one org's credential. Returns a small summary for the caller.
 */
async function syncOrg(
  service: ReturnType<typeof getServiceClient>,
  organizationId: string,
  lookbackDays: number
): Promise<{
  organization_id: string
  status: 'success' | 'failed'
  rows?: number
  error?: string
}> {
  // Mark as in-progress
  await service
    .from('anthropic_admin_credentials')
    .update({ last_sync_status: 'in_progress', last_sync_error: null })
    .eq('organization_id', organizationId)

  const { data: cred } = await service
    .from('anthropic_admin_credentials')
    .select('encrypted_key, key_iv, key_tag')
    .eq('organization_id', organizationId)
    .single()

  if (!cred) {
    return { organization_id: organizationId, status: 'failed', error: 'Credential not found' }
  }

  let apiKey: string
  try {
    apiKey = decryptAdminKey(cred.encrypted_key, cred.key_iv, cred.key_tag)
  } catch (err) {
    const error = `Failed to decrypt stored key: ${(err as Error).message}`
    await service
      .from('anthropic_admin_credentials')
      .update({ last_sync_status: 'failed', last_sync_error: error })
      .eq('organization_id', organizationId)
    return { organization_id: organizationId, status: 'failed', error }
  }

  const today = new Date()
  const endingAt = new Date(today)
  endingAt.setUTCDate(endingAt.getUTCDate() + 1) // endingAt is exclusive
  const startingAt = new Date(today)
  startingAt.setUTCDate(startingAt.getUTCDate() - lookbackDays)

  let rows: ClaudeCodeUsageRow[]
  try {
    rows = await fetchClaudeCodeUsage({
      apiKey,
      startingAt: ymd(startingAt),
      endingAt: ymd(endingAt),
    })
  } catch (err) {
    const error =
      err instanceof AnthropicAdminApiError
        ? `Anthropic API ${err.status}: ${err.body.slice(0, 200)}`
        : (err as Error).message
    await service
      .from('anthropic_admin_credentials')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'failed',
        last_sync_error: error,
      })
      .eq('organization_id', organizationId)
    return { organization_id: organizationId, status: 'failed', error }
  }

  // Map emails → user_ids within this org, so per-user drill-downs work.
  const emails = Array.from(
    new Set(rows.map(r => r.actor?.email_address).filter((e): e is string => !!e))
  )
  const emailToUserId = new Map<string, string>()
  if (emails.length > 0) {
    const { data: profs } = await service
      .from('profiles')
      .select('id, email, organization_id')
      .in('email', emails)
    for (const p of profs || []) {
      if (p.organization_id === organizationId && p.email) {
        emailToUserId.set(p.email, p.id)
      }
    }
  }

  // Also capture team_id per user so department/team breakdowns work.
  const userIds = Array.from(emailToUserId.values())
  const userTeamMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: orgMembers } = await service
      .from('organization_members')
      .select('user_id, team_id')
      .eq('organization_id', organizationId)
      .in('user_id', userIds)
    for (const m of orgMembers || []) {
      if (m.team_id) userTeamMap.set(m.user_id, m.team_id)
    }
  }

  // Build upsert payloads, split by whether we know the user_id. The two
  // partial unique indexes (user_id vs email-based) handle dedup for each.
  let customerType: string | null = null
  const withUserId: Array<any> = []
  const withEmailOnly: Array<any> = []

  for (const r of rows) {
    const email = r.actor?.email_address ?? null
    const userId = email ? emailToUserId.get(email) ?? null : null
    if (r.customer_type) customerType = r.customer_type

    // Aggregate per-model tokens and cost into top-level columns (so the
    // dashboard can read them cheaply) and keep the full breakdown in
    // metadata. Anthropic reports estimated_cost per model, already in
    // USD cents.
    let inputTokens = 0
    let outputTokens = 0
    let cacheCreation = 0
    let cacheRead = 0
    let estimatedCostCents = 0
    const modelsMetadata: Record<string, unknown>[] = []
    for (const m of r.model_breakdown || []) {
      inputTokens += m.tokens?.input ?? 0
      outputTokens += m.tokens?.output ?? 0
      cacheCreation += m.tokens?.cache_creation ?? 0
      cacheRead += m.tokens?.cache_read ?? 0
      estimatedCostCents += m.estimated_cost?.amount ?? 0
      modelsMetadata.push({
        model: m.model,
        input: m.tokens?.input ?? 0,
        output: m.tokens?.output ?? 0,
        cache_creation: m.tokens?.cache_creation ?? 0,
        cache_read: m.tokens?.cache_read ?? 0,
        cost_cents: m.estimated_cost?.amount ?? 0,
      })
    }

    const sessions = r.core_metrics?.num_sessions ?? 0

    // tool_actions is a map keyed by tool identifier (edit_tool,
    // multi_edit_tool, write_tool, notebook_edit_tool, …). Sum across
    // all tools so the org-wide acceptance rate reflects total behavior.
    let toolAccepted = 0
    let toolRejected = 0
    const toolBreakdown: Record<string, { accepted: number; rejected: number }> = {}
    for (const [toolName, counts] of Object.entries(r.tool_actions || {})) {
      const a = counts?.accepted ?? 0
      const j = counts?.rejected ?? 0
      toolAccepted += a
      toolRejected += j
      toolBreakdown[toolName] = { accepted: a, rejected: j }
    }
    const toolTotal = toolAccepted + toolRejected
    const toolAcceptanceRate = toolTotal > 0 ? toolAccepted / toolTotal : null

    const row = {
      user_id: userId,
      user_email: email,
      organization_id: organizationId,
      team_id: userId ? userTeamMap.get(userId) ?? null : null,
      // Anthropic returns an RFC 3339 UTC timestamp; the DB column is
      // DATE. Slice explicitly so timezone coercion never drifts a row
      // into the wrong day.
      date: r.date?.slice(0, 10),
      source: 'anthropic_admin_api' as const,
      num_sessions: sessions,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_tokens: cacheCreation,
      cache_read_tokens: cacheRead,
      estimated_cost_cents: estimatedCostCents,
      lines_added: r.core_metrics?.lines_of_code?.added ?? 0,
      lines_removed: r.core_metrics?.lines_of_code?.removed ?? 0,
      commits: r.core_metrics?.commits_by_claude_code ?? 0,
      prs_opened: r.core_metrics?.pull_requests_by_claude_code ?? 0,
      tool_acceptance_rate: toolAcceptanceRate,
      metadata: {
        customer_type: r.customer_type ?? null,
        terminal_type: r.terminal_type ?? null,
        tool_accepted: toolAccepted,
        tool_rejected: toolRejected,
        tool_breakdown: toolBreakdown,
        models: modelsMetadata,
      },
      updated_at: new Date().toISOString(),
    }

    if (userId) withUserId.push(row)
    else if (email) withEmailOnly.push(row)
    // Rows with neither user_id nor email are dropped — the CHECK
    // constraint on the table would reject them anyway.
  }

  let totalUpserted = 0
  if (withUserId.length > 0) {
    const { error } = await service
      .from('ai_daily_rollups')
      .upsert(withUserId, { onConflict: 'user_id,date,source' })
    if (error) {
      console.error('[anthropic-admin/sync] upsert (user_id) failed:', error)
    } else {
      totalUpserted += withUserId.length
    }
  }
  if (withEmailOnly.length > 0) {
    const { error } = await service
      .from('ai_daily_rollups')
      .upsert(withEmailOnly, { onConflict: 'organization_id,user_email,date,source' })
    if (error) {
      console.error('[anthropic-admin/sync] upsert (email) failed:', error)
    } else {
      totalUpserted += withEmailOnly.length
    }
  }

  await service
    .from('anthropic_admin_credentials')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_error: null,
      last_sync_row_count: totalUpserted,
      // The current Anthropic response exposes customer_type ('api' |
      // 'subscription') rather than a Team/Enterprise tier label. Store
      // that here so the UI has something to show.
      subscription_type: customerType,
    })
    .eq('organization_id', organizationId)

  return { organization_id: organizationId, status: 'success', rows: totalUpserted }
}

export async function POST(req: NextRequest) {
  try {
    const lookback = parseInt(
      new URL(req.url).searchParams.get('days') || String(DEFAULT_LOOKBACK_DAYS),
      10
    )
    const lookbackDays = Math.max(1, Math.min(lookback || DEFAULT_LOOKBACK_DAYS, 90))

    // Cron path: service-role, runs for every org.
    const cronSecret = req.headers.get('x-cron-secret')
    if (cronSecret && cronSecret === process.env.CRON_SECRET) {
      const service = getServiceClient()
      const { data: orgs } = await service
        .from('anthropic_admin_credentials')
        .select('organization_id')
      const results = []
      for (const o of orgs || []) {
        results.push(await syncOrg(service, o.organization_id, lookbackDays))
      }
      return NextResponse.json({ cron: true, results })
    }

    // User path: org admin manually triggers.
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = getServiceClient()
    const { data: profile } = await service
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single()
    if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
    }
    if (!profile.organization_id) {
      return NextResponse.json({ error: 'No active organization' }, { status: 400 })
    }
    const { data: membership } = await service
      .from('organization_members')
      .select('role')
      .eq('organization_id', profile.organization_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership || membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Organization admin role required' }, { status: 403 })
    }

    const result = await syncOrg(service, profile.organization_id, lookbackDays)
    return NextResponse.json(result, { status: result.status === 'success' ? 200 : 502 })
  } catch (err) {
    console.error('[anthropic-admin/sync] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
