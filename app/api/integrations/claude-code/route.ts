export const dynamic = 'force-dynamic'

// app/api/integrations/claude-code/route.ts
// Manages the Claude Code integration: generate sync tokens,
// check connection status, and revoke tokens.
// Follows the same pattern as the Chrome extension token system.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import crypto from 'crypto'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/integrations/claude-code
 * Generate a new sync token for Claude Code integration.
 * Returns the raw token (shown once) and setup instructions.
 */
export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Resolve team
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Revoke any existing Claude Code tokens for this user
    await supabase
      .from('extension_tokens')
      .update({ revoked: true })
      .eq('user_id', user.id)
      .like('device_name', 'Claude Code%')

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    // Token expires in 365 days (longer than extension since it's server-to-server)
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

    // Store hashed token
    const { error: insertError } = await supabase.from('extension_tokens').insert({
      team_id: profile.current_team_id,
      user_id: user.id,
      token_hash: tokenHash,
      device_name: 'Claude Code Sync',
      expires_at: expiresAt.toISOString(),
    })

    if (insertError) {
      console.error('Failed to create Claude Code token:', insertError)
      return NextResponse.json({ error: 'Failed to create token' }, { status: 500 })
    }

    // Also upsert an integration record so the integrations page shows it as connected
    const { error: upsertError } = await supabase.from('integrations').upsert({
      team_id: profile.current_team_id,
      user_id: user.id,
      provider: 'claude_code',
      access_token: 'token-based-auth',  // Not used for auth — tokens table handles this
      config: {
        setup_at: new Date().toISOString(),
        token_expires_at: expiresAt.toISOString(),
      },
    }, { onConflict: 'team_id,user_id,provider' })

    if (upsertError) {
      console.error('Failed to upsert Claude Code integration record:', upsertError)
    }

    // Build the app URL for the hook script
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

    return NextResponse.json({
      token: rawToken,
      expires_at: expiresAt.toISOString(),
      app_url: appUrl,
      setup_command: `curl -fsSL "${appUrl}/api/integrations/claude-code/install?token=${rawToken}" | bash`,
      message: 'Copy the setup command below into your terminal. The token will not be shown again.',
    })
  } catch (error) {
    console.error('Claude Code connect error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/integrations/claude-code
 * Check if Claude Code is connected and return status.
 */
export async function GET() {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Check for active (non-revoked, non-expired) tokens
    const { data: tokens } = await supabase
      .from('extension_tokens')
      .select('id, device_name, last_used_at, expires_at, created_at')
      .eq('user_id', user.id)
      .eq('revoked', false)
      .like('device_name', 'Claude Code%')
      .order('created_at', { ascending: false })

    const activeTokens = (tokens || []).filter(t => new Date(t.expires_at) > new Date())

    // Self-heal: if the user has an active Claude Code token but the
    // `integrations` table is missing a row for them, the UI would
    // otherwise show "Connect" and a stray click would revoke the
    // working token. Create the row so the UI stays in sync.
    if (activeTokens.length > 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', user.id)
        .single()

      if (profile?.current_team_id) {
        const { data: existing } = await supabase
          .from('integrations')
          .select('id')
          .eq('team_id', profile.current_team_id)
          .eq('user_id', user.id)
          .eq('provider', 'claude_code')
          .maybeSingle()

        if (!existing) {
          const { error: healError } = await supabase.from('integrations').insert({
            team_id: profile.current_team_id,
            user_id: user.id,
            provider: 'claude_code',
            access_token: 'token-based-auth',
            config: {
              setup_at: new Date().toISOString(),
              token_expires_at: activeTokens[0].expires_at,
              recovered: true,
            },
          })
          if (healError) {
            console.error('Claude Code integration self-heal failed:', healError)
          }
        }
      }
    }

    // Get session count for this user
    const { count } = await supabase
      .from('ai_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    return NextResponse.json({
      connected: activeTokens.length > 0,
      tokens: activeTokens.map(t => ({
        id: t.id,
        created_at: t.created_at,
        last_used_at: t.last_used_at,
        expires_at: t.expires_at,
      })),
      sessions_synced: count || 0,
    })
  } catch (error) {
    console.error('Claude Code status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/integrations/claude-code
 * Disconnect Claude Code: revoke all tokens and remove integration record.
 */
export async function DELETE() {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Revoke all Claude Code tokens
    await supabase
      .from('extension_tokens')
      .update({ revoked: true })
      .eq('user_id', user.id)
      .like('device_name', 'Claude Code%')

    // Remove integration record
    await supabase
      .from('integrations')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'claude_code')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Claude Code disconnect error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
