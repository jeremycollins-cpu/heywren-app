import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  try {
    // Exchange code for token
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
      }).toString(),
    })

    const data = await response.json()

    if (!data.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to get access token' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Store the integration
    const { error } = await supabase.from('integrations').insert({
      team_id: state, // You'd want to get this from session
      provider: 'slack',
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      config: {
        bot_id: data.bot_user_id,
        team_id: data.team.id,
        team_name: data.team.name,
      },
    })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to store integration' },
        { status: 500 }
      )
    }

    return NextResponse.redirect(
      new URL('/dashboard/integrations?status=success', request.url)
    )
  } catch (err) {
    console.error('Slack OAuth error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
