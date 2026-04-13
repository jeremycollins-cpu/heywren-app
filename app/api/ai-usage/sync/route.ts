export const dynamic = 'force-dynamic'

// app/api/ai-usage/sync/route.ts
// Public endpoint for syncing AI sessions via Bearer token auth.
// Called by the Claude Code hook after each session ends.
// Authenticates via extension_tokens (same pattern as Chrome extension ingest).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Validate Bearer token against extension_tokens table
async function validateSyncToken(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const rawToken = authHeader.slice(7)
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

  const supabase = getAdminClient()
  const { data: tokenRecord } = await supabase
    .from('extension_tokens')
    .select('id, team_id, user_id, expires_at, revoked')
    .eq('token_hash', tokenHash)
    .single()

  if (!tokenRecord || tokenRecord.revoked) {
    return null
  }

  if (new Date(tokenRecord.expires_at) < new Date()) {
    return null
  }

  // Update last_used_at
  await supabase
    .from('extension_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRecord.id)

  return {
    userId: tokenRecord.user_id,
    teamId: tokenRecord.team_id,
    tokenId: tokenRecord.id,
  }
}

/**
 * POST /api/ai-usage/sync
 * Sync one or more AI sessions from the Claude Code hook.
 * Auth: Bearer token (from Claude Code integration setup).
 * Body: { sessions: Array<SessionData> }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await validateSyncToken(request.headers.get('authorization'))
    if (!auth) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Get organization_id from team
    let organizationId: string | null = null
    if (auth.teamId) {
      const { data: team } = await supabase
        .from('teams')
        .select('organization_id')
        .eq('id', auth.teamId)
        .single()
      organizationId = team?.organization_id || null
    }

    const body = await request.json()
    const sessions = Array.isArray(body.sessions) ? body.sessions : body.session ? [body.session] : []

    if (sessions.length === 0) {
      return NextResponse.json({ error: 'No sessions provided' }, { status: 400 })
    }

    if (sessions.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 sessions per request' }, { status: 400 })
    }

    const rows = sessions.map((s: any) => ({
      user_id: auth.userId,
      team_id: auth.teamId,
      organization_id: organizationId,
      session_id: s.session_id,
      tool: s.tool || 'claude_code',
      started_at: s.started_at,
      ended_at: s.ended_at || null,
      input_tokens: s.input_tokens || 0,
      output_tokens: s.output_tokens || 0,
      estimated_cost_cents: s.estimated_cost_cents || 0,
      model: s.model || null,
      entrypoint: s.entrypoint || null,
      project_path: s.project_path || null,
      messages_count: s.messages_count || 0,
      tool_calls_count: s.tool_calls_count || 0,
      metadata: s.metadata || {},
    }))

    const { data, error } = await supabase
      .from('ai_sessions')
      .upsert(rows, { onConflict: 'user_id,session_id,tool' })
      .select('id, session_id')

    if (error) {
      console.error('[ai-usage/sync] Upsert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      synced: data?.length || 0,
      sessions: data,
    })
  } catch (err: any) {
    console.error('[ai-usage/sync] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
