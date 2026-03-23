import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
 
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
 
  console.log('=== ADMIN CLIENT DEBUG ===')
  console.log('SUPABASE_URL set:', !!url)
  console.log('SERVICE_ROLE_KEY set:', !!key)
  console.log('SERVICE_ROLE_KEY starts with:', key ? key.substring(0, 10) + '...' : 'NOT SET')
 
  return createClient(url!, key!)
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
      console.log('State parsed - userId:', userId, 'teamId:', teamId)
    } catch (e) {
      console.error('Failed to parse state:', e)
    }
  }
 
  if (!userId) {
    return NextResponse.json({ error: 'Missing user context.' }, { status: 400 })
  }
 
  const supabase = getAdminClient()
 
  // Step 1: Try profile
  if (!teamId) {
    console.log('Step 1: Looking up profile for user:', userId)
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()
 
    console.log('Profile result:', JSON.stringify(profile))
    console.log('Profile error:', JSON.stringify(profileErr))
 
    if (profile?.current_team_id) {
      teamId = profile.current_team_id
      console.log('Found teamId from profile:', teamId)
    }
  }
 
  // Step 2: Try team_members
  if (!teamId) {
    console.log('Step 2: Looking up team_members for user:', userId)
    const { data: members, error: memberErr } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
 
    console.log('Members result:', JSON.stringify(members))
    console.log('Members error:', JSON.stringify(memberErr))
 
    if (members && members.length > 0) {
      teamId = members[0].team_id
      console.log('Found teamId from team_members:', teamId)
    }
  }
 
  // Step 3: Try creating a team
  if (!teamId) {
    console.log('Step 3: Creating new team for user:', userId)
    const { data: newTeam, error: teamErr } = await supabase
      .from('teams')
      .insert([{ name: 'My Team', slug: 'team-' + Date.now() }])
      .select()
      .single()
 
    console.log('New team result:', JSON.stringify(newTeam))
    console.log('New team error:', JSON.stringify(teamErr))
 
    if (newTeam && !teamErr) {
      teamId = newTeam.id
 
      const { error: memberInsertErr } = await supabase.from('team_members').insert([{
        team_id: newTeam.id,
        user_id: userId,
        role: 'owner',
      }])
      console.log('Member insert error:', JSON.stringify(memberInsertErr))
 
      const { error: profileUpdateErr } = await supabase.from('profiles').update({
        current_team_id: newTeam.id,
      }).eq('id', userId)
      console.log('Profile update error:', JSON.stringify(profileUpdateErr))
    }
  }
 
  if (!teamId) {
    return NextResponse.json({
      error: 'Could not find or create a team. Check Vercel logs for details.',
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
    console.log('Slack exchange ok:', data.ok, 'error:', data.error)
 
    if (!data.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to get access token' },
        { status: 400 }
      )
    }
 
    console.log('Inserting integration with teamId:', teamId)
    const { error: insertErr } = await supabase.from('integrations').insert({
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
 
    if (insertErr) {
      console.error('Integration insert error:', JSON.stringify(insertErr))
      return NextResponse.json({ error: 'Failed to store integration: ' + insertErr.message }, { status: 500 })
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
 
