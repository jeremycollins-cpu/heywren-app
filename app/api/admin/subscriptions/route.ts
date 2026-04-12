export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * GET /api/admin/subscriptions
 * Returns all organizations with their subscription details. Super admin only.
 */
export async function GET() {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = getAdmin()
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get all organizations with billing info
    const { data: orgs } = await admin
      .from('organizations')
      .select('id, name, domain, billing_type, stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status, trial_ends_at, max_users, created_at')
      .order('created_at', { ascending: false })

    // Get member counts per org
    const { data: members } = await admin
      .from('organization_members')
      .select('organization_id')

    const memberCounts: Record<string, number> = {}
    for (const m of members || []) {
      if (m.organization_id) {
        memberCounts[m.organization_id] = (memberCounts[m.organization_id] || 0) + 1
      }
    }

    const enriched = (orgs || []).map(org => ({
      ...org,
      memberCount: memberCounts[org.id] || 0,
      trialExpired: org.trial_ends_at ? new Date(org.trial_ends_at) < new Date() : false,
    }))

    return NextResponse.json({ organizations: enriched })
  } catch (err) {
    console.error('Admin subscriptions GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/subscriptions
 * Update an organization's billing settings. Super admin only.
 * Body: { organizationId, billingType?, plan?, status?, maxUsers? }
 */
export async function PATCH(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = getAdmin()
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single()

    if (!profile || profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { organizationId, billingType, plan, status, maxUsers } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

    const updates: Record<string, any> = {}
    if (billingType) updates.billing_type = billingType
    if (plan) updates.subscription_plan = plan
    if (status) updates.subscription_status = status
    if (maxUsers) updates.max_users = maxUsers

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { error } = await admin
      .from('organizations')
      .update(updates)
      .eq('id', organizationId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Keep teams in sync
    const teamUpdates: Record<string, any> = {}
    if (plan) teamUpdates.subscription_plan = plan
    if (status) teamUpdates.subscription_status = status
    if (maxUsers) teamUpdates.max_users = maxUsers
    if (Object.keys(teamUpdates).length > 0) {
      await admin.from('teams').update(teamUpdates).eq('organization_id', organizationId)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin subscriptions PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
