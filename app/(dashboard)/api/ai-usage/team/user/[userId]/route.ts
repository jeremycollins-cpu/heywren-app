import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * GET /api/ai-usage/team/user/[userId]
 *
 * Admin-gated per-user drill-down for the Team AI Usage dashboard.
 * Returns the same shape as /api/ai-usage (personal) but scoped to the
 * requested user — only callable by team admins within the same team.
 *
 * Query params:
 *   - days: number of days to look back (default 30)
 */

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const adminDb = getServiceClient()

    // Admin gate on the CALLER.
    const { data: callerProfile } = await adminDb
      .from('profiles')
      .select('role, current_team_id, organization_id')
      .eq('id', user.id)
      .single()
    if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
    }

    // Verify the target user is in the same org/team as the caller so admins
    // from one org can't read into another. Prefer org-level containment
    // when available; fall back to team membership.
    if (callerProfile.organization_id) {
      const { data: sameOrg } = await adminDb
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', callerProfile.organization_id)
        .eq('user_id', userId)
        .maybeSingle()
      if (!sameOrg) {
        return NextResponse.json({ error: 'User not in your organization' }, { status: 403 })
      }
    } else if (callerProfile.current_team_id) {
      const { data: sameTeam } = await adminDb
        .from('team_members')
        .select('user_id')
        .eq('team_id', callerProfile.current_team_id)
        .eq('user_id', userId)
        .maybeSingle()
      if (!sameTeam) {
        return NextResponse.json({ error: 'User not in your team' }, { status: 403 })
      }
    } else {
      return NextResponse.json({ error: 'No team context' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const days = Math.max(1, Math.min(parseInt(searchParams.get('days') || '30', 10) || 30, 180))

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceIso = since.toISOString()

    const { data: sessions, error } = await adminDb
      .from('ai_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .limit(500)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const allSessions = sessions || []

    // Target user profile for the header. display_name (migration 055) is
    // the actively-populated column; full_name is largely empty. Fall back
    // through display_name → full_name → local part of email.
    const { data: target } = await adminDb
      .from('profiles')
      .select('id, display_name, full_name, email, avatar_url, job_title, department_id')
      .eq('id', userId)
      .single()

    const targetEmailPrefix = target?.email ? (target.email as string).split('@')[0] : null
    const targetDisplayName = (target as any)?.display_name || target?.full_name || targetEmailPrefix || null

    let departmentName: string | null = null
    if (target?.department_id) {
      const { data: dept } = await adminDb
        .from('departments')
        .select('name')
        .eq('id', target.department_id)
        .single()
      departmentName = dept?.name ?? null
    }

    // Aggregate stats (same shape as the personal /api/ai-usage endpoint
    // so the existing page components could be reused later).
    const totalSessions = allSessions.length
    const totalInputTokens = allSessions.reduce((sum, s) => sum + (s.input_tokens || 0), 0)
    const totalOutputTokens = allSessions.reduce((sum, s) => sum + (s.output_tokens || 0), 0)
    const totalTokens = totalInputTokens + totalOutputTokens
    const totalCostCents = allSessions.reduce((sum, s) => sum + (s.estimated_cost_cents || 0), 0)
    const totalDurationSeconds = allSessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    const totalMessages = allSessions.reduce((sum, s) => sum + (s.messages_count || 0), 0)
    const totalToolCalls = allSessions.reduce((sum, s) => sum + (s.tool_calls_count || 0), 0)
    const avgSessionMinutes = totalSessions > 0 ? Math.round(totalDurationSeconds / totalSessions / 60) : 0

    const dailyMap = new Map<string, { sessions: number; tokens: number; costCents: number; durationSeconds: number }>()
    for (const s of allSessions) {
      const day = new Date(s.started_at).toISOString().split('T')[0]
      const existing = dailyMap.get(day) || { sessions: 0, tokens: 0, costCents: 0, durationSeconds: 0 }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      existing.costCents += s.estimated_cost_cents || 0
      existing.durationSeconds += s.duration_seconds || 0
      dailyMap.set(day, existing)
    }
    const dailyUsage: Array<{ date: string; sessions: number; tokens: number; costCents: number; durationMinutes: number }> = []
    const cursor = new Date(since)
    const today = new Date()
    while (cursor <= today) {
      const dayStr = cursor.toISOString().split('T')[0]
      const data = dailyMap.get(dayStr) || { sessions: 0, tokens: 0, costCents: 0, durationSeconds: 0 }
      dailyUsage.push({
        date: dayStr,
        sessions: data.sessions,
        tokens: data.tokens,
        costCents: data.costCents,
        durationMinutes: Math.round(data.durationSeconds / 60),
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    const toolMap = new Map<string, { sessions: number; tokens: number }>()
    for (const s of allSessions) {
      const t = s.tool || 'unknown'
      const existing = toolMap.get(t) || { sessions: 0, tokens: 0 }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      toolMap.set(t, existing)
    }
    const byTool = Array.from(toolMap.entries()).map(([tool, d]) => ({ tool, ...d }))

    const modelMap = new Map<string, { sessions: number; tokens: number }>()
    for (const s of allSessions) {
      const m = s.model || 'unknown'
      const existing = modelMap.get(m) || { sessions: 0, tokens: 0 }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      modelMap.set(m, existing)
    }
    const byModel = Array.from(modelMap.entries()).map(([model, d]) => ({ model, ...d }))

    return NextResponse.json({
      user: {
        id: target?.id,
        full_name: targetDisplayName,
        email: target?.email,
        avatar_url: target?.avatar_url,
        job_title: target?.job_title,
        department_name: departmentName,
      },
      summary: {
        totalSessions,
        totalTokens,
        totalInputTokens,
        totalOutputTokens,
        totalCostCents,
        totalDurationSeconds,
        totalMessages,
        totalToolCalls,
        avgSessionMinutes,
        days,
      },
      dailyUsage,
      byTool,
      byModel,
      recentSessions: allSessions.slice(0, 50),
    })
  } catch (err: any) {
    console.error('[ai-usage/team/user] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
