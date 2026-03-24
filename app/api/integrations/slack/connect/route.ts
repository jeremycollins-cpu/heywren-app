import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    const supabase = getAdminClient()

    // Look up team: team_members → profiles → create if needed
    let teamId: string | null = null

    const { data: members } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    if (members && members.length > 0) {
      teamId = members[0].team_id
    }

    if (!teamId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', userId)
        .single()

      if (profile?.current_team_id) {
        teamId = profile.current_team_id
      }
    }

    if (!teamId) {
      // Create a team for this user
      const slug = `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const { data: newTeam, error: teamError } = await supabase
        .from('teams')
        .insert({ name: 'My Team', slug })
        .select()
        .single()

      if (teamError) {
        console.error('Failed to create team during Slack OAuth:', teamError)
      }

      if (newTeam) {
        teamId = newTeam.id
        const { error: memberError } = await supabase
          .from('team_members')
          .insert({ team_id: teamId, user_id: userId, role: 'owner' })
        if (memberError) {
          console.error('Failed to create team member during Slack OAuth:', memberError)
        }
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ current_team_id: teamId })
          .eq('id', userId)
        if (profileError) {
          console.error('Failed to update profile during Slack OAuth:', profileError)
        }
      }
    }

    if (!teamId) {
      return NextResponse.json({ error: 'Could not resolve team' }, { status: 400 })
    }

    // Upsert the integration (update if exists)
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
