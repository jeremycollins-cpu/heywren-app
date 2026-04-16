import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTeamForUser } from '@/lib/team/ensure-team'
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
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Verify HMAC-signed state to prevent CSRF
  const stateData = state ? verifyOAuthState(state) : null
  const userId = stateData?.userId || null
  const redirect = stateData?.redirect || 'dashboard'

  if (error) {
    console.error('Microsoft OAuth error:', error, errorDescription)
    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?outlook=error'
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
    const clientId = process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID
    const clientSecret = process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/connect`

    if (!clientId || !clientSecret) {
      console.error('Missing Azure credentials. AZURE_AD_CLIENT_ID:', !!clientId, 'AZURE_AD_CLIENT_SECRET:', !!clientSecret)
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid profile email Mail.Read Mail.ReadWrite Calendars.ReadWrite User.Read offline_access',
      }).toString(),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData.error, tokenData.error_description)
      const errorRedirect = redirect === 'onboarding'
        ? '/onboarding/integrations?outlook=error'
        : '/integrations?status=error'
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    // Validate token by fetching user profile from Microsoft Graph
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    })

    if (!profileResponse.ok) {
      console.error('Outlook token validation failed — Graph /me returned', profileResponse.status)
      const errorRedirect = redirect === 'onboarding'
        ? '/onboarding/integrations?outlook=error'
        : '/integrations?status=error'
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    const profileData = await profileResponse.json()

    // Resolve team using shared utility (handles all fallbacks + fixes inconsistencies)
    const { teamId } = await ensureTeamForUser(userId)

    // Upsert the integration (per-user)
    const supabase = getAdminClient()
    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        user_id: userId,
        provider: 'outlook',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        config: {
          microsoft_user_id: profileData.id,
          display_name: profileData.displayName,
          email: profileData.mail || profileData.userPrincipalName,
          token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
        },
      },
      { onConflict: 'team_id,user_id,provider' }
    )

    if (upsertError) {
      console.error('Failed to store Outlook integration:', upsertError)
      const errorRedirect = redirect === 'onboarding'
        ? '/onboarding/integrations?outlook=error'
        : '/integrations?status=error'
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    const redirectUrl = redirect === 'onboarding'
      ? '/onboarding/integrations?outlook=connected'
      : '/integrations?status=success'

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('Microsoft OAuth error:', err)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
