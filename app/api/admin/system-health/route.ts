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

// ─── Types shared with the dashboard UI ───────────────────────────────────────

export type IssueType =
  | 'expired_token'
  | 'expiring_soon'
  | 'missing_refresh_token'
  | 'stuck_outlook'
  | 'stuck_slack'
  | 'orphaned_profile'
  | 'error_spike'

export interface UserIssue {
  type: IssueType
  severity: 'critical' | 'high' | 'medium' | 'low'
  label: string
  detail?: string
  // Machine-readable payload for the fix button
  provider?: string
  integrationId?: string
  count?: number
  oldestAt?: string | null
  canAutoFix: boolean
  fixAction?:
    | 'refresh_token'
    | 'clear_stuck'
    | 'send_password_reset'
    | 'generate_magic_link'
    | 'fix_onboarding'
}

export interface UserActionCard {
  userId: string
  email: string | null
  displayName: string | null
  teamId: string | null
  topSeverity: 'critical' | 'high' | 'medium' | 'low'
  issues: UserIssue[]
}

// ─── Severity ranking ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<UserIssue['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function worstSeverity(
  a: UserIssue['severity'],
  b: UserIssue['severity']
): UserIssue['severity'] {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
}

/**
 * GET /api/admin/system-health
 *
 * Returns a per-user action queue so the admin can proactively help users
 * before they notice anything is wrong. The legacy aggregate fields
 * (healthScore, errorCounts, integrationHealth, dataIntegrity) are preserved
 * for backward compatibility.
 */
