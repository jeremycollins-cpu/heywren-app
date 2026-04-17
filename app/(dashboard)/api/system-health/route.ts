// app/(dashboard)/api/system-health/route.ts
// Pipeline health snapshot for the current user.
// Reads from existing tables (ai_platform_usage, system_errors, commitments,
// outlook_messages, integrations) — no new schema.

import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { resolveOrganizationId } from '@/lib/team/resolve-org'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const DAY_MS = 86400000

type PipelineStatus = 'healthy' | 'stale' | 'broken' | 'unknown'

interface PipelineHealth {
  name: string
  description: string
  status: PipelineStatus
  lastRunAt: string | null
  lastRunAgeHours: number | null
  itemsLast24h: number
  apiCallsLast24h: number
  recentErrors: number
  note: string | null
}

function deriveStatus(
  lastRunAgeHours: number | null,
  apiCallsLast24h: number,
  recentErrors: number,
  expectedMaxAgeHours: number
): PipelineStatus {
  if (recentErrors > 0) return 'broken'
  if (lastRunAgeHours === null) return 'unknown'
  if (lastRunAgeHours > expectedMaxAgeHours * 2) return 'broken'
  if (lastRunAgeHours > expectedMaxAgeHours) return 'stale'
  if (apiCallsLast24h === 0 && expectedMaxAgeHours <= 24) return 'stale'
  return 'healthy'
}

export async function GET() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const userId = userData.user.id

    // Anchor on organization_id, not team_id. Users are UNIQUE(org, user) per
    // migration 019, so organization_id is the stable identity that can't drift
    // between the read path (this endpoint) and the write path (AI pipelines
    // writing ai_platform_usage / system_errors / etc via trigger fill-in).
    // resolveOrganizationId() self-heals if profiles.organization_id is stale.
    const organizationId = await resolveOrganizationId(admin, userId)
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization' }, { status: 400 })
    }

    const now = Date.now()
    const dayAgo = new Date(now - DAY_MS).toISOString()
    const weekAgo = new Date(now - 7 * DAY_MS).toISOString()

    // ── Pipeline definitions ──
    // Each row in ai_platform_usage is a successful Inngest run, so we use
    // max(created_at) as "last run" heartbeat and sum as throughput.
    const pipelineDefs: Array<{
      name: string
      description: string
      module: string
      expectedMaxAgeHours: number
    }> = [
      {
        name: 'Commitment detection',
        description: 'Finds promises in email and calendar every 4 hours',
        module: 'detect-commitments',
        expectedMaxAgeHours: 6,
      },
      {
        name: 'Security alerts',
        description: 'Scans inbox daily for phishing and spoofing',
        module: 'detect-email-threats',
        expectedMaxAgeHours: 28,
      },
      {
        name: 'Missed email triage',
        description: 'Flags emails that need a reply',
        module: 'classify-missed-email',
        expectedMaxAgeHours: 6,
      },
      {
        name: 'Completion detection',
        description: 'Auto-closes commitments when a reply resolves them',
        module: 'detect-completion',
        expectedMaxAgeHours: 6,
      },
    ]

    // Per-pipeline heartbeats
    const pipelineResults = await Promise.all(
      pipelineDefs.map(async def => {
        const [heartbeatRes, errorsRes] = await Promise.all([
          admin
            .from('ai_platform_usage')
            .select('created_at, items_processed, api_calls')
            .eq('module', def.module)
            .eq('organization_id', organizationId)
            .gte('created_at', weekAgo)
            .order('created_at', { ascending: false }),
          admin
            .from('system_errors')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .ilike('error_key', `%${def.module}%`)
            .gte('created_at', dayAgo),
        ])

        const rows = heartbeatRes.data || []
        const lastRow = rows[0]
        const lastRunAt = lastRow?.created_at || null
        const lastRunAgeHours = lastRunAt
          ? Math.round((now - new Date(lastRunAt).getTime()) / 3600000)
          : null

        const last24h = rows.filter(r => new Date(r.created_at).getTime() >= now - DAY_MS)
        const itemsLast24h = last24h.reduce((sum, r) => sum + (r.items_processed || 0), 0)
        const apiCallsLast24h = last24h.reduce((sum, r) => sum + (r.api_calls || 0), 0)
        const recentErrors = errorsRes.count || 0

        const status = deriveStatus(lastRunAgeHours, apiCallsLast24h, recentErrors, def.expectedMaxAgeHours)

        const note =
          status === 'broken' && recentErrors > 0
            ? `${recentErrors} error${recentErrors === 1 ? '' : 's'} in the last 24h`
            : status === 'broken' && lastRunAgeHours !== null
              ? `No successful run in ${lastRunAgeHours}h (expected every ${def.expectedMaxAgeHours}h)`
              : status === 'stale' && lastRunAgeHours !== null
                ? `Last run ${lastRunAgeHours}h ago (expected every ${def.expectedMaxAgeHours}h)`
                : status === 'unknown'
                  ? 'No runs recorded in the last week'
                  : null

        const health: PipelineHealth = {
          name: def.name,
          description: def.description,
          status,
          lastRunAt,
          lastRunAgeHours,
          itemsLast24h,
          apiCallsLast24h,
          recentErrors,
          note,
        }
        return health
      })
    )

    // ── Data flow signals (not tied to a single AI module) ──
    const [latestCommitmentRes, latestEmailRes, backlogRes, integrationsRes, recentErrorsRes] = await Promise.all([
      admin
        .from('commitments')
        .select('created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(1),
      // outlook_messages has no organization_id column yet — filter by user_id,
      // which is sufficient since UNIQUE(org, user) guarantees no cross-org leakage.
      admin
        .from('outlook_messages')
        .select('received_at')
        .eq('user_id', userId)
        .order('received_at', { ascending: false })
        .limit(1),
      admin
        .from('outlook_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('processed', false)
        .lt('created_at', new Date(now - 3600000).toISOString()),
      admin
        .from('integrations')
        .select('id, provider, config, refresh_token')
        .eq('user_id', userId),
      admin
        .from('system_errors')
        .select('id, source, message, severity, error_key, created_at')
        .eq('organization_id', organizationId)
        .gte('created_at', dayAgo)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const latestCommitmentAt = latestCommitmentRes.data?.[0]?.created_at || null
    const latestEmailAt = latestEmailRes.data?.[0]?.received_at || null
    const commitmentAgeHours = latestCommitmentAt
      ? Math.round((now - new Date(latestCommitmentAt).getTime()) / 3600000)
      : null
    const emailAgeHours = latestEmailAt
      ? Math.round((now - new Date(latestEmailAt).getTime()) / 3600000)
      : null

    const integrations = (integrationsRes.data || []).map(i => {
      const expiresAt = (i.config as any)?.token_expires_at
      const expired = expiresAt ? new Date(expiresAt) < new Date(now) : false
      const canRefresh = !!i.refresh_token
      return {
        provider: i.provider,
        expiresAt: expiresAt || null,
        expired,
        canRefresh,
        status: expired ? (canRefresh ? 'refreshing' : 'reconnect_required') : 'connected',
      }
    })

    return NextResponse.json({
      dataFlow: {
        lastCommitmentAt: latestCommitmentAt,
        commitmentAgeHours,
        lastEmailAt: latestEmailAt,
        emailAgeHours,
        stuckEmailBacklog: backlogRes.count || 0,
      },
      pipelines: pipelineResults,
      integrations,
      recentErrors: recentErrorsRes.data || [],
    })
  } catch (err) {
    console.error('System health error:', err)
    return NextResponse.json({ error: 'Internal error', detail: (err as Error).message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
