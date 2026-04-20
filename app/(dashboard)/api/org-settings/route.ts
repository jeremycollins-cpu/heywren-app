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
 * GET /api/org-settings
 * Returns the MFA enforcement setting for the caller's organization.
 */
export async function GET() {
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

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    const { data: org, error } = await admin
      .from('organizations')
      .select('require_mfa, disable_slack_alerts')
      .eq('id', membership.organization_id)
      .single()

    if (error || !org) {
      return NextResponse.json({ error: 'Failed to fetch org settings' }, { status: 500 })
    }

    return NextResponse.json({
      requireMfa: org.require_mfa,
      disableSlackAlerts: org.disable_slack_alerts,
    })
  } catch (err) {
    console.error('Org settings GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/org-settings
 * Allows org_admin to update organization settings.
 * Body: { requireMfa?: boolean, disableSlackAlerts?: boolean }
 * At least one field must be provided.
 */
export async function PUT(request: NextRequest) {
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

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    if (membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can update organization settings' }, { status: 403 })
    }

    const body = await request.json()
    const { requireMfa, disableSlackAlerts } = body as {
      requireMfa?: boolean
      disableSlackAlerts?: boolean
    }

    const updates: { require_mfa?: boolean; disable_slack_alerts?: boolean } = {}

    if (requireMfa !== undefined) {
      if (typeof requireMfa !== 'boolean') {
        return NextResponse.json({ error: 'requireMfa must be a boolean' }, { status: 400 })
      }
      updates.require_mfa = requireMfa
    }

    if (disableSlackAlerts !== undefined) {
      if (typeof disableSlackAlerts !== 'boolean') {
        return NextResponse.json({ error: 'disableSlackAlerts must be a boolean' }, { status: 400 })
      }
      updates.disable_slack_alerts = disableSlackAlerts
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No settings provided to update' }, { status: 400 })
    }

    const { error } = await admin
      .from('organizations')
      .update(updates)
      .eq('id', membership.organization_id)

    if (error) {
      console.error('Failed to update org settings:', error)
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      ...(updates.require_mfa !== undefined && { requireMfa: updates.require_mfa }),
      ...(updates.disable_slack_alerts !== undefined && { disableSlackAlerts: updates.disable_slack_alerts }),
    })
  } catch (err) {
    console.error('Org settings PUT error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