export async function GET(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch {
      /* session failed */
    }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()

    if (
      !callerProfile ||
      !['admin', 'super_admin'].includes(callerProfile.role)
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date()
    const oneDayAgo = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    ).toISOString()
    const oneHourAgo = new Date(
      now.getTime() - 60 * 60 * 1000
    ).toISOString()
    const sevenDaysAgo = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString()

    // Run primary queries in parallel
    const [
      recentErrorsRes,
      errorCountsRes,
      errorsBySourceRes,
      integrationsRes,
      orphanedProfilesRes,
      stuckMessagesRes,
      stuckEmailsRes,
      activeUsersRes,
      stuckOutlookDetailRes,
      stuckSlackDetailRes,
    ] = await Promise.all([
      // Recent errors (last 24h, max 50) — user-attributed only shown first
      admin
        .from('system_errors')
        .select(
          'id, source, severity, message, details, user_id, error_key, created_at'
        )
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(50),

      admin
        .from('system_errors')
        .select('severity')
        .gte('created_at', oneDayAgo),

      admin
        .from('system_errors')
        .select('source, severity')
        .gte('created_at', oneDayAgo),

      admin
        .from('integrations')
        .select(
          'id, provider, user_id, team_id, access_token, refresh_token, config, updated_at'
        ),

      // Profiles without organization membership
      admin
        .from('profiles')
        .select('id, email, display_name, full_name, created_at')
        .is('organization_id', null)
        .limit(50),

      admin
        .from('slack_messages')
        .select('id', { count: 'exact', head: true })
        .eq('processed', false)
        .lt('created_at', oneHourAgo),

      admin
        .from('outlook_messages')
        .select('id', { count: 'exact', head: true })
        .eq('processed', false)
        .lt('created_at', oneHourAgo),

      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('updated_at', sevenDaysAgo),

      // Stuck Outlook rows — aggregated in memory by user_id
      admin
        .from('outlook_messages')
        .select('user_id, team_id, created_at')
        .eq('processed', false)
        .lt('created_at', oneHourAgo)
        .not('user_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(2000),

      // Stuck Slack rows — user_id here is the Slack user id (TEXT)
      admin
        .from('slack_messages')
        .select('user_id, team_id, created_at')
        .eq('processed', false)
        .lt('created_at', oneHourAgo)
        .order('created_at', { ascending: true })
        .limit(2000),
    ])

    // ─── Build integration health + per-user token issues ─────────────────────
    type TokenIssue = {
      integrationId: string
      provider: string
      userId: string | null
      teamId: string | null
      expiresAt: string | null
      status: 'expired' | 'expires_soon' | 'missing_refresh'
      hasRefreshToken: boolean
    }

    const integrations = integrationsRes.data || []
    const integrationHealth = {
      total: integrations.length,
      expired: 0,
      expiresSoon: 0,
      missingRefreshToken: 0,
      healthy: 0,
      byProvider: {} as Record<
        string,
        {
          total: number
          expired: number
          expiresSoon: number
          missingRefresh: number
          healthy: number
        }
      >,
    }

    const tokenIssues: TokenIssue[] = []

    for (const int of integrations) {
      const provider = int.provider
      if (!integrationHealth.byProvider[provider]) {
        integrationHealth.byProvider[provider] = {
          total: 0,
          expired: 0,
          expiresSoon: 0,
          missingRefresh: 0,
          healthy: 0,
        }
      }
      integrationHealth.byProvider[provider].total++

      const expiresAt = int.config?.token_expires_at
      const tokenExpired = expiresAt ? new Date(expiresAt) < now : false
      const tokenExpiresSoon = expiresAt
        ? new Date(expiresAt) < new Date(now.getTime() + 60 * 60 * 1000) &&
          !tokenExpired
        : false
      const hasRefreshToken = !!int.refresh_token

      if (tokenExpired) {
        integrationHealth.expired++
        integrationHealth.byProvider[provider].expired++
        tokenIssues.push({
          integrationId: int.id,
          provider,
          userId: int.user_id || null,
          teamId: int.team_id || null,
          expiresAt: expiresAt || null,
          status: hasRefreshToken ? 'expired' : 'missing_refresh',
          hasRefreshToken,
        })
      } else if (tokenExpiresSoon) {
        integrationHealth.expiresSoon++
        integrationHealth.byProvider[provider].expiresSoon++
        tokenIssues.push({
          integrationId: int.id,
          provider,
          userId: int.user_id || null,
          teamId: int.team_id || null,
          expiresAt: expiresAt || null,
          status: 'expires_soon',
          hasRefreshToken,
        })
      } else {
        integrationHealth.healthy++
        integrationHealth.byProvider[provider].healthy++
      }

      if (!hasRefreshToken) {
        integrationHealth.missingRefreshToken++
        integrationHealth.byProvider[provider].missingRefresh++
      }
    }

    // ─── Aggregate stuck messages per user ─────────────────────────────────────
    type StuckAgg = {
      count: number
      oldestAt: string | null
      teamId: string | null
    }

    const stuckOutlookByUser = new Map<string, StuckAgg>()
    for (const row of stuckOutlookDetailRes.data || []) {
      if (!row.user_id) continue
      const key = row.user_id
      const existing = stuckOutlookByUser.get(key)
      if (existing) {
        existing.count++
        if (
          row.created_at &&
          (!existing.oldestAt || row.created_at < existing.oldestAt)
        ) {
          existing.oldestAt = row.created_at
        }
      } else {
        stuckOutlookByUser.set(key, {
          count: 1,
          oldestAt: row.created_at || null,
          teamId: row.team_id || null,
        })
      }
    }

    const stuckSlackBySlackUser = new Map<string, StuckAgg>()
    for (const row of stuckSlackDetailRes.data || []) {
      if (!row.user_id) continue
      const key = row.user_id
      const existing = stuckSlackBySlackUser.get(key)
      if (existing) {
        existing.count++
        if (
          row.created_at &&
          (!existing.oldestAt || row.created_at < existing.oldestAt)
        ) {
          existing.oldestAt = row.created_at
        }
      } else {
        stuckSlackBySlackUser.set(key, {
          count: 1,
          oldestAt: row.created_at || null,
          teamId: row.team_id || null,
        })
      }
    }

    // ─── Resolve profiles for every affected user ─────────────────────────────
    const affectedUuids = new Set<string>()
    tokenIssues.forEach((t) => t.userId && affectedUuids.add(t.userId))
    stuckOutlookByUser.forEach((_, uid) => affectedUuids.add(uid))
    ;(recentErrorsRes.data || []).forEach((e) => {
      if (e.user_id) affectedUuids.add(e.user_id)
    })

    const affectedSlackIds = Array.from(stuckSlackBySlackUser.keys())

    const [profilesByIdRes, profilesBySlackRes] = await Promise.all([
      affectedUuids.size > 0
        ? admin
            .from('profiles')
            .select(
              'id, email, display_name, full_name, current_team_id, slack_user_id'
            )
            .in('id', Array.from(affectedUuids))
        : Promise.resolve({ data: [] as any[], error: null }),
      affectedSlackIds.length > 0
        ? admin
            .from('profiles')
            .select(
              'id, email, display_name, full_name, current_team_id, slack_user_id'
            )
            .in('slack_user_id', affectedSlackIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ])

    const profileById = new Map<string, any>()
    for (const p of profilesByIdRes.data || []) profileById.set(p.id, p)

    const profileBySlackId = new Map<string, any>()
    for (const p of profilesBySlackRes.data || []) {
      if (p.slack_user_id) profileBySlackId.set(p.slack_user_id, p)
    }

    // ─── Build per-user action queue ──────────────────────────────────────────
    const queueByUser = new Map<string, UserActionCard>()

    const ensureCard = (
      userId: string,
      fallback?: { email?: string | null; displayName?: string | null }
    ): UserActionCard => {
      let card = queueByUser.get(userId)
      if (card) return card
      const profile = profileById.get(userId)
      card = {
        userId,
        email: profile?.email || fallback?.email || null,
        displayName:
          profile?.display_name ||
          profile?.full_name ||
          fallback?.displayName ||
          null,
        teamId: profile?.current_team_id || null,
        topSeverity: 'low',
        issues: [],
      }
      queueByUser.set(userId, card)
      return card
    }

    const addIssue = (card: UserActionCard, issue: UserIssue) => {
      card.issues.push(issue)
      card.topSeverity = worstSeverity(card.topSeverity, issue.severity)
    }

    // Token issues → per-user
    for (const t of tokenIssues) {
      if (!t.userId) continue
      const card = ensureCard(t.userId)
      if (t.status === 'missing_refresh') {
        addIssue(card, {
          type: 'missing_refresh_token',
          severity: 'critical',
          label: `${t.provider} token expired — no refresh token, user must reconnect`,
          detail: t.expiresAt
            ? `Expired ${new Date(t.expiresAt).toLocaleString()}`
            : undefined,
          provider: t.provider,
          integrationId: t.integrationId,
          canAutoFix: false,
          fixAction: 'generate_magic_link',
        })
      } else if (t.status === 'expired') {
        addIssue(card, {
          type: 'expired_token',
          severity: 'high',
          label: `${t.provider} token expired — auto-refresh available`,
          detail: t.expiresAt
            ? `Expired ${new Date(t.expiresAt).toLocaleString()}`
            : undefined,
          provider: t.provider,
          integrationId: t.integrationId,
          canAutoFix: true,
          fixAction: 'refresh_token',
        })
      } else if (t.status === 'expires_soon') {
        addIssue(card, {
          type: 'expiring_soon',
          severity: 'medium',
          label: `${t.provider} token expires within 1 hour`,
          detail: t.expiresAt
            ? `Expires ${new Date(t.expiresAt).toLocaleString()}`
            : undefined,
          provider: t.provider,
          integrationId: t.integrationId,
          canAutoFix: true,
          fixAction: 'refresh_token',
        })
      }
    }

    // Stuck Outlook → per-user (user_id is auth uuid)
    for (const [userId, agg] of stuckOutlookByUser.entries()) {
      const card = ensureCard(userId)
      const sev: UserIssue['severity'] =
        agg.count > 100 ? 'critical' : agg.count > 20 ? 'high' : 'low'
      addIssue(card, {
        type: 'stuck_outlook',
        severity: sev,
        label: `${agg.count} Outlook email${agg.count === 1 ? '' : 's'} stuck unprocessed`,
        detail: agg.oldestAt
          ? `Oldest: ${new Date(agg.oldestAt).toLocaleString()}`
          : undefined,
        count: agg.count,
        oldestAt: agg.oldestAt,
        canAutoFix: true,
        fixAction: 'clear_stuck',
      })
    }

    // Stuck Slack → resolve to auth user via slack_user_id
    for (const [slackId, agg] of stuckSlackBySlackUser.entries()) {
      const profile = profileBySlackId.get(slackId)
      if (!profile) continue // Can't attribute without a profile match
      const card = ensureCard(profile.id, {
        email: profile.email,
        displayName: profile.display_name || profile.full_name,
      })
      const sev: UserIssue['severity'] =
        agg.count > 100 ? 'critical' : agg.count > 20 ? 'high' : 'low'
      addIssue(card, {
        type: 'stuck_slack',
        severity: sev,
        label: `${agg.count} Slack message${agg.count === 1 ? '' : 's'} stuck unprocessed`,
        detail: agg.oldestAt
          ? `Oldest: ${new Date(agg.oldestAt).toLocaleString()}`
          : undefined,
        count: agg.count,
        oldestAt: agg.oldestAt,
        canAutoFix: true,
        fixAction: 'clear_stuck',
      })
    }

    // Error spikes per user (>= 3 errors in 24h attributed to a user)
    const errorsPerUser = new Map<
      string,
      { count: number; severities: Set<string> }
    >()
    for (const e of recentErrorsRes.data || []) {
      if (!e.user_id) continue
      // Skip self-referential health-monitor entries since they're covered by
      // the token/stuck-message checks above.
      if (e.source === 'health-monitor') continue
      const existing = errorsPerUser.get(e.user_id) || {
        count: 0,
        severities: new Set<string>(),
      }
      existing.count++
      existing.severities.add(e.severity)
      errorsPerUser.set(e.user_id, existing)
    }
    for (const [uid, info] of errorsPerUser.entries()) {
      if (info.count < 3 && !info.severities.has('critical')) continue
      const card = ensureCard(uid)
      const sev: UserIssue['severity'] = info.severities.has('critical')
        ? 'critical'
        : info.count >= 10
          ? 'high'
          : 'medium'
      addIssue(card, {
        type: 'error_spike',
        severity: sev,
        label: `${info.count} error${info.count === 1 ? '' : 's'} in last 24h (${Array.from(info.severities).join(', ')})`,
        count: info.count,
        canAutoFix: false,
      })
    }

    // Sort queue: severity, then issue count, then email
    const actionQueue = Array.from(queueByUser.values()).sort((a, b) => {
      const sev = SEVERITY_RANK[a.topSeverity] - SEVERITY_RANK[b.topSeverity]
      if (sev !== 0) return sev
      if (b.issues.length !== a.issues.length)
        return b.issues.length - a.issues.length
      return (a.email || '').localeCompare(b.email || '')
    })

    // Aggregate counts that drive the headline stats
    const autoFixableCount = actionQueue.reduce(
      (sum, u) => sum + u.issues.filter((i) => i.canAutoFix).length,
      0
    )
    const needsUserActionCount = actionQueue.reduce(
      (sum, u) => sum + u.issues.filter((i) => !i.canAutoFix).length,
      0
    )

    // ─── Legacy error/source aggregates ───────────────────────────────────────
    const errorCounts = { critical: 0, error: 0, warning: 0, total: 0 }
    for (const row of errorCountsRes.data || []) {
      errorCounts[row.severity as keyof typeof errorCounts]++
      errorCounts.total++
    }

    const errorsBySource: Record<string, { count: number; critical: number }> =
      {}
    for (const row of errorsBySourceRes.data || []) {
      if (!errorsBySource[row.source]) {
        errorsBySource[row.source] = { count: 0, critical: 0 }
      }
      errorsBySource[row.source].count++
      if (row.severity === 'critical') errorsBySource[row.source].critical++
    }
    const topErrorSources = Object.entries(errorsBySource)
      .map(([source, stats]) => ({ source, ...stats }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Recent errors enriched with user identity so the feed is readable
    const recentErrors = (recentErrorsRes.data || []).map((e) => {
      const p = e.user_id ? profileById.get(e.user_id) : null
      return {
        ...e,
        email: p?.email || null,
        displayName: p?.display_name || p?.full_name || null,
      }
    })

    const dataIntegrity = {
      orphanedProfiles: orphanedProfilesRes.data || [],
      stuckSlackMessages: stuckMessagesRes.count || 0,
      stuckOutlookEmails: stuckEmailsRes.count || 0,
    }

    // Health score (same formula as before — familiar to existing users)
    let healthScore = 100
    if (errorCounts.critical > 0)
      healthScore -= Math.min(40, errorCounts.critical * 10)
    if (errorCounts.error > 0)
      healthScore -= Math.min(30, errorCounts.error * 3)
    if (integrationHealth.expired > 0)
      healthScore -= Math.min(20, integrationHealth.expired * 2)
    if (dataIntegrity.stuckSlackMessages > 10) healthScore -= 5
    if (dataIntegrity.stuckOutlookEmails > 10) healthScore -= 5
    healthScore = Math.max(0, healthScore)

    // Legacy expiredIntegrations list (now with user identity)
    const expiredIntegrations = tokenIssues
      .filter((t) => t.status === 'expired' || t.status === 'missing_refresh')
      .slice(0, 50)
      .map((t) => {
        const p = t.userId ? profileById.get(t.userId) : null
        return {
          id: t.integrationId,
          provider: t.provider,
          userId: t.userId,
          email: p?.email || null,
          displayName: p?.display_name || p?.full_name || null,
          expiresAt: t.expiresAt,
          hasRefreshToken: t.hasRefreshToken,
        }
      })

    return NextResponse.json({
      healthScore,
      errorCounts,
      recentErrors,
      topErrorSources,
      integrationHealth,
      expiredIntegrations,
      dataIntegrity,
      activeUsers7d: activeUsersRes.count || 0,
      // New actionable fields
      actionQueue,
      actionSummary: {
        usersNeedingAttention: actionQueue.length,
        autoFixableIssues: autoFixableCount,
        userActionRequired: needsUserActionCount,
      },
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('System health GET error:', err)
    return NextResponse.json(
      { error: 'Failed to load system health' },
      { status: 500 }
    )
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
    } catch {
      /* session failed */
    }

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

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString()

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
