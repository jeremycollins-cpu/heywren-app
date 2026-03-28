import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function checkSuperAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return false

  const adminDb = getAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()

  return profile?.role === 'super_admin'
}

export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const adminDb = getAdminClient()
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') || 'overview'
  const userId = searchParams.get('userId')
  const teamId = searchParams.get('teamId')

  // Overview: all teams with health metrics
  if (view === 'overview') {
    const { data: teams } = await adminDb
      .from('teams')
      .select('id, name, slug, domain, created_at')
      .order('created_at', { ascending: false })

    const teamHealth = await Promise.all((teams || []).map(async (team) => {
      const [teamMembers, orgMembers, profileMembers, integrations, commitments, outlookMsgs, slackMsgs] = await Promise.all([
        adminDb.from('team_members').select('user_id').eq('team_id', team.id),
        adminDb.from('organization_members').select('user_id').eq('team_id', team.id),
        adminDb.from('profiles').select('id').eq('current_team_id', team.id),
        adminDb.from('integrations').select('id, provider, user_id', { count: 'exact' }).eq('team_id', team.id),
        adminDb.from('commitments').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
        adminDb.from('outlook_messages').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
        adminDb.from('slack_messages').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
      ])

      // Deduplicate member count across all sources
      const memberIds = new Set<string>()
      for (const m of teamMembers.data || []) memberIds.add(m.user_id)
      for (const m of orgMembers.data || []) memberIds.add(m.user_id)
      for (const p of profileMembers.data || []) memberIds.add(p.id)

      return {
        ...team,
        memberCount: memberIds.size,
        integrationCount: integrations.count || 0,
        integrations: integrations.data || [],
        commitmentCount: commitments.count || 0,
        emailCount: outlookMsgs.count || 0,
        slackMessageCount: slackMsgs.count || 0,
      }
    }))

    return NextResponse.json({ teams: teamHealth })
  }

  // User detail: full diagnostic for a specific user
  if (view === 'user' && userId) {
    const { data: profile } = await adminDb
      .from('profiles')
      .select('id, email, full_name, display_name, role, current_team_id, onboarding_completed, onboarding_step, slack_user_id, created_at')
      .eq('id', userId)
      .single()

    if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const teamId = profile.current_team_id
    const userEmail = profile.email?.toLowerCase() || ''

    const [integrations, commitments, outlookMsgs, slackMsgs, calEvents, awaitingReplies] = await Promise.all([
      adminDb.from('integrations').select('id, provider, created_at').eq('team_id', teamId).eq('user_id', userId),
      adminDb.from('commitments').select('id, status, source, created_at').eq('team_id', teamId).or(`creator_id.eq.${userId},assignee_id.eq.${userId}`),
      teamId ? adminDb.from('outlook_messages').select('id, processed, commitments_found', { count: 'exact' }).eq('team_id', teamId) : Promise.resolve({ data: [], count: 0 }),
      teamId ? adminDb.from('slack_messages').select('id, processed, commitments_found', { count: 'exact' }).eq('team_id', teamId) : Promise.resolve({ data: [], count: 0 }),
      teamId ? adminDb.from('outlook_calendar_events').select('id', { count: 'exact', head: true }).eq('team_id', teamId) : Promise.resolve({ count: 0 }),
      teamId ? adminDb.from('awaiting_replies').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('user_id', userId) : Promise.resolve({ count: 0 }),
    ])

    const emailData = outlookMsgs.data || []
    const slackData = slackMsgs.data || []
    const commitmentData = commitments.data || []

    return NextResponse.json({
      profile,
      integrations: integrations.data || [],
      diagnostics: {
        commitments: {
          total: commitmentData.length,
          open: commitmentData.filter(c => c.status === 'open').length,
          completed: commitmentData.filter(c => c.status === 'completed').length,
          bySource: {
            slack: commitmentData.filter(c => c.source === 'slack').length,
            outlook: commitmentData.filter(c => c.source === 'outlook').length,
            calendar: commitmentData.filter(c => c.source === 'calendar').length,
          },
        },
        emails: {
          total: outlookMsgs.count || 0,
          processed: emailData.filter(e => e.processed).length,
          unprocessed: emailData.filter(e => !e.processed).length,
        },
        slackMessages: {
          total: slackMsgs.count || 0,
          processed: slackData.filter(s => s.processed).length,
          unprocessed: slackData.filter(s => !s.processed).length,
        },
        calendarEvents: calEvents.count || 0,
        waitingRoomItems: awaitingReplies.count || 0,
      },
    })
  }

  // Team detail: all users in a team with their status
  // Check ALL membership sources: team_members, organization_members, and profiles.current_team_id
  if (view === 'team' && teamId) {
    const userIdSet = new Set<string>()
    const roleMap = new Map<string, string>()
    const joinedMap = new Map<string, string>()

    // Source 1: team_members (legacy)
    const { data: teamMembers } = await adminDb
      .from('team_members')
      .select('user_id, role, created_at')
      .eq('team_id', teamId)
    for (const m of teamMembers || []) {
      userIdSet.add(m.user_id)
      roleMap.set(m.user_id, m.role)
      joinedMap.set(m.user_id, m.created_at)
    }

    // Source 2: organization_members
    const { data: orgMembers } = await adminDb
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('team_id', teamId)
    for (const m of orgMembers || []) {
      userIdSet.add(m.user_id)
      if (!roleMap.has(m.user_id)) roleMap.set(m.user_id, m.role)
      if (!joinedMap.has(m.user_id)) joinedMap.set(m.user_id, m.created_at)
    }

    // Source 3: profiles with current_team_id
    const { data: profileMembers } = await adminDb
      .from('profiles')
      .select('id, created_at')
      .eq('current_team_id', teamId)
    for (const p of profileMembers || []) {
      userIdSet.add(p.id)
      if (!roleMap.has(p.id)) roleMap.set(p.id, 'member')
      if (!joinedMap.has(p.id)) joinedMap.set(p.id, p.created_at)
    }

    const userIds = Array.from(userIdSet)

    const userDetails = await Promise.all(userIds.map(async (userId) => {
      const [{ data: profile }, { data: integrations }, { count: commitmentCount }] = await Promise.all([
        adminDb
          .from('profiles')
          .select('id, email, full_name, display_name, role, onboarding_completed, slack_user_id, created_at')
          .eq('id', userId)
          .single(),
        adminDb
          .from('integrations')
          .select('provider')
          .eq('team_id', teamId)
          .eq('user_id', userId),
        adminDb
          .from('commitments')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`),
      ])

      // If profile has no name, try to get it from auth user metadata
      let resolvedName = profile?.full_name || profile?.display_name || ''
      let resolvedEmail = profile?.email || ''
      if (!resolvedName || !resolvedEmail) {
        try {
          const { data: authUser } = await adminDb.auth.admin.getUserById(userId)
          if (authUser?.user) {
            if (!resolvedName) resolvedName = authUser.user.user_metadata?.full_name || authUser.user.user_metadata?.name || ''
            if (!resolvedEmail) resolvedEmail = authUser.user.email || ''
          }
        } catch { /* auth lookup failed, use what we have */ }
      }

      return {
        ...profile,
        id: profile?.id || userId,
        email: resolvedEmail,
        full_name: resolvedName,
        display_name: resolvedName,
        teamRole: roleMap.get(userId) || 'member',
        joinedAt: joinedMap.get(userId) || profile?.created_at,
        integrations: (integrations || []).map(i => i.provider),
        commitmentCount: commitmentCount || 0,
      }
    }))

    return NextResponse.json({ members: userDetails })
  }

  return NextResponse.json({ error: 'Invalid view' }, { status: 400 })
}
