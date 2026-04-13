import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * GET /api/ai-usage/team
 *
 * Admin-gated, team-scoped AI usage aggregation. Returns summary metrics,
 * daily usage, breakdowns by model/tool/department, per-user rows, and a
 * list of "adoption opportunities" — users expected to use AI (Product +
 * Engineering by default) who haven't synced any sessions in the window.
 *
 * Query params:
 *   - days: number of days to look back (default 30, max 180)
 *   - departments: comma-separated department ids to filter by
 *   - opportunity_departments: comma-separated department ids used to
 *     identify "expected to use AI" users. If omitted, defaults to any
 *     department whose name or slug matches /product|engineering/i.
 *
 * Access control: profiles.role in ('admin', 'super_admin').
 */

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type DailyRow = { date: string; sessions: number; tokens: number; activeUsers: number }

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const adminDb = getServiceClient()
    const { data: profile } = await adminDb
      .from('profiles')
      .select('role, current_team_id, organization_id')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
    }
    if (!profile.current_team_id) {
      return NextResponse.json({ error: 'No active team' }, { status: 400 })
    }
    const teamId = profile.current_team_id as string
    const organizationId = profile.organization_id as string | null

    const { searchParams } = new URL(request.url)
    const days = Math.max(1, Math.min(parseInt(searchParams.get('days') || '30', 10) || 30, 180))
    const filterDepartments = (searchParams.get('departments') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const explicitOpportunityDepts = (searchParams.get('opportunity_departments') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceIso = since.toISOString()

    // ── Roster: every org member visible to this team admin ──
    // Prefer the organization-wide roster if available (so cross-team
    // admins see everyone), otherwise fall back to the current team.
    const rosterQuery = organizationId
      ? adminDb
          .from('organization_members')
          .select('user_id, role, department_id, team_id')
          .eq('organization_id', organizationId)
      : adminDb
          .from('team_members')
          .select('user_id, role, team_id:team_id')
          .eq('team_id', teamId)

    const { data: rosterRows, error: rosterErr } = await rosterQuery
    if (rosterErr) {
      return NextResponse.json({ error: rosterErr.message }, { status: 500 })
    }

    // Dedupe by user_id (a user can be in multiple teams within an org).
    const rosterByUser = new Map<string, { user_id: string; role: string | null; department_id: string | null }>()
    for (const r of rosterRows || []) {
      if (!rosterByUser.has(r.user_id)) {
        rosterByUser.set(r.user_id, {
          user_id: r.user_id,
          role: (r as any).role ?? null,
          department_id: (r as any).department_id ?? null,
        })
      }
    }
    const allUserIds = Array.from(rosterByUser.keys())

    // ── Hydrate names + department ids from profiles ──
    // `display_name` is the actively-populated name column (migration 055).
    // The original `full_name` column from migration 001 has been dropped in
    // this deployment, so asking for it causes the whole query to error. We
    // stick to `display_name` and fall back to the local part of the email.
    const nameMap = new Map<string, { full_name: string | null; email: string | null; avatar_url: string | null; job_title: string | null; department_id: string | null }>()
    if (allUserIds.length > 0) {
      const { data: profs, error: profsErr } = await adminDb
        .from('profiles')
        .select('id, email, display_name, avatar_url, job_title, department_id')
        .in('id', allUserIds)
      if (profsErr) {
        console.error('[ai-usage/team] profiles lookup failed:', profsErr)
      }
      for (const p of profs || []) {
        const emailPrefix = p.email ? (p.email as string).split('@')[0] : null
        const resolvedName = (p as any).display_name || emailPrefix || null
        nameMap.set(p.id, {
          full_name: resolvedName,
          email: p.email,
          avatar_url: p.avatar_url,
          job_title: (p as any).job_title ?? null,
          department_id: (p as any).department_id ?? null,
        })
      }
    }

    // Resolve a final department_id per user (org_members row first, then profile).
    for (const [uid, row] of rosterByUser.entries()) {
      if (!row.department_id) {
        const fromProfile = nameMap.get(uid)?.department_id ?? null
        if (fromProfile) rosterByUser.set(uid, { ...row, department_id: fromProfile })
      }
    }

    // ── Departments lookup ──
    const { data: departments } = await adminDb
      .from('departments')
      .select('id, name, slug')
      .eq('organization_id', organizationId || '')
    const departmentById = new Map<string, { id: string; name: string; slug: string }>()
    for (const d of departments || []) departmentById.set(d.id, d)

    // ── Determine "opportunity departments" (Product + Engineering by default) ──
    const opportunityDepartmentIds = new Set<string>()
    if (explicitOpportunityDepts.length > 0) {
      explicitOpportunityDepts.forEach(id => opportunityDepartmentIds.add(id))
    } else {
      for (const d of departments || []) {
        if (/(product|engineering)/i.test(d.name) || /(product|engineering)/i.test(d.slug || '')) {
          opportunityDepartmentIds.add(d.id)
        }
      }
    }

    // ── Fetch AI sessions for every user in the roster ──
    let sessions: Array<{
      user_id: string
      started_at: string
      duration_seconds: number | null
      input_tokens: number | null
      output_tokens: number | null
      estimated_cost_cents: number | null
      messages_count: number | null
      tool_calls_count: number | null
      model: string | null
      tool: string | null
      entrypoint: string | null
    }> = []
    if (allUserIds.length > 0) {
      const { data, error: aiErr } = await adminDb
        .from('ai_sessions')
        .select('user_id, started_at, duration_seconds, input_tokens, output_tokens, estimated_cost_cents, messages_count, tool_calls_count, model, tool, entrypoint')
        .in('user_id', allUserIds)
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
        .limit(10000)
      if (aiErr) {
        return NextResponse.json({ error: aiErr.message }, { status: 500 })
      }
      sessions = (data || []) as any
    }

    // ── Per-user aggregation ──
    type UserAgg = {
      user_id: string
      sessions: number
      tokens: number
      cost_cents: number
      messages: number
      tool_calls: number
      last_sync: string | null
    }
    const perUser = new Map<string, UserAgg>()
    for (const s of sessions) {
      const existing = perUser.get(s.user_id) || { user_id: s.user_id, sessions: 0, tokens: 0, cost_cents: 0, messages: 0, tool_calls: 0, last_sync: null }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      existing.cost_cents += s.estimated_cost_cents || 0
      existing.messages += s.messages_count || 0
      existing.tool_calls += s.tool_calls_count || 0
      if (!existing.last_sync || s.started_at > existing.last_sync) {
        existing.last_sync = s.started_at
      }
      perUser.set(s.user_id, existing)
    }

    // Build the per-user rows (all roster users — missing = status 'never')
    const userRows = Array.from(rosterByUser.values()).map(r => {
      const agg = perUser.get(r.user_id)
      const prof = nameMap.get(r.user_id)
      const dept = r.department_id ? departmentById.get(r.department_id) || null : null
      const status: 'active' | 'dormant' | 'never' = agg
        ? 'active'
        : 'never'
      // Dormant heuristic: had sessions in the past but not in this window.
      // Cheap approximation — we only fetched the window. Leave as 'never'
      // unless we later add a separate "ever synced" check.
      return {
        user_id: r.user_id,
        full_name: prof?.full_name ?? null,
        email: prof?.email ?? null,
        avatar_url: prof?.avatar_url ?? null,
        job_title: prof?.job_title ?? null,
        role: r.role,
        department_id: r.department_id,
        department_name: dept?.name ?? null,
        sessions: agg?.sessions ?? 0,
        tokens: agg?.tokens ?? 0,
        cost_cents: agg?.cost_cents ?? 0,
        messages: agg?.messages ?? 0,
        tool_calls: agg?.tool_calls ?? 0,
        last_sync: agg?.last_sync ?? null,
        is_opportunity_department:
          r.department_id ? opportunityDepartmentIds.has(r.department_id) : false,
        status,
      }
    })

    // Apply department filter to the rows used for charts/table.
    const filteredUserRows = filterDepartments.length > 0
      ? userRows.filter(u => u.department_id && filterDepartments.includes(u.department_id))
      : userRows

    const filteredUserIds = new Set(filteredUserRows.map(u => u.user_id))
    const filteredSessions = filterDepartments.length > 0
      ? sessions.filter(s => filteredUserIds.has(s.user_id))
      : sessions

    // ── Summary ──
    const eligibleUsers = filteredUserRows.length
    const activeUsers = filteredUserRows.filter(u => u.sessions > 0).length
    const totalSessions = filteredSessions.length
    const totalTokens = filteredSessions.reduce((sum, s) => sum + (s.input_tokens || 0) + (s.output_tokens || 0), 0)
    const totalCostCents = filteredSessions.reduce((sum, s) => sum + (s.estimated_cost_cents || 0), 0)
    const adoptionRate = eligibleUsers > 0 ? Math.round((activeUsers / eligibleUsers) * 100) : 0

    // ── Daily breakdown ──
    const dailyMap = new Map<string, { sessions: number; tokens: number; userIds: Set<string> }>()
    for (const s of filteredSessions) {
      const day = new Date(s.started_at).toISOString().split('T')[0]
      const existing = dailyMap.get(day) || { sessions: 0, tokens: 0, userIds: new Set<string>() }
      existing.sessions += 1
      existing.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      existing.userIds.add(s.user_id)
      dailyMap.set(day, existing)
    }
    const dailyUsage: DailyRow[] = []
    const cursor = new Date(since)
    const today = new Date()
    while (cursor <= today) {
      const dayStr = cursor.toISOString().split('T')[0]
      const data = dailyMap.get(dayStr)
      dailyUsage.push({
        date: dayStr,
        sessions: data?.sessions || 0,
        tokens: data?.tokens || 0,
        activeUsers: data?.userIds.size || 0,
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    // ── Breakdowns ──
    const modelMap = new Map<string, { sessions: number; tokens: number }>()
    const toolMap = new Map<string, { sessions: number; tokens: number }>()
    for (const s of filteredSessions) {
      const m = s.model || 'unknown'
      const mExisting = modelMap.get(m) || { sessions: 0, tokens: 0 }
      mExisting.sessions += 1
      mExisting.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      modelMap.set(m, mExisting)
      const t = s.tool || 'unknown'
      const tExisting = toolMap.get(t) || { sessions: 0, tokens: 0 }
      tExisting.sessions += 1
      tExisting.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
      toolMap.set(t, tExisting)
    }
    const byModel = Array.from(modelMap.entries()).map(([model, d]) => ({ model, ...d })).sort((a, b) => b.sessions - a.sessions)
    const byTool = Array.from(toolMap.entries()).map(([tool, d]) => ({ tool, ...d })).sort((a, b) => b.sessions - a.sessions)

    // ── Department breakdown (always computed against unfiltered rows so the
    // dropdown/context shows every department even while filtered) ──
    type DeptAgg = { department_id: string | null; department_name: string; sessions: number; tokens: number; activeUsers: number; eligibleUsers: number }
    const deptMap = new Map<string, DeptAgg>()
    for (const u of userRows) {
      const key = u.department_id || '__none'
      const name = u.department_name || 'Unassigned'
      const existing = deptMap.get(key) || { department_id: u.department_id, department_name: name, sessions: 0, tokens: 0, activeUsers: 0, eligibleUsers: 0 }
      existing.eligibleUsers += 1
      if (u.sessions > 0) existing.activeUsers += 1
      existing.sessions += u.sessions
      existing.tokens += u.tokens
      deptMap.set(key, existing)
    }
    const byDepartment = Array.from(deptMap.values()).sort((a, b) => b.sessions - a.sessions)

    // ── Adoption opportunities ──
    // Users in the opportunity departments with zero sessions in the window.
    // This always uses the opportunity set, NOT the UI department filter —
    // it's a standing list of people managers might want to reach out to.
    const adoptionOpportunities = userRows
      .filter(u => u.is_opportunity_department && u.sessions === 0)
      .map(u => ({
        user_id: u.user_id,
        full_name: u.full_name,
        email: u.email,
        avatar_url: u.avatar_url,
        job_title: u.job_title,
        department_id: u.department_id,
        department_name: u.department_name,
        last_sync: u.last_sync,
      }))

    // ── Team name ──
    const { data: team } = await adminDb
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .single()

    return NextResponse.json({
      team: { id: teamId, name: team?.name ?? 'Team' },
      filter: {
        days,
        departments: filterDepartments,
      },
      summary: {
        totalSessions,
        totalTokens,
        totalCostCents,
        activeUsers,
        eligibleUsers,
        adoptionRate,
        days,
      },
      dailyUsage,
      byModel,
      byTool,
      byDepartment,
      users: filteredUserRows.sort((a, b) => b.sessions - a.sessions),
      adoptionOpportunities,
      opportunityDepartmentIds: Array.from(opportunityDepartmentIds),
      allDepartments: (departments || []).map(d => ({ id: d.id, name: d.name, slug: d.slug })),
    })
  } catch (err: any) {
    console.error('[ai-usage/team] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
