// app/api/integrations/github/connect/route.ts
// GitHub OAuth callback — exchanges authorization code for tokens,
// stores integration credentials, and triggers initial event sync.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTeamForUser } from '@/lib/team/ensure-team'
import { inngest } from '@/inngest/client'

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

  // Parse state
  let userId: string | null = null
  let redirect = 'dashboard'
  try {
    if (state) {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
      userId = stateData.userId || null
      redirect = stateData.redirect || 'dashboard'
    }
  } catch (e) {
    console.error('Failed to parse GitHub OAuth state:', e)
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  if (!userId) {
    return NextResponse.json({ error: 'Missing user context. Please try connecting again.' }, { status: 400 })
  }

  try {
    const clientId = process.env.GITHUB_CLIENT_ID
    const clientSecret = process.env.GITHUB_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      console.error('Missing GitHub credentials')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('GitHub token exchange error:', tokenData.error, tokenData.error_description)
      return NextResponse.json(
        { error: tokenData.error_description || 'Failed to get access token' },
        { status: 400 }
      )
    }

    // Get GitHub user profile
    const profileResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    })
    const profileData = await profileResponse.json()

    if (!profileData.login) {
      console.error('Failed to fetch GitHub profile:', profileData)
      return NextResponse.json({ error: 'Failed to get GitHub profile' }, { status: 400 })
    }

    // Resolve team
    let teamId: string
    try {
      const result = await ensureTeamForUser(userId)
      teamId = result.teamId
    } catch (teamErr: any) {
      console.error('Failed to resolve team for GitHub connect:', teamErr)
      return NextResponse.json({ error: 'Failed to resolve team', detail: teamErr.message }, { status: 500 })
    }

    // Upsert integration
    const supabase = getAdminClient()
    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        user_id: userId,
        provider: 'github',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        config: {
          github_username: profileData.login,
          display_name: profileData.name || profileData.login,
          avatar_url: profileData.avatar_url,
          email: profileData.email,
          github_id: profileData.id,
          scope: tokenData.scope,
        },
      },
      { onConflict: 'team_id,user_id,provider' }
    )

    if (upsertError) {
      console.error('Failed to store GitHub integration:', upsertError)
      return NextResponse.json({ error: 'Failed to store integration', detail: upsertError.message, code: upsertError.code }, { status: 500 })
    }

    // Get organization_id
    let organizationId: string | null = null
    const { data: team } = await supabase
      .from('teams')
      .select('organization_id')
      .eq('id', teamId)
      .single()
    organizationId = team?.organization_id || null

    // Initialize sync cursor
    await supabase.from('github_sync_cursors').upsert(
      {
        user_id: userId,
        team_id: teamId,
        github_username: profileData.login,
        sync_status: 'idle',
        events_synced: 0,
      },
      { onConflict: 'user_id' }
    )

    // Trigger initial sync via Inngest
    await inngest.send({
      name: 'github/sync.events',
      data: {
        user_id: userId,
        team_id: teamId,
        organization_id: organizationId,
        github_username: profileData.login,
        is_initial_sync: true,
      },
    })

    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?github=connected'
      : '/integrations?status=success'

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('GitHub OAuth error:', err)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
