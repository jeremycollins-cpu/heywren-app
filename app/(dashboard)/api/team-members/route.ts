import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    const admin = getAdminClient()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Resolve the caller's org membership and role ──
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, team_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single()

    // If user has org membership, use hierarchy-aware logic
    if (callerMembership) {
      return await getOrgHierarchyMembers(admin, userId, callerMembership)
    }

    // ── Legacy fallback: use team_members ──
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    let teamId = profile?.current_team_id
    if (!teamId) {
      const { data: membership } = await admin
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()
      teamId = membership?.team_id
    }

    if (!teamId) {
      return NextResponse.json({ members: [], teamName: null })
    }

    const { data: team } = await admin
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .single()

    const { data: teamMembers } = await admin
      .from('team_members')
      .select('id, user_id, role')
      .eq('team_id', teamId)

    if (!teamMembers) {
      return NextResponse.json({ members: [], teamName: team?.name })
    }

    const userIds = teamMembers.map(m => m.user_id)
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, display_name, avatar_url')
      .in('id', userIds)

    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    const members = teamMembers.map(m => {
      const p = profileMap.get(m.user_id)
      return {
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: p?.email || '',
        full_name: p?.display_name || p?.email?.split('@')[0] || 'Unknown',
        avatar_url: p?.avatar_url || null,
      }
    })

    return NextResponse.json({ members, teamName: team?.name || null, teamId })
  } catch (err) {
    console.error('Team members error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

/**
 * Returns members visible to the caller based on their org role:
 * - org_admin: all members across all departments/teams in the org
 * - dept_manager: all members in their department
 * - team_lead / member: only members in their team
 *
 * Also returns org/dept/team structure metadata.
 */
async function getOrgHierarchyMembers(
  admin: any,
  callerId: string,
  callerMembership: {
    organization_id: string
    department_id: string
    team_id: string
    role: string
  }
) {
  const { organization_id, department_id, team_id, role } = callerMembership

  // Get organization info
  const { data: org } = await admin
    .from('organizations')
    .select('id, name, slug, domain')
    .eq('id', organization_id)
    .single()

  // Build the member query based on role visibility
  let memberQuery = admin
    .from('organization_members')
    .select('id, organization_id, department_id, team_id, user_id, role')
    .eq('organization_id', organization_id)

  if (role === 'dept_manager') {
    memberQuery = memberQuery.eq('department_id', department_id)
  } else if (role === 'team_lead' || role === 'member') {
    memberQuery = memberQuery.eq('team_id', team_id)
  }
  // org_admin: no additional filter — sees everyone

  const { data: orgMembers } = await memberQuery

  if (!orgMembers || orgMembers.length === 0) {
    return NextResponse.json({
      members: [],
      organization: org,
      callerRole: role,
      teamId: team_id,
    })
  }

  // Get profiles for visible members
  const userIds = orgMembers.map((m: any) => m.user_id)
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, display_name, avatar_url, job_title, onboarding_completed, last_active_at')
    .in('id', userIds)

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))

  // Get integrations for all visible members
  const { data: integrations } = await admin
    .from('integrations')
    .select('user_id, provider, updated_at')
    .in('user_id', userIds)

  const integrationMap = new Map<string, { providers: string[]; lastSync: string | null }>()
  for (const integ of integrations || []) {
    if (!integrationMap.has(integ.user_id)) {
      integrationMap.set(integ.user_id, { providers: [], lastSync: null })
    }
    const entry = integrationMap.get(integ.user_id)!
    entry.providers.push(integ.provider)
    if (integ.updated_at && (!entry.lastSync || integ.updated_at > entry.lastSync)) {
      entry.lastSync = integ.updated_at
    }
  }

  // last_active_at is already included in the profiles query above

  // Get department and team names for context
  const deptIds = [...new Set(orgMembers.map((m: any) => m.department_id))]
  const teamIds = [...new Set(orgMembers.map((m: any) => m.team_id))]

  const [{ data: departments }, { data: allDepartments }, { data: teams }] = await Promise.all([
    admin.from('departments').select('id, name, slug').in('id', deptIds),
    // Fetch ALL departments for the org (not just those with members) so dropdowns show the full list
    admin.from('departments').select('id, name, slug').eq('organization_id', organization_id).order('name'),
    admin.from('teams').select('id, name, slug, department_id').in('id', teamIds),
  ])

  const deptMap = new Map((departments || []).map((d: any) => [d.id, d]))
  const teamMap = new Map((teams || []).map((t: any) => [t.id, t]))

  const members = orgMembers.map((m: any) => {
    const p: any = profileMap.get(m.user_id)
    const dept: any = deptMap.get(m.department_id)
    const team: any = teamMap.get(m.team_id)
    const integ = integrationMap.get(m.user_id)
    return {
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      email: p?.email || '',
      full_name: p?.display_name || p?.email?.split('@')[0] || 'Unknown',
      avatar_url: p?.avatar_url || null,
      job_title: p?.job_title || null,
      department_id: m.department_id,
      department_name: dept?.name || null,
      team_id: m.team_id,
      team_name: team?.name || null,
      onboarded: p?.onboarding_completed ?? false,
      integrations: integ?.providers || [],
      last_sign_in: p?.last_active_at || null,
      last_sync: integ?.lastSync || null,
    }
  })

  return NextResponse.json({
    members,
    organization: org,
    departments: allDepartments || departments || [],
    teams: teams || [],
    callerRole: role,
    callerDepartmentId: department_id,
    callerTeamId: team_id,
    teamId: team_id,
    teamName: (teamMap.get(team_id) as any)?.name || null,
  })
}

export const dynamic = 'force-dynamic'
