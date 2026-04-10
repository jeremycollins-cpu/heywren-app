import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Silently refresh an expired Microsoft access token using the refresh token.
 * Returns true if the refresh succeeded (connection is healthy), false if it
 * failed (user genuinely needs to re-auth).
 */
async function tryRefreshOutlookToken(
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshTokenValue: string,
  existingConfig: Record<string, any>
): Promise<boolean> {
  try {
    const tokenRes = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.AZURE_AD_CLIENT_ID!,
          client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: refreshTokenValue,
          scope: 'openid profile email Mail.Read Mail.ReadWrite Calendars.ReadWrite User.Read offline_access',
        }),
      }
    )

    const data = await tokenRes.json()
    if (!data.access_token) {
      console.error('[integration-status] Token refresh failed:', data.error_description || data.error)
      return false
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

    await supabase
      .from('integrations')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshTokenValue,
        config: { ...existingConfig, token_expires_at: expiresAt },
      })
      .eq('id', integrationId)

    return true
  } catch (err) {
    console.error('[integration-status] Token refresh error:', (err as Error).message)
    return false
  }
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
        // Fix the profile while we're at it
        await supabaseAdmin
          .from('profiles')
          .update({ current_team_id: teamId })
          .eq('id', userId)
      }
    }

    if (!teamId) {
      return NextResponse.json({ integrations: [], teamId: null })
    }

    // Get integrations for THIS user (not all team integrations)
    // Include refresh_token so we can silently refresh expired access tokens
    const { data: integrations, error } = await supabaseAdmin
      .from('integrations')
      .select('id, provider, config, refresh_token')
      .eq('user_id', userId)

    if (error) {
      console.error('Error fetching integrations:', error)
      return NextResponse.json({ integrations: [], teamId })
    }

    // Check for expired tokens and silently refresh if possible
    const now = new Date()
    const enriched = await Promise.all(
      (integrations || []).map(async (int) => {
        const accessTokenExpired = int.config?.token_expires_at
          ? new Date(int.config.token_expires_at) < now
          : false

        let tokenExpired = accessTokenExpired

        // If the access token is expired but we have a refresh token,
        // silently refresh instead of showing the "Connection expired" banner.
        // Microsoft refresh tokens last 90 days with offline_access scope —
        // the user only needs to re-auth if the refresh token itself is invalid.
        if (accessTokenExpired && int.refresh_token) {
          const refreshed = await tryRefreshOutlookToken(
            supabaseAdmin,
            int.id,
            int.refresh_token,
            int.config || {}
          )
          tokenExpired = !refreshed
        }

        return {
          id: int.id,
          provider: int.provider,
          config: int.config,
          tokenExpired,
        }
      })
    )

    return NextResponse.json(
      { integrations: enriched, teamId },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    )
  } catch (err) {
    console.error('Integration status error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic'
