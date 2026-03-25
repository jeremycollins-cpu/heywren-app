// app/api/extension/token/route.ts
// Generates a short-lived authentication token for the Chrome extension.
// The user authenticates via the web app, then gets a token to use in the extension.

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

export async function POST(req: NextRequest) {
  try {
    // Authenticate user via session
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { device_name } = body

    // Look up team
    const supabase = getAdminClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Generate a secure token
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    // Token expires in 90 days
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

    // Store token hash (never store the raw token)
    const { error: insertError } = await supabase.from('extension_tokens').insert({
      team_id: profile.current_team_id,
      user_id: user.id,
      token_hash: tokenHash,
      device_name: device_name || 'Chrome Extension',
      expires_at: expiresAt.toISOString(),
    })

    if (insertError) {
      console.error('Failed to create extension token:', insertError)
      return NextResponse.json({ error: 'Failed to create token' }, { status: 500 })
    }

    // Return the raw token (only time the user sees it)
    return NextResponse.json({
      token: rawToken,
      expires_at: expiresAt.toISOString(),
      message: 'Copy this token into your HeyWren Chrome extension. It will not be shown again.',
    })
  } catch (error) {
    console.error('Extension token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// List active tokens (for settings page)
export async function GET() {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()
    const { data: tokens } = await supabase
      .from('extension_tokens')
      .select('id, device_name, last_used_at, expires_at, revoked, created_at')
      .eq('user_id', user.id)
      .eq('revoked', false)
      .order('created_at', { ascending: false })

    return NextResponse.json({ tokens: tokens || [] })
  } catch (error) {
    console.error('Extension token list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Revoke a token
export async function DELETE(req: NextRequest) {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const tokenId = searchParams.get('id')
    if (!tokenId) {
      return NextResponse.json({ error: 'Missing token id' }, { status: 400 })
    }

    const supabase = getAdminClient()
    await supabase
      .from('extension_tokens')
      .update({ revoked: true })
      .eq('id', tokenId)
      .eq('user_id', user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Extension token revoke error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
