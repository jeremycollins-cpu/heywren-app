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
    // Use select('*') to avoid errors from columns that may not exist yet (e.g. onboarding_step)
    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (profileError) {
      console.error('Admin profile query error for user', userId, ':', profileError.message)
    }

    // If no profile row, try to build a minimal one from auth + membership tables
    let resolvedProfile = profile
    if (!resolvedProfile) {
      let authEmail = ''
      let authName = ''
      try {
        const { data: authUser } = await adminDb.auth.admin.getUserById(userId)
        if (authUser?.user) {
          authEmail = authUser.user.email || ''
          authName = authUser.user.user_metadata?.full_name || authUser.user.user_metadata?.name || ''
        }
      } catch { /* auth lookup failed */ }

      if (!authEmail) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      resolvedProfile = {
        id: userId, email: authEmail, full_name: authName, display_name: authName,
        role: 'user', current_team_id: null, onboarding_completed: false,
        onboarding_step: 'unknown', slack_user_id: null, created_at: new Date().toISOString(),
      }
    }

    // Resolve team ID with fallbacks (same as themes API)
    let userTeamId = resolvedProfile.current_team_id
    if (!userTeamId) {
      const { data: membership } = await adminDb.from('team_members').select('team_id').eq('user_id', userId).limit(1).single()
      userTeamId = membership?.team_id || null
    }
    if (!userTeamId) {
      const { data: orgMembership } = await adminDb.from('organization_members').select('team_id').eq('user_id', userId).limit(1).single()
      userTeamId = orgMembership?.team_id || null
    }

    const userEmail = resolvedProfile.email?.toLowerCase() || ''
    const slackUserId = resolvedProfile.slack_user_id || null

    const [integrations, commitments, outlookMsgs, slackMsgs, calEvents, awaitingReplies, recentCommitments, recentWaiting, recentEmails,
      // New: integration health, data migration, activity log, org domains
      integrationsFull, emailsWithUserId, emailsWithoutUserId, calWithUserId, calWithoutUserId, orgData,
      // Team-level integrations (for admin visibility when user's integrations are empty)
      teamIntegrations,
    ] = await Promise.all([
      adminDb.from('integrations').select('id, provider, updated_at').eq('user_id', userId),
      userTeamId ? adminDb.from('commitments').select('id, status, source, created_at').eq('team_id', userTeamId).or(`creator_id.eq.${userId},assignee_id.eq.${userId}`) : Promise.resolve({ data: [] }),
      // Outlook messages scoped to user (by user_id or email match)
      userTeamId && userEmail
        ? adminDb.from('outlook_messages').select('id, processed, commitments_found', { count: 'exact' }).eq('team_id', userTeamId).or(`user_id.eq.${userId},from_email.eq.${userEmail},to_recipients.ilike.%${userEmail}%`)
        : userTeamId ? adminDb.from('outlook_messages').select('id, processed, commitments_found', { count: 'exact' }).eq('team_id', userTeamId).eq('user_id', userId) : Promise.resolve({ data: [], count: 0 }),
      // Slack messages scoped to user (by slack_user_id stored on the message)
      userTeamId && slackUserId
        ? adminDb.from('slack_messages').select('id, processed, commitments_found', { count: 'exact' }).eq('team_id', userTeamId).eq('user_id', slackUserId)
        : userTeamId ? adminDb.from('slack_messages').select('id, processed, commitments_found', { count: 'exact' }).eq('team_id', userTeamId).eq('user_id', userId) : Promise.resolve({ data: [], count: 0 }),
      userTeamId ? adminDb.from('outlook_calendar_events').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId).or(`user_id.eq.${userId}${userEmail ? `,organizer_email.eq.${userEmail}` : ''}`) : Promise.resolve({ count: 0 }),
      userTeamId ? adminDb.from('awaiting_replies').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId).eq('user_id', userId).in('status', ['waiting', 'snoozed']) : Promise.resolve({ count: 0 }),
      // Recent activity for support debugging
      userTeamId ? adminDb.from('commitments').select('title, status, source, created_at').eq('team_id', userTeamId).or(`creator_id.eq.${userId},assignee_id.eq.${userId}`).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      userTeamId ? adminDb.from('awaiting_replies').select('subject, status, urgency, sent_at, days_waiting').eq('team_id', userTeamId).eq('user_id', userId).in('status', ['waiting', 'snoozed']).order('sent_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      // Recent emails scoped to user (by user_id or email match)
      userTeamId && userEmail
        ? adminDb.from('outlook_messages').select('subject, from_name, received_at, processed').eq('team_id', userTeamId).or(`user_id.eq.${userId},from_email.eq.${userEmail},to_recipients.ilike.%${userEmail}%`).order('received_at', { ascending: false }).limit(10)
        : userTeamId ? adminDb.from('outlook_messages').select('subject, from_name, received_at, processed').eq('team_id', userTeamId).eq('user_id', userId).order('received_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      // Integration health: full details including tokens and config
      adminDb.from('integrations').select('id, provider, access_token, refresh_token, config, updated_at').eq('user_id', userId),
      // Data migration progress: per-user counts
      // Emails tagged with this user's user_id
      userTeamId ? adminDb.from('outlook_messages').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId).eq('user_id', userId) : Promise.resolve({ count: 0 }),
      // Emails likely belonging to this user but not yet tagged
      userTeamId && userEmail
        ? adminDb.from('outlook_messages').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId).is('user_id', null).or(`from_email.eq.${userEmail},to_recipients.ilike.%${userEmail}%`)
        : Promise.resolve({ count: 0 }),
      // Calendar events tagged with this user's user_id
      userTeamId ? adminDb.from('outlook_calendar_events').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId).eq('user_id', userId) : Promise.resolve({ count: 0 }),
      // Calendar events likely belonging to this user but not yet tagged
      userTeamId && userEmail
        ? adminDb.from('outlook_calendar_events').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId).is('user_id', null).eq('organizer_email', userEmail)
        : Promise.resolve({ count: 0 }),
      // Organization domains
      adminDb.from('organization_members').select('organization_id').eq('user_id', userId).limit(1).single(),
      // Team-level integrations (admin visibility fallback)
      userTeamId ? adminDb.from('integrations').select('id, provider, user_id, access_token, refresh_token, config, updated_at').eq('team_id', userTeamId) : Promise.resolve({ data: [] }),
    ])

    const emailData = outlookMsgs.data || []
    const slackData = slackMsgs.data || []
    const commitmentData = commitments.data || []

    // Build integration health details
    // Use user's own integrations, but fall back to team integrations for admin visibility
    // (handles cases where migration backfill assigned integrations to the wrong user)
    const userIntegrations = integrationsFull.data || []
    const allTeamIntegrations = teamIntegrations.data || []

    // Debug: log if integration queries returned errors
    if (!integrationsFull.data && (integrationsFull as any).error) {
      console.error('integrationsFull query error:', (integrationsFull as any).error)
    }
    if (!teamIntegrations.data && (teamIntegrations as any).error) {
      console.error('teamIntegrations query error:', (teamIntegrations as any).error)
    }
    console.log(`[Admin] User ${userId}: ${userIntegrations.length} user integrations, ${allTeamIntegrations.length} team integrations`)

    const healthSource = userIntegrations.length > 0 ? userIntegrations : allTeamIntegrations
    const integrationHealth = healthSource.map((int: any) => {
      const hasToken = !!int.access_token
      const hasRefresh = !!int.refresh_token
      const config = int.config || {}
      const lastSync = int.updated_at
      return {
        id: int.id,
        provider: int.provider,
        hasToken,
        hasRefreshToken: hasRefresh,
        tokenPreview: hasToken ? `...${int.access_token.slice(-8)}` : 'none',
        connectedAt: int.updated_at,
        lastUpdated: lastSync,
        ownedByUser: int.user_id === userId,
        config: {
          slackTeamName: config.slack_team_name || null,
          slackTeamId: config.slack_team_id || null,
          botId: config.bot_id || null,
          connectedBy: config.connected_by || null,
        },
      }
    })

    // Get auth user for last sign-in
    let lastSignIn: string | null = null
    try {
      const { data: authUser } = await adminDb.auth.admin.getUserById(userId)
      lastSignIn = authUser?.user?.last_sign_in_at || null
    } catch { /* ignore */ }

    // Get org domains
    let orgDomains: string[] = []
    let orgId: string | null = null
    if (orgData.data?.organization_id) {
      orgId = orgData.data.organization_id
      const { data: org } = await adminDb.from('organizations').select('domain, allowed_domains').eq('id', orgId).single()
      if (org) {
        if (org.domain) orgDomains.push(org.domain)
        if (Array.isArray(org.allowed_domains)) {
          for (const d of org.allowed_domains) {
            if (typeof d === 'string' && d && !orgDomains.includes(d)) orgDomains.push(d)
          }
        }
      }
    }

    // Use user's integrations, fall back to team integrations for admin visibility
    const userOwnedIntegrations = integrations.data || []
    const resolvedIntegrations = userOwnedIntegrations.length > 0
      ? userOwnedIntegrations
      : (allTeamIntegrations || []).map((i: any) => ({ id: i.id, provider: i.provider, updated_at: i.updated_at }))

    // === ENGAGEMENT & HEALTH SIGNALS ===
    const now = new Date()

    // 1. Days since last sync — per integration
    const syncHealth = healthSource.map((int: any) => {
      const lastUpdated = int.updated_at ? new Date(int.updated_at) : null
      const daysSinceSync = lastUpdated ? Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)) : null
      const config = int.config || {}
      const tokenExpiresAt = config.token_expires_at ? new Date(config.token_expires_at) : null
      const tokenExpired = tokenExpiresAt ? tokenExpiresAt < now : false
      const tokenExpiresSoon = tokenExpiresAt ? (tokenExpiresAt.getTime() - now.getTime()) < 24 * 60 * 60 * 1000 && !tokenExpired : false
      return {
        provider: int.provider,
        daysSinceSync,
        stale: daysSinceSync !== null && daysSinceSync >= 3,
        tokenExpired,
        tokenExpiresSoon,
        tokenExpiresAt: tokenExpiresAt?.toISOString() || null,
      }
    })

    // 2. Last active — approximate from latest data timestamp
    const latestEmailDate = (recentEmails.data || [])[0]?.received_at || null
    const latestCommitmentDate = (recentCommitments.data || [])[0]?.created_at || null
    const lastActiveDates = [lastSignIn, latestEmailDate, latestCommitmentDate].filter(Boolean).map(d => new Date(d!))
    const lastActiveDate = lastActiveDates.length > 0 ? new Date(Math.max(...lastActiveDates.map(d => d.getTime()))) : null
    const daysSinceActive = lastActiveDate ? Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24)) : null

    // 3. Time-to-value: days from account creation to first commitment
    let timeToValue: number | null = null
    if (resolvedProfile.created_at && commitmentData.length > 0) {
      const accountCreated = new Date(resolvedProfile.created_at)
      const commitmentDates = commitmentData.map(c => new Date(c.created_at)).sort((a, b) => a.getTime() - b.getTime())
      timeToValue = Math.floor((commitmentDates[0].getTime() - accountCreated.getTime()) / (1000 * 60 * 60 * 24))
    }

    // 4. Weekly engagement trend — commitments created in last 4 weeks
    const weeklyTrend: number[] = []
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000)
      const count = commitmentData.filter(c => {
        const d = new Date(c.created_at)
        return d >= weekStart && d < weekEnd
      }).length
      weeklyTrend.unshift(count)
    }

    // 5. Feature adoption — check what features they actually use
    const [
      { count: nudgeCount },
      { count: draftCount },
      { count: missedEmailCount },
      { count: missedChatCount },
      { count: achievementCount },
      { data: scoreData },
      { data: notePref },
    ] = await Promise.all([
      adminDb.from('nudges').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      adminDb.from('draft_queue').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      adminDb.from('missed_emails').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      adminDb.from('missed_chats').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      adminDb.from('member_achievements').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      adminDb.from('member_scores').select('total_score, streak_weeks').eq('user_id', userId).limit(1).single(),
      adminDb.from('notification_preferences').select('id').eq('user_id', userId).limit(1).single(),
    ])

    const featureAdoption = {
      commitments: commitmentData.length > 0,
      waitingRoom: (awaitingReplies.count || 0) > 0,
      nudges: (nudgeCount || 0) > 0,
      draftQueue: (draftCount || 0) > 0,
      missedEmails: (missedEmailCount || 0) > 0,
      missedChats: (missedChatCount || 0) > 0,
      achievements: (achievementCount || 0) > 0,
      gamification: !!scoreData,
      notificationPrefs: !!notePref,
      outlook: healthSource.some((i: any) => i.provider === 'outlook' || i.provider === 'microsoft'),
      slack: healthSource.some((i: any) => i.provider === 'slack'),
      calendar: (calEvents.count || 0) > 0,
    }
    const adoptedCount = Object.values(featureAdoption).filter(Boolean).length
    const totalFeatures = Object.keys(featureAdoption).length

    // 6. Unprocessed backlog alerts
    const backlogAlerts: { type: string; count: number; message: string }[] = []
    if (emailData.filter(e => !e.processed).length > 10) {
      backlogAlerts.push({ type: 'email', count: emailData.filter(e => !e.processed).length, message: `${emailData.filter(e => !e.processed).length} unprocessed emails in queue` })
    }
    if (slackData.filter(s => !s.processed).length > 10) {
      backlogAlerts.push({ type: 'slack', count: slackData.filter(s => !s.processed).length, message: `${slackData.filter(s => !s.processed).length} unprocessed Slack messages` })
    }
    if (syncHealth.some(s => s.stale)) {
      backlogAlerts.push({ type: 'sync', count: 0, message: `Data sync is stale (3+ days) for ${syncHealth.filter(s => s.stale).map(s => s.provider).join(', ')}` })
    }
    if (syncHealth.some(s => s.tokenExpired)) {
      backlogAlerts.push({ type: 'token', count: 0, message: `Token expired for ${syncHealth.filter(s => s.tokenExpired).map(s => s.provider).join(', ')}` })
    }

    // 7. Team health — teammate count & active teammates
    let teamHealth: { totalMembers: number; activeMembers: number; invitedCount: number } | null = null
    if (userTeamId) {
      const { data: allMembers } = await adminDb.from('profiles').select('id, created_at').eq('current_team_id', userTeamId)
      const { count: inviteCount } = await adminDb.from('invitations').select('id', { count: 'exact', head: true }).eq('team_id', userTeamId)
      const activeCount = (allMembers || []).filter(m => {
        // Consider active if account created in last 30 days (for new users) — real activity tracking would need a separate table
        const created = new Date(m.created_at)
        return (now.getTime() - created.getTime()) < 30 * 24 * 60 * 60 * 1000 || m.id === userId
      }).length
      teamHealth = {
        totalMembers: (allMembers || []).length,
        activeMembers: activeCount,
        invitedCount: inviteCount || 0,
      }
    }

    // 8. Admin notes — stored in profiles metadata or a custom query
    const { data: adminNotes } = await adminDb
      .from('profiles')
      .select('admin_notes')
      .eq('id', userId)
      .single()

    return NextResponse.json({
      profile: resolvedProfile,
      integrations: resolvedIntegrations,
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
      integrationHealth,
      dataMigration: {
        emails: { total: emailsWithUserId.count || 0, unowned: emailsWithoutUserId.count || 0 },
        calendar: { total: calWithUserId.count || 0, unowned: calWithoutUserId.count || 0 },
        slack: { total: slackData.length, processed: slackData.filter(s => s.processed).length },
      },
      activityLog: {
        lastSignIn,
        accountCreated: resolvedProfile.created_at,
        onboardingCompleted: resolvedProfile.onboarding_completed,
        onboardingStep: resolvedProfile.onboarding_step,
      },
      organization: {
        id: orgId,
        domains: orgDomains,
      },
      recentActivity: {
        commitments: recentCommitments.data || [],
        waitingRoom: recentWaiting.data || [],
        emails: recentEmails.data || [],
      },
      // New customer success fields
      engagement: {
        lastActiveDate: lastActiveDate?.toISOString() || null,
        daysSinceActive,
        timeToValue,
        weeklyTrend,
        gamificationScore: scoreData?.total_score || 0,
        streakWeeks: scoreData?.streak_weeks || 0,
      },
      syncHealth,
      featureAdoption: {
        features: featureAdoption,
        adoptedCount,
        totalFeatures,
      },
      backlogAlerts,
      teamHealth,
      adminNotes: adminNotes?.admin_notes || null,
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
          .select('*')
          .eq('id', userId)
          .single(),
        adminDb
          .from('integrations')
          .select('provider')
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

export const dynamic = 'force-dynamic'
