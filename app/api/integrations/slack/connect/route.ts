import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'
import { ensureTeamForUser } from '@/lib/team/ensure-team'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  // Parse userId from state
  let userId: string | null = null
  let redirect = 'dashboard'
  try {
    if (state) {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
      userId = stateData.userId || null
      redirect = stateData.redirect || 'dashboard'
    }
  } catch (e) {
    console.error('Failed to parse state:', e)
  }

  if (!userId) {
    return NextResponse.json({ error: 'Missing user context. Please try connecting again.' }, { status: 400 })
  }

  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/connect`

    // Exchange code for token — include redirect_uri
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID || process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || '',
        client_secret: process.env.SLACK_CLIENT_SECRET || '',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })

    const data = await response.json()

    if (!data.ok) {
      console.error('Slack token exchange failed:', data.error)
      const errorRedirect = redirect === 'onboarding'
        ? '/onboarding/integrations?slack=error'
        : '/integrations?status=error'
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    // Validate token actually works before saving
    const slack = new WebClient(data.access_token)
    try {
      const authTest = await slack.auth.test()
      if (!authTest.ok) {
        console.error('Slack auth.test failed:', authTest.error)
        const errorRedirect = redirect === 'onboarding'
          ? '/onboarding/integrations?slack=error'
          : '/integrations?status=error'
        return NextResponse.redirect(new URL(errorRedirect, request.url))
      }
    } catch (testErr) {
      console.error('Slack token validation failed:', testErr)
      const errorRedirect = redirect === 'onboarding'
        ? '/onboarding/integrations?slack=error'
        : '/integrations?status=error'
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    // Resolve team using shared utility (handles all fallbacks + fixes inconsistencies)
    const { teamId } = await ensureTeamForUser(userId)

    // Upsert the integration (update if exists for this user)
    const supabase = getAdminClient()
    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        user_id: userId,
        provider: 'slack',
        access_token: data.access_token,
        refresh_token: data.refresh_token || null,
        config: {
          bot_id: data.bot_user_id,
          authed_user_id: data.authed_user?.id || null,
          slack_team_id: data.team?.id,
          slack_team_name: data.team?.name,
          connected_by: userId,
        },
      },
      { onConflict: 'team_id,user_id,provider' }
    )

    // Link the connecting user's Slack identity to their profile
    // so we can determine message relevance later
    if (data.authed_user?.id) {
      await supabase
        .from('profiles')
        .update({ slack_user_id: data.authed_user.id })
        .eq('id', userId)
    }

    // Auto-populate slack_user_id for ALL team members by matching emails
    // This runs in the background — don't block the redirect on it
    if (data.access_token) {
      autoPopulateSlackUserIds(supabase, data.access_token, teamId).catch(err =>
        console.error('Failed to auto-populate Slack user IDs:', err)
      )
    }

    if (upsertError) {
      console.error('Failed to store Slack integration:', upsertError)
      const errorRedirect = redirect === 'onboarding'
        ? '/onboarding/integrations?slack=error'
        : '/integrations?status=error'
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?slack=connected'
      : '/integrations?status=success'

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('Slack OAuth error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Fetch all Slack workspace members and match them to HeyWren profiles by email.
 * Sets slack_user_id on any profile that doesn't already have one.
 */
async function autoPopulateSlackUserIds(
  supabase: SupabaseClient,
  accessToken: string,
  teamId: string
) {
  const slack = new WebClient(accessToken)

  // Get all team members from HeyWren who are missing slack_user_id
  const { data: teamMembers } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)

  if (!teamMembers || teamMembers.length === 0) return

  const memberIds = teamMembers.map(m => m.user_id)

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, slack_user_id')
    .in('id', memberIds)

  if (!profiles || profiles.length === 0) return

  // Only process profiles that are missing slack_user_id
  const unmapped = profiles.filter(p => !p.slack_user_id && p.email)
  if (unmapped.length === 0) return

  // Build email → profile map for quick lookup
  const emailToProfile = new Map<string, { id: string }>(
    unmapped.map(p => [p.email!.toLowerCase(), { id: p.id }])
  )

  // Fetch Slack workspace members (paginated)
  let cursor: string | undefined
  let matched = 0
  do {
    const result = await slack.users.list({ cursor, limit: 200 })
    const members = result.members || []

    for (const member of members) {
      if (member.deleted || member.is_bot || member.id === 'USLACKBOT') continue

      const email = member.profile?.email?.toLowerCase()
      if (!email) continue

      const profile = emailToProfile.get(email)
      if (profile) {
        await supabase
          .from('profiles')
          .update({ slack_user_id: member.id })
          .eq('id', profile.id)
        matched++
        emailToProfile.delete(email) // Don't match again
        console.log(`Auto-mapped Slack user ${member.id} (${email}) → HeyWren profile ${profile.id}`)
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined
  } while (cursor && emailToProfile.size > 0)

  console.log(`Auto-populated slack_user_id for ${matched} team members`)
}
