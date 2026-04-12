import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const PRICE_IDS: Record<string, Record<string, string | undefined>> = {
  pro: {
    monthly: process.env.STRIPE_PRO_PRICE_ID!,
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || undefined,
  },
  team: {
    monthly: process.env.STRIPE_TEAM_PRICE_ID!,
    annual: process.env.STRIPE_TEAM_ANNUAL_PRICE_ID || undefined,
  },
}

export async function POST(request: NextRequest) {
  const admin = getAdminClient()
  try {
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { teamId, newPlan, billingInterval = 'monthly', promoCode } = await request.json()

    if (!newPlan || !['pro', 'team'].includes(newPlan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }
    if (!['monthly', 'annual'].includes(billingInterval)) {
      return NextResponse.json({ error: 'Invalid billing interval' }, { status: 400 })
    }

    const newPriceId = PRICE_IDS[newPlan]?.[billingInterval] || PRICE_IDS[newPlan]?.monthly
    if (!newPriceId) {
      return NextResponse.json({ error: 'Price ID not configured' }, { status: 500 })
    }

    // Auth
    const { createClient: createSessionClient } = await import('@/lib/supabase/server')
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify org admin
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userData.user.id)
      .limit(1)
      .single()

    if (!membership || membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can change plans' }, { status: 403 })
    }

    const orgId = membership.organization_id

    // Get organization's subscription (source of truth)
    const { data: org } = await admin
      .from('organizations')
      .select('stripe_subscription_id, subscription_plan')
      .eq('id', orgId)
      .single()

    // Fall back to team subscription for legacy orgs
    let subId = org?.stripe_subscription_id
    if (!subId && teamId) {
      const { data: team } = await admin
        .from('teams')
        .select('stripe_subscription_id')
        .eq('id', teamId)
        .single()
      subId = team?.stripe_subscription_id
    }

    if (!subId) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (org?.subscription_plan === newPlan) {
      return NextResponse.json({ error: 'Already on this plan' }, { status: 400 })
    }

    const subscription = await stripe.subscriptions.retrieve(subId)
    const subscriptionItemId = subscription.items.data[0]?.id
    if (!subscriptionItemId) {
      return NextResponse.json({ error: 'Subscription item not found' }, { status: 500 })
    }

    let promotionCodeId: string | undefined
    if (promoCode && typeof promoCode === 'string') {
      const promoCodes = await stripe.promotionCodes.list({
        code: promoCode.trim().toUpperCase(),
        active: true,
        limit: 1,
      })
      if (promoCodes.data.length > 0 && promoCodes.data[0].coupon.valid) {
        promotionCodeId = promoCodes.data[0].id
      }
    }

    const updateParams: Record<string, any> = {
      items: [{ id: subscriptionItemId, price: newPriceId }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
      metadata: { ...subscription.metadata, plan: newPlan, organizationId: orgId },
    }
    if (promotionCodeId) updateParams.promotion_code = promotionCodeId

    const updatedSubscription = await stripe.subscriptions.update(subId, updateParams)

    // Update organization (source of truth)
    await admin.from('organizations').update({
      subscription_plan: newPlan,
      subscription_status: updatedSubscription.status,
    }).eq('id', orgId)

    // Keep teams in sync
    await admin.from('teams').update({
      subscription_plan: newPlan,
      subscription_status: updatedSubscription.status,
    }).eq('organization_id', orgId)

    return NextResponse.json({ success: true, plan: newPlan, status: updatedSubscription.status })
  } catch (error: any) {
    console.error('Change plan error:', error)
    return NextResponse.json({ error: error.message || 'Failed to change plan' }, { status: 500 })
  }
}
