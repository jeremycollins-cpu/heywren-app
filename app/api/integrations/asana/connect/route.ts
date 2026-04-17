// app/api/integrations/asana/connect/route.ts
// Asana OAuth callback — exchanges authorization code for tokens, fetches the
// user's Asana profile + workspaces, stores the integration, and triggers
// initial task sync.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTeamForUser } from '@/lib/team/ensure-team'
import { inngest } from '@/inngest/client'
import { verifyOAuthState } from '@/lib/crypto/oauth-state'
import { ASANA_API, exchangeAsanaCode } from '@/lib/asana/client'

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
  const oauthError = searchParams.get('error')

  // Asana redirects with ?error=access_denied if the user cancels consent.
  if (oauthError) {
    return NextResponse.redirect(new URL('/integrations?status=error', request.url))
  }

  const stateData = state ? verifyOAuthState(state) : null
  const userId = stateData?.userId || null
  const redirect = stateData?.redirect || 'dashboard'

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
  }
  if (!userId) {
    return NextResponse.json(
      { error: 'Missing user context. Please try connecting again.' },
      { status: 400 }
    )
  }

  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/asana/connect`
    const tokenResult = await exchangeAsanaCode(code, redirectUri)

    if ('error' in tokenResult) {
      console.error('[asana/connect] Token exchange error:', tokenResult.error)
      return NextResponse.redirect(new URL('/integrations?status=error', request.url))
    }

    // Asana includes the user object in the token response (`data` field).
    // We still hit /users/me to also fetch workspaces.
    const profileRes = await fetch(`${ASANA_API}/users/me?opt_fields=name,email,gid,workspaces.name,workspaces.gid`, {
      headers: {
        Authorization: `Bearer ${tokenResult.access_token}`,
        Accept: 'application/json',
      },
    })
    const profileJson = await profileRes.json()
    const profile = profileJson?.data
    if (!profile?.gid) {
      console.error('[asana/connect] Failed to fetch Asana profile:', profileJson)
      return NextResponse.redirect(new URL('/integrations?status=error', request.url))
    }

    const workspaces: Array<{ gid: string; name: string }> = profile.workspaces || []
    const defaultWorkspace = workspaces[0] || null

    const { teamId } = await ensureTeamForUser(userId)
    const supabase = getAdminClient()

    const { error: upsertError } = await supabase.from('integrations').upsert(
      {
        team_id: teamId,
        user_id: userId,
        provider: 'asana',
        access_token: tokenResult.access_token,
        refresh_token: tokenResult.refresh_token || null,
        config: {
          asana_user_gid: profile.gid,
          display_name: profile.name,
          email: profile.email,
          workspaces,
          default_workspace_gid: defaultWorkspace?.gid || null,
          default_workspace_name: defaultWorkspace?.name || null,
          token_expires_at: new Date(
            Date.now() + (tokenResult.expires_in || 3600) * 1000
          ).toISOString(),
        },
      },
      { onConflict: 'team_id,user_id,provider' }
    )

    if (upsertError) {
      console.error('[asana/connect] Failed to store integration:', upsertError)
      return NextResponse.redirect(new URL('/integrations?status=error', request.url))
    }

    let organizationId: string | null = null
    const { data: team } = await supabase
      .from('teams')
      .select('organization_id')
      .eq('id', teamId)
      .single()
    organizationId = team?.organization_id || null

    await supabase.from('asana_sync_cursors').upsert(
      {
        user_id: userId,
        team_id: teamId,
        asana_user_gid: profile.gid,
        default_workspace_gid: defaultWorkspace?.gid || null,
        sync_status: 'idle',
        tasks_synced: 0,
      },
      { onConflict: 'user_id' }
    )

    await inngest.send({
      name: 'asana/sync.tasks',
      data: {
        user_id: userId,
        team_id: teamId,
        organization_id: organizationId,
        is_initial_sync: true,
      },
    })

    const redirectUrl =
      redirect === 'onboarding'
        ? '/onboarding/integrations?asana=connected'
        : '/integrations?status=success'

    return NextResponse.redirect(new URL(redirectUrl, request.url))
  } catch (err) {
    console.error('[asana/connect] OAuth error:', err)
    return NextResponse.redirect(new URL('/integrations?status=error', request.url))
  }
}
