export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function checkSuperAdmin(admin: ReturnType<typeof getAdminClient>) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    const callerId = userData?.user?.id
    if (!callerId) return false
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()
    return profile?.role === 'super_admin'
  } catch {
    return false
  }
}

/**
 * POST /api/admin/system-health/heal
 *
 * Bulk remediation actions for the System Health dashboard.
 *
 * Body:
 *   { action: 'refresh_all_tokens' }
 *     → Refreshes every Outlook/Microsoft integration that has a refresh
 *       token and is expired or expiring within the next hour.
 *
 *   { action: 'clear_all_stuck_outlook' }
 *     → Marks every Outlook email stuck for >1 hour as processed. Useful
 *       after a deploy where the background job backed up.
 *
 *   { action: 'clear_all_stuck_slack' }
 *     → Same but for stuck Slack messages.
 */
export async function POST(request: NextRequest) {
  const admin = getAdminClient()

  if (!(await checkSuperAdmin(admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const action = body?.action

  if (action === 'refresh_all_tokens') {
    return refreshAllTokens(admin)
  }

  if (action === 'clear_all_stuck_outlook') {
    return clearAllStuckOutlook(admin)
  }

  if (action === 'clear_all_stuck_slack') {
    return clearAllStuckSlack(admin)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

async function refreshAllTokens(admin: ReturnType<typeof getAdminClient>) {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Microsoft OAuth credentials not configured' },
      { status: 500 }
    )
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() + 60 * 60 * 1000).toISOString()

  const { data: integrations, error } = await admin
    .from('integrations')
    .select('id, provider, user_id, refresh_token, config')
    .in('provider', ['outlook', 'microsoft'])
    .not('refresh_token', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter to those expired or expiring within the hour.
  const candidates = (integrations || []).filter((i) => {
    const expiresAt = i.config?.token_expires_at
    if (!expiresAt) return false
    return expiresAt < cutoff
  })

  const succeeded: string[] = []
  const failed: { id: string; userId: string | null; reason: string }[] = []

  // Process sequentially to avoid rate limits — this is a bounded admin op.
  for (const i of candidates) {
    try {
      const tokenRes = await fetch(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: i.refresh_token,
            grant_type: 'refresh_token',
          }),
        }
      )
      const tokenData = await tokenRes.json()
      if (!tokenData.access_token) {
        failed.push({
          id: i.id,
          userId: i.user_id,
          reason:
            tokenData.error_description ||
            tokenData.error ||
            `HTTP ${tokenRes.status}`,
        })
        continue
      }

      const newExpiresAt = tokenData.expires_in
        ? new Date(
            Date.now() + (tokenData.expires_in as number) * 1000
          ).toISOString()
        : null

      const newConfig = {
        ...(i.config || {}),
        ...(newExpiresAt ? { token_expires_at: newExpiresAt } : {}),
      }

      await admin
        .from('integrations')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || i.refresh_token,
          config: newConfig,
        })
        .eq('id', i.id)

      succeeded.push(i.id)
    } catch (err) {
      failed.push({
        id: i.id,
        userId: i.user_id,
        reason: (err as Error).message || 'Unknown error',
      })
    }
  }

  return NextResponse.json({
    success: true,
    message: `Refreshed ${succeeded.length}/${candidates.length} tokens${
      failed.length > 0 ? `, ${failed.length} failed` : ''
    }`,
    attempted: candidates.length,
    succeeded: succeeded.length,
    failed,
  })
}

async function clearAllStuckOutlook(
  admin: ReturnType<typeof getAdminClient>
) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count, error } = await admin
    .from('outlook_messages')
    .update(
      { processed: true, commitments_found: 0 },
      { count: 'exact' }
    )
    .eq('processed', false)
    .lt('created_at', oneHourAgo)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: `Cleared ${count || 0} stuck Outlook email${count === 1 ? '' : 's'}`,
    cleared: count || 0,
  })
}

async function clearAllStuckSlack(admin: ReturnType<typeof getAdminClient>) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count, error } = await admin
    .from('slack_messages')
    .update(
      { processed: true, commitments_found: 0 },
      { count: 'exact' }
    )
    .eq('processed', false)
    .lt('created_at', oneHourAgo)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: `Cleared ${count || 0} stuck Slack message${count === 1 ? '' : 's'}`,
    cleared: count || 0,
  })
}
