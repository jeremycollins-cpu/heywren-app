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
 * POST /api/remove-member
 * Remove a member from the organization. Org admins only.
 * Decrements Stripe seat count (no refund — billing stops forward).
 */
export async function POST(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = getAdminClient()

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || callerMembership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can remove members' }, { status: 403 })
    }

    const { userId } = await request.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    if (userId === callerId) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    }

    const orgId = callerMembership.organization_id

    // Verify target is in the same org
    const { data: targetMembership } = await admin
      .from('organization_members')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .single()

    if (!targetMembership) {
      return NextResponse.json({ error: 'User not in your organization' }, { status: 404 })
    }

    // Remove from organization_members
    await admin.from('organization_members').delete().eq('user_id', userId).eq('organization_id', orgId)

    // Remove from team_members (legacy)
    await admin.from('team_members').delete().eq('user_id', userId)

    // Clear org references on profile
    await admin.from('profiles').update({
      current_team_id: null,
      organization_id: null,
      department_id: null,
    }).eq('id', userId)

    // Decrement Stripe seat count (no refund — billing stops going forward)
    try {
      const { data: orgBilling } = await admin
        .from('organizations')
        .select('billing_type, stripe_subscription_id')
        .eq('id', orgId)
        .single()

      if (orgBilling?.billing_type !== 'enterprise' && orgBilling?.stripe_subscription_id) {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any })
        const subscription = await stripe.subscriptions.retrieve(orgBilling.stripe_subscription_id)
        const item = subscription.items.data[0]
        if (item && (item.quantity || 1) > 1) {
          await stripe.subscriptions.update(orgBilling.stripe_subscription_id, {
            items: [{ id: item.id, quantity: (item.quantity || 1) - 1 }],
            proration_behavior: 'none', // No refund — billing stops forward
          })
        }
      }

      // Also check team-level subscription
      const { data: teams } = await admin
        .from('teams')
        .select('stripe_subscription_id')
        .eq('organization_id', orgId)
        .not('stripe_subscription_id', 'is', null)
        .limit(1)

      if (teams?.[0]?.stripe_subscription_id && !orgBilling?.stripe_subscription_id) {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any })
        const subscription = await stripe.subscriptions.retrieve(teams[0].stripe_subscription_id)
        const item = subscription.items.data[0]
        if (item && (item.quantity || 1) > 1) {
          await stripe.subscriptions.update(teams[0].stripe_subscription_id, {
            items: [{ id: item.id, quantity: (item.quantity || 1) - 1 }],
            proration_behavior: 'none',
          })
        }
      }
    } catch (stripeErr) {
      console.error('[remove-member] Stripe seat decrement failed (non-fatal):', stripeErr)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Remove member error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
