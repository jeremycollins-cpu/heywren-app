import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const redirect = searchParams.get('redirect') || 'dashboard'

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    )
  }

  try {
    // Hardcode redirect_uri to eliminate any env var ambiguity
    const redirectUri = 'https://app.heywren.ai/api/integrations/slack/connect'

    console.log('=== SLACK OAUTH DEBUG ===')
    console.log('redirect_uri:', redirectUri)
    console.log('SLACK_CLIENT_ID set:', !!process.env.SLACK_CLIENT_ID)
    console.log('SLACK_CLIENT_SECRET set:', !!process.env.SLACK_CLIENT_SECRET)
    console.log('NEXT_PUBLIC_APP_URL:', process.env.NEXT_PUBLIC_APP_URL)

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

    console.log('Slack response ok:', data.ok)
    console.log('Slack response error:', data.error)

    if (!data.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to get access token' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get current user
    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Get user's current team
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', authData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json(
        { error: 'No team found' },
        { status: 400 }
      )
    }

    // Store the integration
    const { error } = await supabase.from('integrations').insert({
      team_id: profile.current_team_id,
      provider: 'slack',
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      config: {
        bot_id: data.bot_user_id,
        slack_team_id: data.team.id,
        slack_team_name: data.team.name,
      },
    })

    if (error) {
      console.error('Error storing integration:', error)
      return NextResponse.json(
        { error: 'Failed to store integration' },
        { status: 500 }
      )
    }

    // Determine redirect URL based on where the connection was initiated
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
