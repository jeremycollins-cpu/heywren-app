import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PRICE_IDS: Record<string, string> = {
  basic: process.env.STRIPE_BASIC_PRICE_ID!,
  pro: process.env.STRIPE_PRO_PRICE_ID!,
  team: process.env.STRIPE_TEAM_PRICE_ID!,
}

export async function POST(request: NextRequest) {
  try {
    // Origin validation
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { teamId, newPlan, promoCode } = await request.json()

    if (!teamId || !newPlan) {
      return NextResponse.json({ error: 'Missing teamId or newPlan' }, { status: 400 })
    }

    if (!['basic', 'pro', 'team'].includes(newPlan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const newPriceId = PRICE_IDS[newPlan]
    if (!newPriceId) {
      return NextResponse.json({ error: 'Price ID not configured for this plan' }, { status: 500 })
    }

    // Get user from session cookie to verify permissions
    const { createClient: createSessionClient } = await import('@/lib/supabase/server')
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is owner/admin
    const { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userData.user.id)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Get team's Stripe subscription
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('stripe_subscription_id, stripe_customer_id, subscription_plan')
      .eq('id', teamId)
      .single()

    if (!team?.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (team.subscription_plan === newPlan) {
      return NextResponse.json({ error: 'Already on this plan' }, { status: 400 })
    }

    // Get the current subscription to find the item ID
    const subscription = await stripe.subscriptions.retrieve(team.stripe_subscription_id)
    const subscriptionItemId = subscription.items.data[0]?.id

    if (!subscriptionItemId) {
      return NextResponse.json({ error: 'Subscription item not found' }, { status: 500 })
    }

    // Resolve promo code to a Stripe promotion code ID if provided
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

    // Update the subscription with the new price
    // proration_behavior: 'create_prorations' handles the billing adjustment automatically
    const updateParams: Record<string, any> = {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId,
        },
      ],
      proration_behavior: 'create_prorations',
      // If subscription was set to cancel, undo that
      cancel_at_period_end: false,
      metadata: {
        ...subscription.metadata,
        plan: newPlan,
      },
    }

    // Apply promotion code / coupon discount if provided
    if (promotionCodeId) {
      updateParams.promotion_code = promotionCodeId
    }

    const updatedSubscription = await stripe.subscriptions.update(team.stripe_subscription_id, updateParams)

    // Update the database immediately
    await supabaseAdmin
      .from('teams')
      .update({
        subscription_plan: newPlan,
        subscription_status: updatedSubscription.status,
      })
      .eq('id', teamId)

    return NextResponse.json({
      success: true,
      plan: newPlan,
      status: updatedSubscription.status,
    })
  } catch (error: any) {
    console.error('Change plan error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to change plan' },
      { status: 500 }
    )
  }
}
