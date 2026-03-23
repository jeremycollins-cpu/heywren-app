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
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    )
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
    console.error('Missing userId in state')
    return NextResponse.json(
      { error: 'Missing user context. Please try connecting again.' },
      { status: 400 }
    )
  }
 
  const supabase = getAdminClient()
 
  // If teamId is missing from state, look it up
  if (!teamId) {
    console.log('No teamId in state, looking up from profile for user:', userId)
 
    // Try profile first
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()
 
    if (profile?.current_team_id) {
      teamId = profile.current_team_id
    } else {
      // Try team_members table
      const { data: membership } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()
 
      if (membership?.team_id) {
        teamId = membership.team_id
      } else {
        // Last resort: create a team for this user
        console.log('No team found, creating one for user:', userId)
        const { data: newTeam } = await supabase
          .from('teams')
          .insert([{ name: 'My Team', slug: 'team-' + Date.now() }])
          .select()
          .single()
 
        if (newTeam) {
          teamId = newTeam.id
          await supabase.from('team_members').insert([{
            team_id: newTeam.id,
            user_id: userId,
            role: 'owner',
          }])
          await supabase.from('profiles').update({
            current_team_id: newTeam.id,
          }).eq('id', userId)
        }
      }
    }
  }
 
  if (!teamId) {
    console.error('Could not determine team for user:', userId)
    return NextResponse.json(
      { error: 'Could not find or create a team. Please contact support.' },
      { status: 400 }
    )
  }
 
  try {
    const redirectUri = 'https://app.heywren.ai/api/integrations/slack/connect'
 
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })
 
    const data = await response.json()
 
    if (!data.ok) {
      console.error('Slack token exchange failed:', data.error)
      return NextResponse.json(
        { error: data.error || 'Failed to get access token' },
        { status: 400 }
      )
    }
 
    const { error } = await supabase.from('integrations').insert({
      team_id: teamId,
      provider: 'slack',
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      config: {
        bot_id: data.bot_user_id,
        slack_team_id: data.team?.id,
        slack_team_name: data.team?.name,
        connected_by: userId,
      },
    })
 
    if (error) {
      console.error('Error storing integration:', error)
      return NextResponse.json(
        { error: 'Failed to store integration' },
        { status: 500 }
      )
    }
 
    let redirectUrl = '/integrations?status=success'
    if (redirect === 'onboarding') {
      redirectUrl = '/onboarding/integrations?slack=connected'
    }
 
    return NextResponse.redirect(
      new URL(redirectUrl, request.url)
    )
  } catch (err) {
    console.error('Slack OAuth error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
