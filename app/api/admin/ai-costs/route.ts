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
 * Returns HeyWren's own platform AI costs from ai_platform_usage.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = getAdmin()
    const callerId = await verifySuperAdmin(admin)
    if (!callerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 30), 90)
    const since = new Date(Date.now() - days * 86400000).toISOString()

    const { data: rows, error } = await admin
      .from('ai_platform_usage')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('ai-costs query failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const data = rows || []

    // ── Aggregate totals ──
    let totalCostCents = 0
    let totalApiCalls = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheCreation = 0
    let totalCacheRead = 0
    let totalItemsProcessed = 0

    for (const r of data) {
      totalCostCents += Number(r.estimated_cost_cents) || 0
      totalApiCalls += r.api_calls || 0
      totalInputTokens += r.input_tokens || 0
      totalOutputTokens += r.output_tokens || 0
      totalCacheCreation += r.cache_creation_tokens || 0
      totalCacheRead += r.cache_read_tokens || 0
      totalItemsProcessed += r.items_processed || 0
    }

    const totalTokens = totalInputTokens + totalOutputTokens + totalCacheCreation + totalCacheRead
    const cacheHitRate = (totalInputTokens + totalCacheRead) > 0
      ? totalCacheRead / (totalInputTokens + totalCacheRead)
      : 0

    // ── Daily breakdown ──
    const dailyMap = new Map<string, { cost_cents: number; api_calls: number; items: number }>()
    for (const r of data) {
      const date = r.created_at.slice(0, 10)
      const existing = dailyMap.get(date) || { cost_cents: 0, api_calls: 0, items: 0 }
      existing.cost_cents += Number(r.estimated_cost_cents) || 0
      existing.api_calls += r.api_calls || 0
      existing.items += r.items_processed || 0
      dailyMap.set(date, existing)
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // ── Per-module breakdown ──
    const moduleMap = new Map<string, {
      cost_cents: number
      api_calls: number
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      items_processed: number
      runs: number
    }>()
    for (const r of data) {
      const existing = moduleMap.get(r.module) || {
        cost_cents: 0, api_calls: 0, input_tokens: 0, output_tokens: 0,
        cache_read_tokens: 0, items_processed: 0, runs: 0,
      }
      existing.cost_cents += Number(r.estimated_cost_cents) || 0
      existing.api_calls += r.api_calls || 0
      existing.input_tokens += r.input_tokens || 0
      existing.output_tokens += r.output_tokens || 0
      existing.cache_read_tokens += r.cache_read_tokens || 0
      existing.items_processed += r.items_processed || 0
      existing.runs += 1
      moduleMap.set(r.module, existing)
    }
    const modules = Array.from(moduleMap.entries())
      .map(([module, d]) => ({
        module,
        ...d,
        cache_hit_rate: (d.input_tokens + d.cache_read_tokens) > 0
          ? d.cache_read_tokens / (d.input_tokens + d.cache_read_tokens)
          : 0,
      }))
      .sort((a, b) => b.cost_cents - a.cost_cents)

    // ── Per-team breakdown ──
    const teamMap = new Map<string, { team_id: string; cost_cents: number; api_calls: number; items_processed: number; runs: number }>()
    for (const r of data) {
      const tid = r.team_id || 'unknown'
      const existing = teamMap.get(tid) || { team_id: tid, cost_cents: 0, api_calls: 0, items_processed: 0, runs: 0 }
      existing.cost_cents += Number(r.estimated_cost_cents) || 0
      existing.api_calls += r.api_calls || 0
      existing.items_processed += r.items_processed || 0
      existing.runs += 1
      teamMap.set(tid, existing)
    }

    // Look up team names
    const teamIds = [...new Set(data.map(r => r.team_id).filter(Boolean))]
    const teamNameMap = new Map<string, string>()
    if (teamIds.length > 0) {
      const { data: teams } = await admin
        .from('teams')
        .select('id, name')
        .in('id', teamIds)
      for (const t of teams || []) {
        teamNameMap.set(t.id, t.name)
      }
    }

    const teams = Array.from(teamMap.values())
      .map(t => ({ ...t, name: teamNameMap.get(t.team_id) || t.team_id }))
      .sort((a, b) => b.cost_cents - a.cost_cents)

    return NextResponse.json({
      period: { days, since: since.slice(0, 10) },
      totals: {
        cost_cents: totalCostCents,
        cost_dollars: totalCostCents / 100,
        api_calls: totalApiCalls,
        total_tokens: totalTokens,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cache_creation_tokens: totalCacheCreation,
        cache_read_tokens: totalCacheRead,
        cache_hit_rate: Math.round(cacheHitRate * 1000) / 10,
        items_processed: totalItemsProcessed,
        runs: data.length,
      },
      daily,
      modules,
      teams,
    })
  } catch (err) {
    console.error('ai-costs error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
