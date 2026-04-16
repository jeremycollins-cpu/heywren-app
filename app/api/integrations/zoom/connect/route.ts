// app/api/integrations/zoom/connect/route.ts
// Zoom OAuth callback — exchanges authorization code for tokens,
// stores integration credentials, and triggers initial recording sync.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTeamForUser } from '@/lib/team/ensure-team'
import { inngest } from '@/inngest/client'
import { verifyOAuthState } from '@/lib/crypto/oauth-state'

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

  // Verify HMAC-signed state to prevent CSRF
  const stateData = state ? verifyOAuthState(state) : null
  const userId = stateData?.userId || null
  const redirect = stateData?.redirect || 'dashboard'

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  if (!userId) {
    return NextResponse.json({ error: 'Missing user context. Please try connecting again.' }, { status: 400 })
  }

  try {
    const clientId = process.env.ZOOM_CLIENT_ID
    const clientSecret = process.env.ZOOM_CLIENT_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/zoom/connect`

    if (!clientId || !clientSecret) {
      console.error('Missing Zoom credentials')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Exchange authorization code for tokens
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const tokenResponse = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('Zoom token exchange error:', tokenData.error)
      return NextResponse.json(
        { error: 'Failed to get access token' },
        { status: 400 }
      )
    }

    // Get Zoom user profile
    const profileResponse = await fetch('https://api.zoom.us/v2/users/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profileData = await profileResponse.json()

    // Resolve team
    const { teamId } = await ensureTeamForUser(userId)

    // Upsert integration (per-user)
    const supabase = getAdminClient()
    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        user_id: userId,
        provider: 'zoom',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        config: {
          zoom_user_id: profileData.id,
          display_name: `${profileData.first_name || ''} ${profileData.last_name || ''}`.trim(),
          email: profileData.email,
          account_id: profileData.account_id,
          token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
        },
      },
      { onConflict: 'team_id,user_id,provider' }
    )

    if (upsertError) {
      console.error('Failed to store Zoom integration:', upsertError)
      return NextResponse.json({ error: 'Failed to store integration' }, { status: 500 })
    }

    // Initialize sync cursor
    await supabase.from('platform_sync_cursors').upsert(
      {
        team_id: teamId,
        provider: 'zoom',
        sync_status: 'idle',
        recordings_synced: 0,
      },
      { onConflict: 'team_id,provider' }
    )

    // Trigger initial recording backfill
    await inngest.send({
      name: 'platform/sync.recordings',
      data: {
        team_id: teamId,
        provider: 'zoom',
        user_id: userId,
        is_initial_sync: true,
      },
    })

    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?zoom=connected'
      : '/integrations?status=success'

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('Zoom OAuth error:', err)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
