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

/**
 * GET /api/admin/system-health
 * Returns system-wide health metrics for the admin monitoring dashboard.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth: require super_admin or admin role
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()

    if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Run all health checks in parallel
    const [
      recentErrorsRes,
      errorCountsRes,
      errorsBySourceRes,
      integrationsRes,
      orphanedProfilesRes,
      stuckMessagesRes,
      stuckEmailsRes,
      activeUsersRes,
    ] = await Promise.all([
      // Recent errors (last 24h, max 50)
      admin
        .from('system_errors')
        .select('id, source, severity, message, details, user_id, error_key, created_at')
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(50),

      // Error counts by severity (last 24h)
      admin
        .from('system_errors')
        .select('severity')
        .gte('created_at', oneDayAgo),

      // Error counts by source (last 24h)
      admin
        .from('system_errors')
        .select('source, severity')
        .gte('created_at', oneDayAgo),

      // All integrations with token health
      admin
        .from('integrations')
        .select('id, provider, user_id, team_id, access_token, refresh_token, config, updated_at'),

      // Profiles without organization membership
      admin
        .from('profiles')
        .select('id, email, display_name, created_at')
        .is('organization_id', null)
        .limit(20),

      // Stuck Slack messages (unprocessed > 1 hour old)
      admin
        .from('slack_messages')
        .select('id', { count: 'exact', head: true })
        .eq('processed', false)
        .lt('created_at', oneHourAgo),

      // Stuck Outlook emails (unprocessed > 1 hour old)
      admin
        .from('outlook_messages')
        .select('id', { count: 'exact', head: true })
        .eq('processed', false)
        .lt('created_at', oneHourAgo),

      // Active users (signed in within 7 days)
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('updated_at', sevenDaysAgo),
    ])

    // Process integration health
    const integrations = integrationsRes.data || []
    const integrationHealth = {
      total: integrations.length,
      expired: 0,
      expiresSoon: 0,
      missingRefreshToken: 0,
      healthy: 0,
      byProvider: {} as Record<string, { total: number; expired: number; healthy: number }>,
    }

    const expiredIntegrations: Array<{
      id: string; provider: string; userId: string; expiresAt: string | null
    }> = []

    for (const int of integrations) {
      const provider = int.provider
      if (!integrationHealth.byProvider[provider]) {
        integrationHealth.byProvider[provider] = { total: 0, expired: 0, healthy: 0 }
      }
      integrationHealth.byProvider[provider].total++

      const expiresAt = int.config?.token_expires_at
      const tokenExpired = expiresAt ? new Date(expiresAt) < now : false
      const tokenExpiresSoon = expiresAt
        ? new Date(expiresAt) < new Date(now.getTime() + 60 * 60 * 1000) && !tokenExpired
        : false

      if (tokenExpired) {
        integrationHealth.expired++
        integrationHealth.byProvider[provider].expired++
        expiredIntegrations.push({
          id: int.id,
          provider,
          userId: int.user_id,
          expiresAt: expiresAt || null,
        })
      } else if (tokenExpiresSoon) {
        integrationHealth.expiresSoon++
      } else {
        integrationHealth.healthy++
        integrationHealth.byProvider[provider].healthy++
      }

      if (!int.refresh_token) {
        integrationHealth.missingRefreshToken++
      }
    }

    // Process error counts
    const errorCounts = { critical: 0, error: 0, warning: 0, total: 0 }
    for (const row of errorCountsRes.data || []) {
      errorCounts[row.severity as keyof typeof errorCounts]++
      errorCounts.total++
    }

    // Group errors by source
    const errorsBySource: Record<string, { count: number; critical: number }> = {}
    for (const row of errorsBySourceRes.data || []) {
      if (!errorsBySource[row.source]) {
        errorsBySource[row.source] = { count: 0, critical: 0 }
      }
      errorsBySource[row.source].count++
      if (row.severity === 'critical') errorsBySource[row.source].critical++
    }

    // Sort by count descending
    const topErrorSources = Object.entries(errorsBySource)
      .map(([source, stats]) => ({ source, ...stats }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Data integrity
    const dataIntegrity = {
      orphanedProfiles: orphanedProfilesRes.data || [],
      stuckSlackMessages: stuckMessagesRes.count || 0,
      stuckOutlookEmails: stuckEmailsRes.count || 0,
    }

    // Overall health score (0-100)
    let healthScore = 100
    if (errorCounts.critical > 0) healthScore -= Math.min(40, errorCounts.critical * 10)
    if (errorCounts.error > 0) healthScore -= Math.min(30, errorCounts.error * 3)
    if (integrationHealth.expired > 0) healthScore -= Math.min(20, integrationHealth.expired * 2)
    if (dataIntegrity.stuckSlackMessages > 10) healthScore -= 5
    if (dataIntegrity.stuckOutlookEmails > 10) healthScore -= 5
    healthScore = Math.max(0, healthScore)

    return NextResponse.json({
      healthScore,
      errorCounts,
      recentErrors: recentErrorsRes.data || [],
      topErrorSources,
      integrationHealth,
      expiredIntegrations: expiredIntegrations.slice(0, 20),
      dataIntegrity,
      activeUsers7d: activeUsersRes.count || 0,
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('System health GET error:', err)
    return NextResponse.json({ error: 'Failed to load system health' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/system-health
 * Purge old errors (> 30 days) to keep the table small.
 */
export async function DELETE() {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()

    if (!callerProfile || callerProfile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { error } = await admin
      .from('system_errors')
      .delete()
      .lt('created_at', thirtyDaysAgo)

    if (error) {
      return NextResponse.json({ error: 'Failed to purge' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('System health DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
