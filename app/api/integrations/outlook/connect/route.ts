import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Parse redirect target from state
  let redirectTarget = 'dashboard'
  try {
    if (state) {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
      redirectTarget = stateData.redirect || 'dashboard'
    }
  } catch (e) {
    // State parsing failed, use default
  }

  if (error) {
    console.error('Microsoft OAuth error:', error, errorDescription)
    const redirectUrl = redirectTarget === 'onboarding'
      ? '/onboarding/integrations?outlook=error'
      : '/integrations?status=error'
    return NextResponse.redirect(new URL(redirectUrl, request.url))
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 }
    )
  }

  try {
    const clientId = process.env.AZURE_CLIENT_ID
    const clientSecret = process.env.AZURE_CLIENT_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/connect`

    if (!clientId || !clientSecret) {
      console.error('Missing Azure credentials')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid profile email Mail.Read Calendars.Read User.Read offline_access',
      }).toString(),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData.error, tokenData.error_description)
      return NextResponse.json(
        { error: tokenData.error_description || 'Failed to get access token' },
        { status: 400 }
      )
    }

    // Get user profile from Microsoft Graph
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    })

    const profileData = await profileResponse.json()

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
    const { error: insertError } = await supabase.from('integrations').insert({
      team_id: profile.current_team_id,
      provider: 'outlook',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      config: {
        microsoft_user_id: profileData.id,
        display_name: profileData.displayName,
        email: profileData.mail || profileData.userPrincipalName,
        token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
      },
    })

    if (insertError) {
      console.error('Error storing integration:', insertError)
      return NextResponse.json(
        { error: 'Failed to store integration' },
        { status: 500 }
      )
    }

    // Redirect based on where the connection was initiated
    let redirectUrl = '/integrations?status=success'
    if (redirectTarget === 'onboarding') {
      redirectUrl = '/onboarding/integrations?outlook=connected'
    }

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('Microsoft OAuth error:', err)
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    )
  }
}
