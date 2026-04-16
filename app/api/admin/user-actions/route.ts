import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'
import { generateThemes } from '@/lib/ai/generate-themes'
import { sanitizeFilterValue as sf } from '@/lib/supabase/sanitize-filter'
import { mergeDuplicateCommitments, findDuplicateCommitments } from '@/lib/ai/dedup-commitments'

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

export async function POST(request: NextRequest) {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const adminDb = getAdminClient()
  const body = await request.json()
  const { action, userId, teamId } = body

  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  // Reset processed flags for a user's messages
  if (action === 'reset_processed') {
    if (!teamId) return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })

    const [emailResult, slackResult] = await Promise.all([
      adminDb.from('outlook_messages')
        .update({ processed: false, commitments_found: 0 })
        .eq('team_id', teamId),
      adminDb.from('slack_messages')
        .update({ processed: false, commitments_found: 0 })
        .eq('team_id', teamId),
    ])

    return NextResponse.json({
      success: true,
      message: 'Reset processed flags for all messages in team',
      errors: [emailResult.error?.message, slackResult.error?.message].filter(Boolean),
    })
  }

  // Trigger backfill for a user — calls backfill APIs directly using service role
  if (action === 'trigger_backfill') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('current_team_id, email')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'User has no team assigned' }, { status: 400 })
    }

    const teamId = profile.current_team_id

    // Get user's integrations to know what to backfill
    const { data: integrations } = await adminDb
      .from('integrations')
      .select('provider, access_token, refresh_token')
      .eq('team_id', teamId)
      .eq('user_id', userId)

    const results: string[] = []
    const errors: string[] = []

    for (const integration of integrations || []) {
      if (integration.provider === 'outlook' || integration.provider === 'microsoft') {
        // Reset processed flags for this user's outlook messages
        await adminDb.from('outlook_messages')
          .update({ processed: false, commitments_found: 0 })
          .eq('team_id', teamId)
          .eq('user_id', userId)
        results.push('Reset Outlook processed flags')
      }
      if (integration.provider === 'slack') {
        // Reset processed flags for slack messages in this team
        // (slack messages use slack_user_id, not auth user_id, so scope by team)
        await adminDb.from('slack_messages')
          .update({ processed: false, commitments_found: 0 })
          .eq('team_id', teamId)
        results.push('Reset Slack processed flags')
      }
    }

    // Clear existing commitments so they can be re-detected
    if (body.clearCommitments) {
      await adminDb.from('commitments').delete().eq('team_id', teamId)
      results.push('Cleared existing commitments')
    }

    return NextResponse.json({
      success: true,
      message: `Triggered reprocessing for ${profile.email}: ${results.join(', ')}. The next scheduled cron run will reprocess all messages.`,
    })
  }

  // Fix onboarding status
  if (action === 'fix_onboarding') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { error } = await adminDb
      .from('profiles')
      .update({ onboarding_completed: true, onboarding_step: 'complete' })
      .eq('id', userId)

    return NextResponse.json({
      success: !error,
      message: error ? `Failed: ${error.message}` : 'Onboarding marked as complete',
    })
  }

  // Set user role
  if (action === 'set_role') {
    if (!userId || !body.role) return NextResponse.json({ error: 'Missing userId or role' }, { status: 400 })
    if (!['user', 'admin', 'super_admin'].includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const { error } = await adminDb
      .from('profiles')
      .update({ role: body.role })
      .eq('id', userId)

    return NextResponse.json({
      success: !error,
      message: error ? `Failed: ${error.message}` : `Role updated to ${body.role}`,
    })
  }

  // Delete user completely
  if (action === 'delete_user') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    // Remove from team_members, organization_members, then delete profile and auth user
    await adminDb.from('team_members').delete().eq('user_id', userId)
    await adminDb.from('organization_members').delete().eq('user_id', userId)
    await adminDb.from('profiles').delete().eq('id', userId)

    const { error } = await adminDb.auth.admin.deleteUser(userId)

    return NextResponse.json({
      success: !error,
      message: error ? `Failed to delete auth user: ${error.message}` : 'User completely deleted',
    })
  }

  // Force token refresh for a user's integration
  if (action === 'refresh_token') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    const provider = body.provider || 'outlook'

    const { data: integration } = await adminDb
      .from('integrations')
      .select('id, access_token, refresh_token, config')
      .eq('user_id', userId)
      .eq('provider', provider)
      .limit(1)
      .single()

    if (!integration?.refresh_token) {
      return NextResponse.json({ error: `No ${provider} integration or refresh token found` }, { status: 404 })
    }

    try {
      if (provider === 'outlook' || provider === 'microsoft') {
        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID!,
            client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
            refresh_token: integration.refresh_token,
            grant_type: 'refresh_token',
          }),
        })
        const tokenData = await tokenRes.json()
        if (tokenData.access_token) {
          await adminDb.from('integrations').update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || integration.refresh_token,
          }).eq('id', integration.id)
          return NextResponse.json({ success: true, message: `${provider} token refreshed successfully` })
        }
        return NextResponse.json({ error: `Token refresh failed: ${tokenData.error_description || tokenData.error}` }, { status: 400 })
      }
      return NextResponse.json({ error: `Token refresh not supported for ${provider}` }, { status: 400 })
    } catch (err) {
      return NextResponse.json({ error: `Token refresh error: ${(err as Error).message}` }, { status: 500 })
    }
  }

  // Clear & re-sync: wipe user's data and re-fetch fresh
  if (action === 'clear_resync') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('current_team_id, email')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'User has no team assigned' }, { status: 400 })
    }

    const results: string[] = []

    // Delete user's outlook data
    const { count: emailsDeleted } = await adminDb.from('outlook_messages')
      .delete({ count: 'exact' }).eq('team_id', profile.current_team_id).eq('user_id', userId)
    results.push(`Deleted ${emailsDeleted || 0} emails`)

    const { count: calDeleted } = await adminDb.from('outlook_calendar_events')
      .delete({ count: 'exact' }).eq('team_id', profile.current_team_id).eq('user_id', userId)
    results.push(`Deleted ${calDeleted || 0} calendar events`)

    // Also delete old null user_id rows for this team
    const { count: nullEmailsDeleted } = await adminDb.from('outlook_messages')
      .delete({ count: 'exact' }).eq('team_id', profile.current_team_id).is('user_id', null)
    if (nullEmailsDeleted) results.push(`Deleted ${nullEmailsDeleted} legacy emails (no user_id)`)

    const { count: nullCalDeleted } = await adminDb.from('outlook_calendar_events')
      .delete({ count: 'exact' }).eq('team_id', profile.current_team_id).is('user_id', null)
    if (nullCalDeleted) results.push(`Deleted ${nullCalDeleted} legacy calendar events (no user_id)`)

    // Fire background resync via Inngest
    await inngest.send({
      name: 'admin/full-resync',
      data: { userId, teamId: profile.current_team_id },
    })
    results.push('Background re-sync started (90 days)')

    return NextResponse.json({
      success: true,
      message: `Clear & re-sync for ${profile.email}: ${results.join('; ')}. Check Inngest dashboard for sync progress.`,
    })
  }

  // Manage company domains for any organization
  if (action === 'update_domains') {
    const orgId = body.organizationId
    const domains = body.domains
    if (!orgId || !Array.isArray(domains)) {
      return NextResponse.json({ error: 'Missing organizationId or domains array' }, { status: 400 })
    }

    const cleanDomains = domains.map((d: string) => d.trim().toLowerCase().replace(/^@/, '')).filter((d: string) => d && d.includes('.'))
    const { error } = await adminDb.from('organizations').update({
      domain: cleanDomains[0] || null,
      allowed_domains: cleanDomains,
    }).eq('id', orgId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, message: `Domains updated: ${cleanDomains.join(', ') || 'none'}` })
  }

  // Send password reset email
  if (action === 'send_password_reset') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()

    if (!profile?.email) return NextResponse.json({ error: 'User has no email' }, { status: 404 })

    const { error } = await adminDb.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
    })

    if (error) return NextResponse.json({ error: `Failed: ${error.message}` }, { status: 500 })
    return NextResponse.json({ success: true, message: `Password reset email sent to ${profile.email}` })
  }

  // Generate magic link for impersonation
  if (action === 'generate_magic_link') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()

    if (!profile?.email) return NextResponse.json({ error: 'User has no email' }, { status: 404 })

    const { data, error } = await adminDb.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
    })

    if (error || !data) return NextResponse.json({ error: `Failed: ${error?.message || 'Unknown error'}` }, { status: 500 })

    const link = data.properties?.action_link || ''
    return NextResponse.json({ success: true, message: `Magic link generated for ${profile.email}`, link })
  }

  // Full re-sync: fire background Inngest job — returns immediately
  if (action === 'full_resync') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('current_team_id, email')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'User has no team assigned' }, { status: 400 })
    }

    const { data: integrations } = await adminDb
      .from('integrations')
      .select('id, provider')
      .eq('user_id', userId)

    if (!integrations?.length) {
      return NextResponse.json({ error: 'User has no integrations' }, { status: 400 })
    }

    // Fire Inngest event — runs in background, won't timeout
    await inngest.send({
      name: 'admin/full-resync',
      data: { userId, teamId: profile.current_team_id },
    })

    const providers = integrations.map(i => i.provider).join(', ')
    return NextResponse.json({
      success: true,
      message: `Full re-sync started in background for ${profile.email} (${providers}). This will sync 90 days of data — check Inngest dashboard for progress.`,
    })
  }

  // Clear stuck messages: mark all unprocessed as processed immediately
  if (action === 'clear_stuck') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('current_team_id, email, slack_user_id')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'User has no team assigned' }, { status: 400 })
    }

    const results: string[] = []

    // Mark all unprocessed emails as processed
    const { count: emailsCleared } = await adminDb
      .from('outlook_messages')
      .update({ processed: true, commitments_found: 0 }, { count: 'exact' })
      .eq('team_id', profile.current_team_id)
      .or(`user_id.eq.${userId},user_id.is.null`)
      .eq('processed', false)
    results.push(`${emailsCleared || 0} stuck emails cleared`)

    // Mark all unprocessed Slack messages as processed
    const slackFilter = profile.slack_user_id
      ? adminDb.from('slack_messages')
          .update({ processed: true, commitments_found: 0 }, { count: 'exact' })
          .eq('team_id', profile.current_team_id)
          .eq('processed', false)
      : null

    if (slackFilter) {
      const { count: slackCleared } = await slackFilter
      results.push(`${slackCleared || 0} stuck Slack messages cleared`)
    }

    return NextResponse.json({
      success: true,
      message: `Cleared stuck messages for ${profile.email}: ${results.join(', ')}`,
    })
  }

  // Send a test email to a user using one of the engagement templates
  if (action === 'send_test_email') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    const template = body.template || 'recap'

    const { data: profile } = await adminDb.from('profiles').select('email, full_name').eq('id', userId).single()

    // Fall back to auth.users if profile doesn't have an email
    let userEmail = profile?.email || ''
    let userName = profile?.full_name?.split(' ')[0] || 'there'
    if (!userEmail) {
      try {
        const { data: authUser } = await adminDb.auth.admin.getUserById(userId)
        userEmail = authUser?.user?.email || ''
        if (!userName || userName === 'there') {
          userName = authUser?.user?.user_metadata?.full_name?.split(' ')[0] || authUser?.user?.user_metadata?.name?.split(' ')[0] || 'there'
        }
      } catch { /* auth lookup failed */ }
    }
    if (!userEmail) return NextResponse.json({ error: 'User has no email in profiles or auth.users' }, { status: 400 })

    const { Resend } = await import('resend')
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })

    const resend = new Resend(apiKey)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'
    const unsubscribeUrl = `${appUrl}/settings?tab=notifications`

    let subject: string
    let html: string

    if (template === 'welcome') {
      const { buildWelcomeDay0 } = await import('@/lib/email/templates/welcome')
      const result = buildWelcomeDay0({ userName, appUrl, unsubscribeUrl })
      subject = result.subject; html = result.html
    } else if (template === 'recap') {
      const { buildWeeklyRecapEmail } = await import('@/lib/email/templates/weekly-recap')
      const result = buildWeeklyRecapEmail({
        userName, weekLabel: 'Mar 31 – Apr 6', totalPoints: 247, pointsDelta: 42,
        rank: 3, rankDelta: 2, streak: 8, commitmentsCompleted: 12, commitmentsCreated: 15,
        overdueCount: 2, onTimeRate: 88, responseRate: 94,
        achievementEarned: { name: 'Follow-Through Pro', tier: 'silver' },
        insight: 'Your points jumped 20% compared to last week. Great momentum!',
        dashboardUrl: `${appUrl}/dashboard`, overdueUrl: `${appUrl}/commitments?status=overdue`, unsubscribeUrl,
      })
      subject = result.subject; html = result.html
    } else if (template === 'nudge') {
      const { buildNudgeEmail } = await import('@/lib/email/templates/nudge')
      const result = buildNudgeEmail({ userName, overdueCount: 3, oldestOverdueDays: 5, dashboardUrl: `${appUrl}/commitments?status=overdue`, unsubscribeUrl })
      subject = result.subject; html = result.html
    } else if (template === 'achievement') {
      const { buildAchievementEmail } = await import('@/lib/email/templates/achievement')
      const result = buildAchievementEmail({
        userName, achievementName: 'Follow-Through Pro', achievementDescription: 'Complete 50 commitments on time',
        tier: 'silver', reason: 'You earned this by reaching 50 on-time completions.',
        nextAchievement: { name: 'Follow-Through Master', progress: 50, target: 100 },
        dashboardUrl: appUrl, unsubscribeUrl,
      })
      subject = result.subject; html = result.html
    } else if (template === 'manager') {
      const { buildManagerBriefingEmail } = await import('@/lib/email/templates/manager-briefing')
      const result = buildManagerBriefingEmail({
        managerName: userName, orgName: 'Your Organization', weekLabel: 'Mar 31 – Apr 6',
        memberCount: 12, totalPoints: 1840, pointsDeltaPct: 15, totalCompleted: 47,
        totalOverdue: 5, avgResponseRate: 89, avgOnTimeRate: 82, activeStreaks: 8,
        topPerformers: [{ name: 'Alice', points: 310 }, { name: 'Bob', points: 275 }, { name: 'Carol', points: 240 }],
        burnoutAlerts: 1, unresolvedAlerts: 2, newAchievements: 4,
        dashboardUrl: `${appUrl}/team-dashboard`, peopleInsightsUrl: `${appUrl}/people-insights`, unsubscribeUrl,
      })
      subject = result.subject; html = result.html
    } else if (template === 'reengagement') {
      const { buildReengagementEmail } = await import('@/lib/email/templates/reengagement')
      const result = buildReengagementEmail({
        userName, daysSinceLastActive: 9, commitmentsDetected: 6, overdueCount: 3, missedEmailCount: 4,
        dashboardUrl: `${appUrl}/dashboard`, settingsUrl: `${appUrl}/settings?tab=notifications`, unsubscribeUrl,
      })
      subject = result.subject; html = result.html
    } else {
      return NextResponse.json({ error: `Unknown template: ${template}` }, { status: 400 })
    }

    try {
      const { data, error } = await resend.emails.send({
        from: 'HeyWren <notifications@heywren.ai>',
        replyTo: 'Wren <wren@heywren.ai>',
        to: userEmail,
        subject: `[TEST] ${subject}`,
        html,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, message: `Test "${template}" email sent to ${userEmail} (${data?.id})` })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
  }

  // Save admin notes for a user
  if (action === 'save_notes') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    const notes = body.notes ?? ''

    const { error } = await adminDb
      .from('profiles')
      .update({ admin_notes: notes })
      .eq('id', userId)

    if (error) {
      // If column doesn't exist yet, tell the user to add it
      if (error.code === '42703') {
        return NextResponse.json({
          error: 'admin_notes column not found. Run: ALTER TABLE profiles ADD COLUMN admin_notes text;',
        }, { status: 500 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Notes saved' })
  }

  if (action === 'refresh_signal') {
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const { data: profile } = await adminDb
      .from('profiles')
      .select('current_team_id, email, full_name, display_name, slack_user_id')
      .eq('id', userId)
      .single()

    let targetTeamId = profile?.current_team_id
    if (!targetTeamId) {
      const { data: membership } = await adminDb
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()
      targetTeamId = membership?.team_id || null
    }

    if (!targetTeamId) {
      return NextResponse.json({ success: false, message: 'User has no team — cannot generate Signal' })
    }

    const userEmail = profile?.email?.toLowerCase() || ''
    const userName = profile?.full_name || profile?.display_name || profile?.email?.split('@')[0] || 'User'
    const slackUserId = profile?.slack_user_id
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    const safeQuery = async <T>(fn: () => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> => {
      try {
        const { data, error } = await fn()
        if (error) return []
        return data || []
      } catch { return [] }
    }

    const [commitmentData, emailData, calendarData, slackData] = await Promise.all([
      safeQuery(() =>
        adminDb.from('commitments')
          .select('title, status, source, source_ref, created_at, metadata')
          .eq('team_id', targetTeamId)
          .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(80)
      ),
      userEmail
        ? safeQuery(() =>
            adminDb.from('outlook_messages')
              .select('subject, from_name, from_email, to_recipients, received_at')
              .eq('team_id', targetTeamId)
              .or(`user_id.eq.${userId},user_id.is.null`)
              .or(`from_email.eq.${sf(userEmail)},to_recipients.ilike.%${sf(userEmail)}%`)
              .gte('received_at', thirtyDaysAgo)
              .order('received_at', { ascending: false })
              .limit(100)
          )
        : Promise.resolve([]),
      safeQuery(() =>
        adminDb.from('outlook_calendar_events')
          .select('subject, organizer_email, start_time, attendees')
          .eq('team_id', targetTeamId)
          .or(`user_id.eq.${userId},user_id.is.null`)
          .gte('start_time', thirtyDaysAgo)
          .order('start_time', { ascending: false })
          .limit(60)
      ),
      slackUserId
        ? safeQuery(() =>
            adminDb.from('slack_messages')
              .select('channel_id, message_text, created_at')
              .eq('team_id', targetTeamId)
              .eq('user_id', slackUserId)
              .gte('created_at', thirtyDaysAgo)
              .order('created_at', { ascending: false })
              .limit(60)
          )
        : Promise.resolve([]),
    ])

    const userCalendarData = userEmail
      ? calendarData.filter((evt: any) => {
          if ((evt.organizer_email || '').toLowerCase() === userEmail) return true
          return JSON.stringify(evt.attendees || '').toLowerCase().includes(userEmail)
        })
      : []

    const totalPoints = commitmentData.length + emailData.length + userCalendarData.length + slackData.length
    if (totalPoints < 5) {
      return NextResponse.json({
        success: false,
        message: `Not enough data to generate Signal (${totalPoints} data points, need at least 5)`,
      })
    }

    const themes = await generateThemes({
      userName,
      commitments: commitmentData.map((c: any) => ({
        title: c.title, status: c.status, source: c.source,
        created_at: c.created_at, metadata: c.metadata,
      })),
      recentEmails: emailData.map((e: any) => ({
        subject: e.subject || '(no subject)', from_name: e.from_name || e.from_email || 'Unknown',
        to_recipients: e.to_recipients || '', received_at: e.received_at,
      })),
      calendarEvents: userCalendarData.map((e: any) => ({
        subject: e.subject || '(no subject)', organizer_email: e.organizer_email || '',
        start_time: e.start_time, attendees_count: Array.isArray(e.attendees) ? e.attendees.length : 0,
      })),
      slackMessages: slackData.map((m: any) => ({
        channel_name: m.channel_id || 'unknown',
        message_preview: (m.message_text || '').slice(0, 150),
        created_at: m.created_at,
      })),
    })

    return NextResponse.json({
      success: true,
      message: `Signal regenerated for ${userName} — ${themes.themes.length} themes from ${totalPoints} data points`,
    })
  }

  if (action === 'dedup_commitments') {
    if (!teamId && !userId) return NextResponse.json({ error: 'Missing teamId or userId' }, { status: 400 })

    // If userId provided, get their team
    let targetTeamId = teamId
    if (!targetTeamId && userId) {
      const { data: profile } = await adminDb
        .from('profiles')
        .select('current_team_id')
        .eq('id', userId)
        .single()
      targetTeamId = profile?.current_team_id
    }

    if (!targetTeamId) {
      return NextResponse.json({ success: false, message: 'No team found' })
    }

    const { groups, totalDuplicates } = await findDuplicateCommitments(adminDb, targetTeamId)

    if (totalDuplicates === 0) {
      return NextResponse.json({ success: true, message: 'No duplicate commitments found' })
    }

    const result = await mergeDuplicateCommitments(adminDb, targetTeamId)
    return NextResponse.json({
      success: true,
      message: `Merged ${result.merged} duplicate commitments across ${result.groups} groups`,
    })
  }

  // Toggle enterprise billing mode for an organization
  if (action === 'set_billing_type') {
    const billingType = body.billingType as string
    if (!billingType || !['stripe', 'enterprise', 'trial'].includes(billingType)) {
      return NextResponse.json({ error: 'Invalid billing_type' }, { status: 400 })
    }

    // Find the user's organization
    const { data: membership } = await adminDb
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (!membership?.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 400 })
    }

    const updates: Record<string, any> = { billing_type: billingType }
    // Enterprise accounts get unlimited seats and active status
    if (billingType === 'enterprise') {
      updates.subscription_plan = 'team'
      updates.subscription_status = 'active'
      updates.max_users = 500
    }

    const { error } = await adminDb
      .from('organizations')
      .update(updates)
      .eq('id', membership.organization_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Also update the team
    const { data: team } = await adminDb
      .from('teams')
      .select('id')
      .eq('organization_id', membership.organization_id)
      .limit(1)
      .single()

    if (team) {
      const teamUpdates: Record<string, any> = {}
      if (billingType === 'enterprise') {
        teamUpdates.subscription_plan = 'team'
        teamUpdates.subscription_status = 'active'
        teamUpdates.max_users = 500
      }
      if (Object.keys(teamUpdates).length > 0) {
        await adminDb.from('teams').update(teamUpdates).eq('id', team.id)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Billing type set to ${billingType}${billingType === 'enterprise' ? ' — plan upgraded to team, 500 seat limit' : ''}`,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export const dynamic = 'force-dynamic'
