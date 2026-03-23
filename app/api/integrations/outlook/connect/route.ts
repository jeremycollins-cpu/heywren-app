import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(url, key)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Parse state for userId, teamId, and redirect target
  let userId: string | null = null
  let teamId: string | null = null
  let redirectTarget = 'dashboard'

  if (state) {
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
      userId = stateData.userId || null
      teamId = stateData.teamId || null
      redirectTarget = stateData.redirect || 'dashboard'
    } catch (e) {
      console.error('Failed to parse state:', e)
    }
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

  if (!userId) {
    return NextResponse.json(
      { error: 'Missing user context. Please try connecting again.' },
      { status: 400 }
    )
  }

  try {
    const clientId = process.env.AZURE_AD_CLIENT_ID
    const clientSecret = process.env.AZURE_AD_CLIENT_SECRET
    const redirectUri = 'https://app.heywren.ai/api/integrations/outlook/connect'

    if (!clientId || !clientSecret) {
      console.error('Missing Azure credentials. AZURE_AD_CLIENT_ID set:', !!clientId, 'AZURE_AD_CLIENT_SECRET set:', !!clientSecret)
      return NextResponse.json(
        { error: 'Server configuration error — missing Azure credentials' },
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
        Authorization: 'Bearer ' + tokenData.access_token,
      },
    })

    const profileData = await profileResponse.json()

    // Use admin client — server session is lost after external OAuth redirect
    const supabase = getAdminClient()

    // Resolve teamId if not in state
    if (!teamId) {
      const { data: members } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)

      if (members && members.length > 0) {
        teamId = members[0].team_id
      }
    }

    if (!teamId) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userId)
          .single()

        if (profile && profile.current_team_id) {
          teamId = profile.current_team_id
        }
      } catch (e) {
        // Column might not exist
      }
    }

    // Last resort: create a team
    if (!teamId) {
      const { data: newTeam, error: teamErr } = await supabase
        .from('teams')
        .insert([{
          name: 'My Team',
          slug: 'team-' + Date.now(),
          owner_id: userId
        }])
        .select()
        .single()

      if (newTeam && !teamErr) {
        teamId = newTeam.id

        await supabase.from('team_members').insert([{
          team_id: newTeam.id,
          user_id: userId,
          role: 'owner',
        }])

        try {
          await supabase.from('profiles').update({
            current_team_id: newTeam.id,
          }).eq('id', userId)
        } catch (e) {
          // OK if column does not exist
        }
      } else {
        console.error('Team creation error:', JSON.stringify(teamErr))
      }
    }

    if (!teamId) {
      return NextResponse.json(
        { error: 'Could not find or create a team.' },
        { status: 400 }
      )
    }

    // Upsert the integration
    const { error: upsertErr } = await supabase.from('integrations').upsert({
      team_id: teamId,
      provider: 'outlook',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      config: {
        microsoft_user_id: profileData.id,
        display_name: profileData.displayName,
        email: profileData.mail || profileData.userPrincipalName,
        token_expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
        connected_by: userId,
      },
    }, { onConflict: 'team_id,provider' })

    if (upsertErr) {
      console.error('Integration upsert error:', JSON.stringify(upsertErr))
      return NextResponse.json(
        { error: 'Failed to store integration: ' + upsertErr.message },
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
