import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabaseAdmin = getAdminClient()
  try {
    // Authenticate the user via session
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id

    // Get team_id from profile (using admin client to bypass RLS)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    let teamId = profile?.current_team_id || null

    // Fallback: check team_members directly
    if (!teamId) {
      const { data: membership } = await supabaseAdmin
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (membership?.team_id) {
        teamId = membership.team_id
      }
    }

    if (!teamId) {
      return NextResponse.json(
        { error: 'No team found for user' },
        { status: 404 }
      )
    }

    // Get the Slack integration with access token
    const { data: integration, error: intError } = await supabaseAdmin
      .from('integrations')
      .select('access_token')
      .eq('team_id', teamId)
      .eq('provider', 'slack')
      .single()

    if (intError || !integration) {
      return NextResponse.json(
        { error: 'No Slack integration found. Please connect Slack first.' },
        { status: 404 }
      )
    }

    if (!integration.access_token) {
      return NextResponse.json(
        { error: 'Slack access token is missing. Please reconnect Slack.' },
        { status: 400 }
      )
    }

    // Fetch channels from Slack
    const slack = new WebClient(integration.access_token)

    const result = await slack.conversations.list({
      types: 'public_channel',
      limit: 200,
      exclude_archived: true,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch channels from Slack' },
        { status: 502 }
      )
    }

    const channels = (result.channels || []).map((ch) => ({
      id: ch.id!,
      name: ch.name!,
      num_members: ch.num_members ?? 0,
      is_member: ch.is_member ?? false,
    }))

    // Sort by member count descending so most active channels appear first
    channels.sort((a, b) => b.num_members - a.num_members)

    return NextResponse.json(
      { channels },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    )
  } catch (err: any) {
    console.error('Slack channels fetch error:', err)

    // Handle specific Slack API errors
    if (err?.data?.error === 'token_revoked' || err?.data?.error === 'invalid_auth') {
      return NextResponse.json(
        { error: 'Slack token has expired or been revoked. Please reconnect Slack.' },
        { status: 401 }
      )
    }

    if (err?.data?.error === 'missing_scope') {
      return NextResponse.json(
        { error: 'Slack integration is missing required permissions. Please reconnect Slack with the correct scopes.' },
        { status: 403 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic'
