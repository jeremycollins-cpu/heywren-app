import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(url, key)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  let userId: string | null = null
  let teamId: string | null = null
  let redirect = 'dashboard'

  if (state) {
    try {
      const stateData = JSON.parse(atob(state))
      userId = stateData.userId || null
      teamId = stateData.teamId || null
      redirect = stateData.redirect || 'dashboard'
    } catch (e) {
      console.error('Failed to parse state:', e)
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Missing user context.' }, { status: 400 })
  }

  const supabase = getAdminClient()

  // Step 1: Use teamId from state if provided
  // (already set above from state parsing)

  // Step 2: Try team_members table (most reliable — no dependency on current_team_id column)
  if (!teamId) {
    const { data: members, error: memberErr } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    if (members && members.length > 0) {
      teamId = members[0].team_id
    }
  }

  // Step 3: Try profile current_team_id (may not exist on all schemas)
  if (!teamId) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', userId)
        .single()

      if (profile && profile.current_team_id) {
        teamId = profile.current_team_id
      }
    } catch (e) {
      // Column might not exist — that is OK, we continue
    }
  }

  // Step 4: Create a new team — MUST include owner_id (NOT NULL in DB)
  if (!teamId) {
    const { data: newTeam, error: teamErr } = await supabase
      .from('teams')
      .insert([{
        name: 'My Team',
        slug: 'team-' + Date.now(),
        owner_id: userId
      }])
      .select()
      .single()

    if (newTeam && !teamErr) {
      teamId = newTeam.id

      await supabase.from('team_members').insert([{
        team_id: newTeam.id,
        user_id: userId,
        role: 'owner',
      }])

      // Try to update profile — column might not exist yet
      try {
        await supabase.from('profiles').update({
          current_team_id: newTeam.id,
        }).eq('id', userId)
      } catch (e) {
        // OK if current_team_id column does not exist
      }
    } else {
      console.error('Team creation error:', JSON.stringify(teamErr))
    }
  }

  if (!teamId) {
    return NextResponse.json({
      error: 'Could not find or create a team. Please run the database migration first.',
    }, { status: 400 })
  }

  try {
    const redirectUri = 'https://app.heywren.ai/api/integrations/slack/connect'

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })

    const data = await response.json()

    if (!data.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to get access token' },
        { status: 400 }
      )
    }

    // Upsert integration — handles reconnecting existing Slack
    const { error: upsertErr } = await supabase.from('integrations').upsert({
      team_id: teamId,
      provider: 'slack',
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      config: {
        bot_id: data.bot_user_id,
        slack_team_id: data.team ? data.team.id : null,
        slack_team_name: data.team ? data.team.name : null,
        connected_by: userId,
      },
    }, { onConflict: 'team_id,provider' })

    if (upsertErr) {
      console.error('Integration upsert error:', JSON.stringify(upsertErr))
      return NextResponse.json(
        { error: 'Failed to store integration: ' + upsertErr.message },
        { status: 500 }
      )
    }

    let redirectUrl = '/integrations?status=success'
    if (redirect === 'onboarding') {
      redirectUrl = '/onboarding/integrations?slack=connected'
    }

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('Slack OAuth error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
