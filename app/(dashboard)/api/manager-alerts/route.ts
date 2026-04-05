import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

/**
 * GET /api/manager-alerts
 * Returns active proactive alerts for the manager's org.
 *
 * POST /api/manager-alerts
 * Acknowledge or dismiss an alert.
 */
export async function GET(request: NextRequest) {
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

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || !MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'active'

    const query = admin
      .from('manager_alerts')
      .select('*')
      .eq('organization_id', callerMembership.organization_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (statusFilter !== 'all') {
      query.eq('status', statusFilter)
    }

    const { data: alerts } = await query

    // Get profile info for target users
    const targetIds = [...new Set((alerts || []).map((a: { target_user_id: string | null }) => a.target_user_id).filter(Boolean))] as string[]
    const { data: profiles } = targetIds.length > 0
      ? await admin.from('profiles').select('id, display_name, avatar_url').in('id', targetIds)
      : { data: [] }

    const profileMap = new Map<string, { display_name: string; avatar_url: string | null }>()
    for (const p of profiles || []) {
      profileMap.set(p.id, p)
    }

    const enrichedAlerts = (alerts || []).map((a: {
      id: string
      target_user_id: string | null
      alert_type: string
      title: string
      body: string
      severity: string
      data: Record<string, unknown>
      status: string
      action_taken: string | null
      created_at: string
      expires_at: string | null
    }) => {
      const profile = a.target_user_id ? profileMap.get(a.target_user_id) : null
      return {
        ...a,
        targetName: profile?.display_name || null,
        targetAvatar: profile?.avatar_url || null,
      }
    })

    const summary = {
      total: enrichedAlerts.length,
      critical: enrichedAlerts.filter((a: { severity: string }) => a.severity === 'critical').length,
      warning: enrichedAlerts.filter((a: { severity: string }) => a.severity === 'warning').length,
      info: enrichedAlerts.filter((a: { severity: string }) => a.severity === 'info').length,
    }

    return NextResponse.json({ alerts: enrichedAlerts, summary })
  } catch (err) {
    console.error('Manager alerts GET error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
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

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || !MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { alertId, action, actionTaken } = body as {
      alertId: string
      action: 'acknowledged' | 'dismissed' | 'acted_on'
      actionTaken?: string
    }

    if (!alertId || !action) {
      return NextResponse.json({ error: 'Missing alertId or action' }, { status: 400 })
    }

    const { error } = await admin
      .from('manager_alerts')
      .update({
        status: action,
        acknowledged_by: callerId,
        acknowledged_at: new Date().toISOString(),
        ...(actionTaken ? { action_taken: actionTaken } : {}),
      })
      .eq('id', alertId)
      .eq('organization_id', callerMembership.organization_id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Manager alerts POST error:', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
