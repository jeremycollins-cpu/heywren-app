import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
      return NextResponse.json({ error: data.error || 'Failed to get access token' }, { status: 400 })
    }

    // Resolve team using shared utility (handles all fallbacks + fixes inconsistencies)
    const { teamId } = await ensureTeamForUser(userId)

    // Upsert the integration (update if exists)
    const supabase = getAdminClient()
    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        provider: 'slack',
        access_token: data.access_token,
        refresh_token: data.refresh_token || null,
        config: {
          bot_id: data.bot_user_id,
          slack_team_id: data.team?.id,
          slack_team_name: data.team?.name,
        },
      },
      { onConflict: 'team_id,provider' }
    )

    if (upsertError) {
      console.error('Failed to store Slack integration:', upsertError)
      return NextResponse.json({ error: 'Failed to store integration: ' + upsertError.message }, { status: 500 })
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
