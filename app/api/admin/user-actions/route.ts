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

    // Now trigger a fresh sync
    const { data: integrations } = await adminDb
      .from('integrations')
      .select('id, team_id, user_id, provider, access_token, refresh_token, config')
      .eq('user_id', userId)

    for (const integration of integrations || []) {
      if (integration.provider === 'outlook' || integration.provider === 'microsoft') {
        try {
          const { syncTeamOutlook } = await import('@/inngest/functions/sync-outlook')
          const result = await syncTeamOutlook(adminDb, integration.team_id, userId, integration)
          const r = result as any
          results.push(`Re-synced: ${r.newEmails || r.emails || 0} emails, ${r.calendarEvents || 0} calendar events`)
        } catch (err) {
          results.push(`Sync failed: ${(err as Error).message}`)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Clear & re-sync for ${profile.email}: ${results.join('; ')}`,
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

  // Full re-sync: fetch fresh data from Outlook/Slack APIs for a user
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
      .select('id, team_id, user_id, provider, access_token, refresh_token, config')
      .eq('user_id', userId)

    if (!integrations?.length) {
      return NextResponse.json({ error: 'User has no integrations' }, { status: 400 })
    }

    const results: string[] = []
    const errors: string[] = []

    // Full resync fetches 90 days of data (not the default 1-day daily sync window)
    const RESYNC_DAYS = 90

    for (const integration of integrations) {
      if (integration.provider === 'outlook' || integration.provider === 'microsoft') {
        try {
          const { syncTeamOutlook } = await import('@/inngest/functions/sync-outlook')
          const result = await syncTeamOutlook(adminDb, integration.team_id, userId, integration, { daysBack: RESYNC_DAYS })
          const r = result as any
          results.push(`Outlook sync (${RESYNC_DAYS}d): ${r.newEmails || r.emails || 0} new emails, ${r.calendarEvents || 0} calendar events`)
        } catch (err) {
          errors.push(`Outlook sync failed: ${(err as Error).message}`)
        }
      }

      if (integration.provider === 'slack') {
        results.push('Slack: use the Sync page in the user\'s dashboard for full Slack backfill')
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      message: `Re-sync for ${profile.email}: ${[...results, ...errors].join('; ')}`,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export const dynamic = 'force-dynamic'
