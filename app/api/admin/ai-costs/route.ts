export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function verifySuperAdmin(admin: ReturnType<typeof getAdmin>): Promise<string | null> {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return null
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).single()
    if (!profile || !['admin', 'super_admin'].includes(profile.role)) return null
    return userData.user.id
  } catch { return null }
}

/**
 * GET /api/admin/ai-costs?days=30
 * Returns org-wide AI cost metrics from ai_daily_rollups.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = getAdmin()
    const callerId = await verifySuperAdmin(admin)
    if (!callerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 30), 90)
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

    // Fetch all rollups in the window
    const { data: rollups, error } = await admin
      .from('ai_daily_rollups')
      .select('user_id, user_email, organization_id, date, num_sessions, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, estimated_cost_cents, lines_added, lines_removed, commits, prs_opened, tool_acceptance_rate, metadata')
      .gte('date', since)
      .order('date', { ascending: true })

    if (error) {
      console.error('ai-costs query failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = rollups || []

    // ── Aggregate totals ──
    let totalCostCents = 0
    let totalSessions = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheCreation = 0
    let totalCacheRead = 0
    let totalLinesAdded = 0
    let totalLinesRemoved = 0
    let totalCommits = 0
    let totalPRs = 0

    for (const r of rows) {
      totalCostCents += r.estimated_cost_cents || 0
      totalSessions += r.num_sessions || 0
      totalInputTokens += Number(r.input_tokens) || 0
      totalOutputTokens += Number(r.output_tokens) || 0
      totalCacheCreation += Number(r.cache_creation_tokens) || 0
      totalCacheRead += Number(r.cache_read_tokens) || 0
      totalLinesAdded += r.lines_added || 0
      totalLinesRemoved += r.lines_removed || 0
      totalCommits += r.commits || 0
      totalPRs += r.prs_opened || 0
    }

    const totalTokens = totalInputTokens + totalOutputTokens + totalCacheCreation + totalCacheRead
    const cacheHitRate = (totalInputTokens + totalCacheRead) > 0
      ? totalCacheRead / (totalInputTokens + totalCacheRead)
      : 0

    // ── Daily breakdown ──
    const dailyMap = new Map<string, { cost_cents: number; sessions: number; tokens: number }>()
    for (const r of rows) {
      const existing = dailyMap.get(r.date) || { cost_cents: 0, sessions: 0, tokens: 0 }
      existing.cost_cents += r.estimated_cost_cents || 0
      existing.sessions += r.num_sessions || 0
      existing.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0)
      dailyMap.set(r.date, existing)
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, d]) => ({ date, cost_cents: d.cost_cents, sessions: d.sessions, tokens: d.tokens }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // ── Per-user breakdown ──
    const userMap = new Map<string, {
      user_id: string | null
      email: string
      cost_cents: number
      sessions: number
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      commits: number
      prs: number
    }>()
    for (const r of rows) {
      const key = r.user_id || r.user_email || 'unknown'
      const existing = userMap.get(key) || {
        user_id: r.user_id,
        email: r.user_email || 'unknown',
        cost_cents: 0,
        sessions: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        commits: 0,
        prs: 0,
      }
      existing.cost_cents += r.estimated_cost_cents || 0
      existing.sessions += r.num_sessions || 0
      existing.input_tokens += Number(r.input_tokens) || 0
      existing.output_tokens += Number(r.output_tokens) || 0
      existing.cache_read_tokens += Number(r.cache_read_tokens) || 0
      existing.commits += r.commits || 0
      existing.prs += r.prs_opened || 0
      userMap.set(key, existing)
    }

    // Look up display names
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
    const nameMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name, display_name, email')
        .in('id', userIds)
      for (const p of profiles || []) {
        nameMap.set(p.id, p.display_name || p.full_name || p.email || 'Unknown')
      }
    }

    const users = Array.from(userMap.values())
      .map(u => ({
        ...u,
        name: (u.user_id && nameMap.get(u.user_id)) || u.email,
        cache_hit_rate: (u.input_tokens + u.cache_read_tokens) > 0
          ? u.cache_read_tokens / (u.input_tokens + u.cache_read_tokens)
          : 0,
      }))
      .sort((a, b) => b.cost_cents - a.cost_cents)

    // ── Per-model breakdown (from metadata.models array) ──
    const modelMap = new Map<string, { tokens: number; cost_estimate: number }>()
    for (const r of rows) {
      const models = (r.metadata as any)?.models || []
      for (const m of models) {
        const existing = modelMap.get(m.model) || { tokens: 0, cost_estimate: 0 }
        const mTokens = (m.tokens?.input || 0) + (m.tokens?.output || 0) + (m.tokens?.cache_creation || 0) + (m.tokens?.cache_read || 0)
        existing.tokens += mTokens
        modelMap.set(m.model, existing)
      }
    }
    const models = Array.from(modelMap.entries())
      .map(([model, d]) => ({ model, tokens: d.tokens }))
      .sort((a, b) => b.tokens - a.tokens)

    return NextResponse.json({
      period: { days, since },
      totals: {
        cost_cents: totalCostCents,
        cost_dollars: totalCostCents / 100,
        sessions: totalSessions,
        total_tokens: totalTokens,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cache_creation_tokens: totalCacheCreation,
        cache_read_tokens: totalCacheRead,
        cache_hit_rate: Math.round(cacheHitRate * 1000) / 10,
        lines_added: totalLinesAdded,
        lines_removed: totalLinesRemoved,
        commits: totalCommits,
        prs: totalPRs,
      },
      daily,
      users,
      models,
    })
  } catch (err) {
    console.error('ai-costs error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
