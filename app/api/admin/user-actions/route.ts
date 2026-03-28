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
        // Reset processed flags for outlook messages
        await adminDb.from('outlook_messages')
          .update({ processed: false, commitments_found: 0 })
          .eq('team_id', teamId)
        results.push('Reset Outlook processed flags')
      }
      if (integration.provider === 'slack') {
        // Reset processed flags for slack messages
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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export const dynamic = 'force-dynamic'
