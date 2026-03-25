// app/api/integrations/google/connect/route.ts
// Google OAuth callback — exchanges authorization code for tokens,
// stores integration credentials, and triggers initial Meet recording sync.
// Scopes: Google Meet recordings + Google Drive (for transcript files).

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
  const error = searchParams.get('error')

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
    console.error('Failed to parse Google OAuth state:', e)
  }

  if (error) {
    console.error('Google OAuth error:', error)
    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?google=error'
      : '/integrations?status=error'
    return NextResponse.redirect(new URL(redirectUrl, request.url))
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }

  if (!userId) {
    return NextResponse.json({ error: 'Missing user context. Please try connecting again.' }, { status: 400 })
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google/connect`

    if (!clientId || !clientSecret) {
      console.error('Missing Google credentials')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('Google token exchange error:', tokenData.error, tokenData.error_description)
      return NextResponse.json(
        { error: tokenData.error_description || 'Failed to get access token' },
        { status: 400 }
      )
    }

    // Get user profile
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profileData = await profileResponse.json()

    // Resolve team
    const { teamId } = await ensureTeamForUser(userId)

    // Upsert integration
    const supabase = getAdminClient()
    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        provider: 'google_meet',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        config: {
          google_user_id: profileData.id,
          display_name: profileData.name,
          email: profileData.email,
          picture: profileData.picture,
          token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
        },
      },
      { onConflict: 'team_id,provider' }
    )

    if (upsertError) {
      console.error('Failed to store Google integration:', upsertError)
      return NextResponse.json({ error: 'Failed to store integration' }, { status: 500 })
    }

    // Initialize sync cursor
    await supabase.from('platform_sync_cursors').upsert(
      {
        team_id: teamId,
        provider: 'google_meet',
        sync_status: 'idle',
        recordings_synced: 0,
      },
      { onConflict: 'team_id,provider' }
    )

    // Trigger initial sync
    await inngest.send({
      name: 'platform/sync.recordings',
      data: {
        team_id: teamId,
        provider: 'google_meet',
        user_id: userId,
        is_initial_sync: true,
      },
    })

    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?google=connected'
      : '/integrations?status=success'

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('Google OAuth error:', err)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
