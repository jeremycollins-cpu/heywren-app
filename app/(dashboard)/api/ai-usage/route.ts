import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTeamId } from '@/lib/team/resolve-team'

/**
 * GET /api/ai-usage
 * Returns aggregated AI usage stats and recent sessions for the dashboard.
 * Query params:
 *   - days: number of days to look back (default 30)
 *   - tool: filter by tool (default all)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30', 10)
    const tool = searchParams.get('tool') || null

    const since = new Date()
    since.setDate(since.getDate() - days)

    let query = supabase
      .from('ai_sessions')
      .select('*')
      .eq('user_id', user.id)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false })
      .limit(500)

    if (tool) {
      query = query.eq('tool', tool)
    }

    const { data: sessions, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const allSessions = sessions || []

    // Aggregate stats
    const totalSessions = allSessions.length
    const totalInputTokens = allSessions.reduce((sum, s) => sum + (s.input_tokens || 0), 0)
    const totalOutputTokens = allSessions.reduce((sum, s) => sum + (s.output_tokens || 0), 0)
    const totalTokens = totalInputTokens + totalOutputTokens
    const totalCostCents = allSessions.reduce((sum, s) => sum + (s.estimated_cost_cents || 0), 0)
    const totalDurationSeconds = allSessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    const totalMessages = allSessions.reduce((sum, s) => sum + (s.messages_count || 0), 0)
    const totalToolCalls = allSessions.reduce((sum, s) => sum + (s.tool_calls_count || 0), 0)

    const avgSessionMinutes = totalSessions > 0
      ? Math.round(totalDurationSeconds / totalSessions / 60)
      : 0

    // Daily breakdown for chart
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

    // Fill in missing days with zeros
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

    // Tool breakdown
    const toolMap = new Map<string, { sessions: number; tokens: number }>()
    for (const s of allSessions) {
      const t = s.tool || 'unknown'
      const existing = toolMap.get(t) || { sessions: 0, tokens: 0 }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      toolMap.set(t, existing)
    }
    const byTool = Array.from(toolMap.entries()).map(([tool, data]) => ({ tool, ...data }))

    // Model breakdown
    const modelMap = new Map<string, { sessions: number; tokens: number }>()
    for (const s of allSessions) {
      const m = s.model || 'unknown'
      const existing = modelMap.get(m) || { sessions: 0, tokens: 0 }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      modelMap.set(m, existing)
    }
    const byModel = Array.from(modelMap.entries()).map(([model, data]) => ({ model, ...data }))

    return NextResponse.json({
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
    console.error('[ai-usage] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/ai-usage
 * Sync one or more AI sessions from a local CLI tool.
 * Body: { sessions: Array<{ session_id, tool?, started_at, ended_at?, ... }> }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)

    // Get organization_id from team if available
    let organizationId: string | null = null
    if (teamId) {
      const { data: team } = await supabase
        .from('teams')
        .select('organization_id')
        .eq('id', teamId)
        .single()
      organizationId = team?.organization_id || null
    }

    const body = await request.json()
    const sessions = Array.isArray(body.sessions) ? body.sessions : body.session ? [body.session] : []

    if (sessions.length === 0) {
      return NextResponse.json({ error: 'No sessions provided' }, { status: 400 })
    }

    if (sessions.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 sessions per request' }, { status: 400 })
    }

    const rows = sessions.map((s: any) => ({
      user_id: user.id,
      team_id: teamId,
      organization_id: organizationId,
      session_id: s.session_id,
      tool: s.tool || 'claude_code',
      started_at: s.started_at,
      ended_at: s.ended_at || null,
      input_tokens: s.input_tokens || 0,
      output_tokens: s.output_tokens || 0,
      estimated_cost_cents: s.estimated_cost_cents || 0,
      model: s.model || null,
      entrypoint: s.entrypoint || null,
      project_path: s.project_path || null,
      messages_count: s.messages_count || 0,
      tool_calls_count: s.tool_calls_count || 0,
      metadata: s.metadata || {},
    }))

    const { data, error } = await supabase
      .from('ai_sessions')
      .upsert(rows, { onConflict: 'user_id,session_id,tool' })
      .select('id, session_id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      synced: data?.length || 0,
      sessions: data,
    })
  } catch (err: any) {
    console.error('[ai-usage] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
